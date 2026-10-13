-- =====================================================================
-- Migration: ปรับโครงสร้างตารางใน repo ให้ตรงกับฐานข้อมูลจริง
--
-- ไฟล์นี้สร้างคืนจากสถานะฐานข้อมูลจริง (Supabase) ณ 13 ต.ค. 2569 เพราะตอนรัน
-- migration นี้ครั้งแรก ประวัติไม่ได้บันทึกคำสั่งไว้ (supabase_migrations มีแค่เลขเวอร์ชัน)
--
-- - pets: ชื่อคอลัมน์ในฐานข้อมูลจริงคือ pet_type / weight_kg / birth_date / microchip_id
--   (หน้าเว็บใช้ alias ใน js/pets.js: type:pet_type, weight:weight_kg ฯลฯ)
-- - pets: age, gender, pet_type ไม่บังคับกรอกที่ระดับฐานข้อมูล แต่มี CHECK กันค่าผิด
-- - expenses.recorded_by_role: บทบาทของผู้บันทึกตอนบันทึก ตั้งค่าโดย Trigger
-- - create_pet_with_owner(): เขียนลงคอลัมน์ชื่อใหม่
-- รันซ้ำได้ (idempotent)
-- =====================================================================

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = 'pets' AND column_name = 'type') THEN
        ALTER TABLE public.pets RENAME COLUMN type TO pet_type;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = 'pets' AND column_name = 'weight') THEN
        ALTER TABLE public.pets RENAME COLUMN weight TO weight_kg;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = 'pets' AND column_name = 'birthdate') THEN
        ALTER TABLE public.pets RENAME COLUMN birthdate TO birth_date;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = 'pets' AND column_name = 'microchip') THEN
        ALTER TABLE public.pets RENAME COLUMN microchip TO microchip_id;
    END IF;
END $$;

ALTER TABLE public.pets ALTER COLUMN pet_type TYPE VARCHAR(50);
ALTER TABLE public.pets ALTER COLUMN pet_type DROP NOT NULL;
ALTER TABLE public.pets ALTER COLUMN age DROP NOT NULL;
ALTER TABLE public.pets ALTER COLUMN gender TYPE VARCHAR(10);
ALTER TABLE public.pets ALTER COLUMN gender DROP NOT NULL;
ALTER TABLE public.pets ADD COLUMN IF NOT EXISTS photo_url TEXT;

-- ข้อมูลเดิมที่เก็บเพศเป็นภาษาไทยหรือค่าอื่น ต้องแปลงก่อนเพิ่ม CHECK
UPDATE public.pets SET gender = CASE gender WHEN 'ผู้' THEN 'Male' WHEN 'เมีย' THEN 'Female' ELSE NULL END
WHERE gender IS NOT NULL AND gender NOT IN ('Male', 'Female');
UPDATE public.pets SET weight_kg = NULL WHERE weight_kg IS NOT NULL AND weight_kg <= 0;

ALTER TABLE public.pets DROP CONSTRAINT IF EXISTS chk_pets_gender;
ALTER TABLE public.pets ADD CONSTRAINT chk_pets_gender
    CHECK (gender IS NULL OR gender IN ('Male', 'Female'));
ALTER TABLE public.pets DROP CONSTRAINT IF EXISTS chk_pets_weight;
ALTER TABLE public.pets ADD CONSTRAINT chk_pets_weight
    CHECK (weight_kg IS NULL OR weight_kg > 0);

ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS recorded_by_role VARCHAR(20);

CREATE OR REPLACE FUNCTION public.create_pet_with_owner(p_name text, p_type text, p_gender text, p_age integer, p_type_breed text DEFAULT NULL::text, p_breed text DEFAULT NULL::text, p_weight numeric DEFAULT NULL::numeric, p_birthdate date DEFAULT NULL::date, p_adoption_date date DEFAULT NULL::date, p_microchip text DEFAULT NULL::text, p_image_url text DEFAULT NULL::text)
 RETURNS SETOF pets
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_owner_id INT := auth_user_id();
    v_pet_id INT;
    v_gender TEXT := CASE p_gender
        WHEN 'ผู้' THEN 'Male'
        WHEN 'เมีย' THEN 'Female'
        ELSE p_gender
    END;
BEGIN
    IF v_owner_id IS NULL THEN
        RAISE EXCEPTION 'ไม่พบโปรไฟล์ผู้ใช้ กรุณาเข้าสู่ระบบใหม่อีกครั้ง';
    END IF;
    INSERT INTO pets (name, pet_type, gender, age, type_breed, breed, weight_kg, birth_date, adoption_date, microchip_id, photo_url)
    VALUES (p_name, p_type, v_gender, p_age, p_type_breed, p_breed, p_weight, p_birthdate, p_adoption_date, p_microchip, p_image_url)
    RETURNING pet_id INTO v_pet_id;
    INSERT INTO pet_access (pet_id, user_id, access_role)
    VALUES (v_pet_id, v_owner_id, 'Owner');
    RETURN QUERY SELECT * FROM pets WHERE pet_id = v_pet_id;
END;
$function$;

-- บทบาทของผู้บันทึก ณ เวลาที่บันทึก (ใช้ระบายสีป้ายผู้บันทึกในหน้าประวัติ)
CREATE OR REPLACE FUNCTION public.set_expense_recorder_role()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    SELECT pa.access_role INTO NEW.recorded_by_role
    FROM pet_access pa
    WHERE pa.pet_id = NEW.pet_id AND pa.user_id = NEW.user_id
    LIMIT 1;
    IF NEW.recorded_by_role IS NULL THEN
        NEW.recorded_by_role := 'Owner';
    END IF;
    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_set_expense_recorder_role ON public.expenses;
CREATE TRIGGER trg_set_expense_recorder_role
    BEFORE INSERT ON public.expenses
    FOR EACH ROW EXECUTE FUNCTION public.set_expense_recorder_role();
