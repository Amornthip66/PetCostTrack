-- =====================================================================
-- Migration: อายุสัตว์เลี้ยงเป็น "ปี + เดือน"
--
-- 1. เพิ่มคอลัมน์ pets.age_months (0–11) คู่กับ pets.age (ปี) ของเดิม
--    อายุจริง = age ปี + age_months เดือน เช่น 1 ปี 6 เดือน → age = 1, age_months = 6
--    แถวเดิมทุกแถวได้ 0 เดือน (อายุที่แสดงเท่าเดิม)
-- 2. create_pet_with_owner(): เพิ่มพารามิเตอร์ p_age_months (ไม่บังคับ ค่าเริ่มต้น 0)
--    ต้อง DROP ตัวเดิมก่อน เพราะถ้ามีฟังก์ชันชื่อเดียวกัน 2 แบบ PostgREST จะเลือกไม่ได้ว่าจะเรียกตัวไหน
--    หน้าเว็บชุดเดิม (ที่ไม่ส่ง p_age_months) ยังเรียกได้ตามปกติ
--
-- CHECK เดิมยังอยู่: chk_pets_age (age >= 0), chk_pets_weight (weight_kg > 0)
-- รันไฟล์นี้ก่อนอัปโหลดหน้าเว็บชุดใหม่ รันซ้ำได้ (idempotent)
-- =====================================================================

BEGIN;

-- 1. คอลัมน์เดือน
ALTER TABLE public.pets ADD COLUMN IF NOT EXISTS age_months smallint NOT NULL DEFAULT 0;
ALTER TABLE public.pets DROP CONSTRAINT IF EXISTS chk_pets_age_months;
ALTER TABLE public.pets ADD CONSTRAINT chk_pets_age_months CHECK (age_months BETWEEN 0 AND 11);

COMMENT ON COLUMN public.pets.age IS 'อายุ (ปีเต็ม) — อายุจริง = age ปี + age_months เดือน';
COMMENT ON COLUMN public.pets.age_months IS 'อายุส่วนที่เป็นเดือน 0–11 — อายุจริง = age ปี + age_months เดือน';

-- 2. สร้างสัตว์เลี้ยง + สิทธิ์ Owner ในทรานแซกชันเดียว (เหมือนเดิม) + บันทึกเดือน
DROP FUNCTION IF EXISTS public.create_pet_with_owner(text, text, text, integer, text, text, numeric, date, date, text, text);

CREATE OR REPLACE FUNCTION public.create_pet_with_owner(
    p_name text,
    p_type text,
    p_gender text,
    p_age integer,
    p_type_breed text DEFAULT NULL::text,
    p_breed text DEFAULT NULL::text,
    p_weight numeric DEFAULT NULL::numeric,
    p_birthdate date DEFAULT NULL::date,
    p_adoption_date date DEFAULT NULL::date,
    p_microchip text DEFAULT NULL::text,
    p_image_url text DEFAULT NULL::text,
    p_age_months integer DEFAULT 0
)
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
    INSERT INTO pets (name, pet_type, gender, age, age_months, type_breed, breed, weight_kg, birth_date, adoption_date, microchip_id, photo_url)
    VALUES (p_name, p_type, v_gender, p_age, COALESCE(p_age_months, 0), p_type_breed, p_breed, p_weight, p_birthdate, p_adoption_date, p_microchip, p_image_url)
    RETURNING pet_id INTO v_pet_id;
    INSERT INTO pet_access (pet_id, user_id, access_role)
    VALUES (v_pet_id, v_owner_id, 'Owner');
    RETURN QUERY SELECT * FROM pets WHERE pet_id = v_pet_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_pet_with_owner(text, text, text, integer, text, text, numeric, date, date, text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_pet_with_owner(text, text, text, integer, text, text, numeric, date, date, text, text, integer) TO authenticated, service_role;

COMMIT;

-- ให้ PostgREST รู้จักคอลัมน์/ฟังก์ชันใหม่ทันที (ไม่ต้องรอ reload เอง)
NOTIFY pgrst, 'reload schema';
