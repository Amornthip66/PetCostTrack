-- =====================================================================
-- แก้ปัญหา: เพิ่มสัตว์เลี้ยงใหม่แล้วเจอ
--   "new row violates row-level security policy for table \"pets\""
--   แม้ auth.uid() จะไม่ใช่ NULL และ user login อยู่จริงก็ตาม
--
-- สาเหตุที่แท้จริง:
--   ฝั่ง client เดิม insert เข้า pets ก่อน (พร้อม Prefer: return=representation
--   เพื่อขอแถวที่เพิ่งสร้างกลับมา) แล้วค่อย insert เข้า pet_access ทีหลัง
--   แยกเป็นคนละ request กัน
--
--   แต่ PostgREST/Postgres จะตรวจ policy "pets_select" (ซึ่งต้องมีแถวใน
--   pet_access ก่อนถึงจะเห็น) กับแถวที่เพิ่ง insert ทุกครั้งที่ต้อง
--   RETURNING แถวนั้นกลับไป (ทั้ง Prefer: representation และ minimal ก็ตาม
--   เพราะ PostgREST ต้องอ่านค่า primary key กลับมาสร้าง Location header อยู่ดี)
--   ตอนที่ INSERT เข้า pets เสร็จใหม่ๆ ยังไม่มีแถวใน pet_access เลย
--   (จะสร้างใน request ถัดไป) ทำให้แถวที่เพิ่ง insert ไม่ผ่าน pets_select
--   -> Postgres โยน error "new row violates row-level security policy"
--   ทั้งที่ INSERT policy (pets_insert) ผ่านไปแล้วจริงๆ
--
-- วิธีแก้:
--   รวมการ insert ทั้งสองตาราง (pets + pet_access) ไว้ในฟังก์ชันเดียว
--   แบบ SECURITY DEFINER ให้ทำงานเป็น transaction เดียวกัน โดย insert
--   pet_access ให้เสร็จก่อนจะอ่านแถว pets กลับไปคืนค่า ปิดช่องว่างนี้ไปเลย
--
-- หมายเหตุ: กันไว้เผื่อ migration 20260905000000_update_pets.sql (ที่เพิ่ม
-- คอลัมน์ type/breed/gender/weight/birthdate/adoption_date/microchip/
-- image_url) ยังไม่เคยถูกรันบนฐานข้อมูลจริงมาก่อน — ใส่ ADD COLUMN
-- IF NOT EXISTS ซ้ำไว้ตรงนี้ด้วย (idempotent รันซ้ำได้ไม่พัง แม้เคยรัน
-- migration เดิมไปแล้วก็ตาม) เพื่อให้ migration ไฟล์นี้ไฟล์เดียวพอ
-- ไม่ต้องพึ่งลำดับการรัน migration ไฟล์อื่นก่อน
-- =====================================================================

ALTER TABLE pets
ADD COLUMN IF NOT EXISTS type VARCHAR(100),
ADD COLUMN IF NOT EXISTS breed VARCHAR(100),
ADD COLUMN IF NOT EXISTS gender VARCHAR(20),
ADD COLUMN IF NOT EXISTS weight DECIMAL(5,2),
ADD COLUMN IF NOT EXISTS birthdate DATE,
ADD COLUMN IF NOT EXISTS adoption_date DATE,
ADD COLUMN IF NOT EXISTS microchip VARCHAR(50),
ADD COLUMN IF NOT EXISTS image_url TEXT;

CREATE OR REPLACE FUNCTION public.create_pet_with_owner(
    p_name TEXT,
    p_type TEXT,
    p_gender TEXT,
    p_age INT,
    p_type_breed TEXT DEFAULT NULL,
    p_breed TEXT DEFAULT NULL,
    p_weight NUMERIC DEFAULT NULL,
    p_birthdate DATE DEFAULT NULL,
    p_adoption_date DATE DEFAULT NULL,
    p_microchip TEXT DEFAULT NULL,
    p_image_url TEXT DEFAULT NULL
)
RETURNS SETOF pets AS $$
DECLARE
    v_owner_id INT := auth_user_id();
    v_pet_id INT;
BEGIN
    IF v_owner_id IS NULL THEN
        RAISE EXCEPTION 'ไม่พบโปรไฟล์ผู้ใช้ กรุณาเข้าสู่ระบบใหม่อีกครั้ง';
    END IF;

    INSERT INTO pets (name, type, gender, age, type_breed, breed, weight, birthdate, adoption_date, microchip, image_url)
    VALUES (p_name, p_type, p_gender, p_age, p_type_breed, p_breed, p_weight, p_birthdate, p_adoption_date, p_microchip, p_image_url)
    RETURNING pet_id INTO v_pet_id;

    INSERT INTO pet_access (pet_id, user_id, access_role)
    VALUES (v_pet_id, v_owner_id, 'Owner');

    RETURN QUERY SELECT * FROM pets WHERE pet_id = v_pet_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.create_pet_with_owner(TEXT,TEXT,TEXT,INT,TEXT,TEXT,NUMERIC,DATE,DATE,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_pet_with_owner(TEXT,TEXT,TEXT,INT,TEXT,TEXT,NUMERIC,DATE,DATE,TEXT,TEXT) TO authenticated;
