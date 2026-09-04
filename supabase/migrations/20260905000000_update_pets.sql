-- 1. เพิ่มคอลัมน์ใหม่ในตาราง pets
ALTER TABLE pets 
ADD COLUMN IF NOT EXISTS type VARCHAR(100),
ADD COLUMN IF NOT EXISTS breed VARCHAR(100),
ADD COLUMN IF NOT EXISTS gender VARCHAR(20),
ADD COLUMN IF NOT EXISTS weight DECIMAL(5,2),
ADD COLUMN IF NOT EXISTS birthdate DATE,
ADD COLUMN IF NOT EXISTS adoption_date DATE,
ADD COLUMN IF NOT EXISTS microchip VARCHAR(50),
ADD COLUMN IF NOT EXISTS image_url TEXT;

-- 2. เติมข้อมูลเริ่มต้นให้แถวที่มีอยู่แล้ว เพื่อป้องกัน Error ตอนบังคับ NOT NULL
UPDATE pets SET type = 'ไม่ระบุ' WHERE type IS NULL;
UPDATE pets SET gender = 'ไม่ระบุ' WHERE gender IS NULL;
UPDATE pets SET age = 0 WHERE age IS NULL;

-- 3. บังคับให้ ชื่อ, ประเภท, เพศ และ อายุ ต้องมีข้อมูลเสมอ (Required)
ALTER TABLE pets ALTER COLUMN name SET NOT NULL;
ALTER TABLE pets ALTER COLUMN type SET NOT NULL;
ALTER TABLE pets ALTER COLUMN gender SET NOT NULL;
ALTER TABLE pets ALTER COLUMN age SET NOT NULL;
