-- =====================================================================
-- Migration: รูปโปรไฟล์สัตว์เลี้ยง (bucket pet-photos)
--
-- - pets.image_url เก็บ "path ใน bucket" (เช่น 12/1727700000000.jpg) ไม่ใช่ URL เต็ม
--   เพราะ bucket เป็นแบบ private ต้องโหลดผ่าน Authorization header เสมอ
-- - ไฟล์ของสัตว์เลี้ยงแต่ละตัวอยู่ใต้โฟลเดอร์ชื่อ pet_id ของตัวนั้น
--   policy ด้านล่างใช้ชื่อโฟลเดอร์นี้ตรวจสิทธิ์ผ่าน user_has_pet_access()
--   (Owner และ Co-caretaker เห็น/เปลี่ยนรูปได้ ตรงกับ pets_update ที่ Co-caretaker แก้โปรไฟล์ได้)
--
-- รันซ้ำได้ (idempotent)
-- =====================================================================

ALTER TABLE public.pets ADD COLUMN IF NOT EXISTS image_url TEXT;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('pet-photos', 'pet-photos', false, 5242880,
        ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = 5242880,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

-- CASE (ไม่ใช่ AND) เพื่อไม่ให้ cast ชื่อโฟลเดอร์ที่ไม่ใช่ตัวเลขเป็น int แล้ว error
CREATE OR REPLACE FUNCTION public.pet_photo_access(object_name TEXT)
RETURNS BOOLEAN AS $$
    SELECT CASE
        WHEN (storage.foldername(object_name))[1] ~ '^[0-9]+$'
            THEN public.user_has_pet_access(((storage.foldername(object_name))[1])::INT)
        ELSE false
    END;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

DROP POLICY IF EXISTS "pet_photos_select" ON storage.objects;
CREATE POLICY "pet_photos_select" ON storage.objects
    FOR SELECT USING (bucket_id = 'pet-photos' AND public.pet_photo_access(name));

DROP POLICY IF EXISTS "pet_photos_insert" ON storage.objects;
CREATE POLICY "pet_photos_insert" ON storage.objects
    FOR INSERT WITH CHECK (bucket_id = 'pet-photos' AND public.pet_photo_access(name));

DROP POLICY IF EXISTS "pet_photos_update" ON storage.objects;
CREATE POLICY "pet_photos_update" ON storage.objects
    FOR UPDATE USING (bucket_id = 'pet-photos' AND public.pet_photo_access(name));

DROP POLICY IF EXISTS "pet_photos_delete" ON storage.objects;
CREATE POLICY "pet_photos_delete" ON storage.objects
    FOR DELETE USING (bucket_id = 'pet-photos' AND public.pet_photo_access(name));
