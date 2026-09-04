-- =====================================================================
-- ส่วนที่ 9: จัดการครอบครัว (Family Management)
-- เพิ่ม Owner สามารถเชิญสมาชิกครอบครัว (ที่ลงทะเบียนแล้ว) ให้เป็น
-- Co-caretaker ร่วมดูแลสัตว์เลี้ยงได้ผ่านอีเมล
-- =====================================================================

-- 1. RPC: ค้นหาผู้ใช้จากอีเมล (ตรงเป๊ะเท่านั้น) สำหรับใช้ตอนเชิญสมาชิก
--    ใช้ SECURITY DEFINER เพื่อ bypass policy "users_select" ที่ปกติเห็นได้
--    เฉพาะคนที่มีสัตว์เลี้ยงร่วมกันอยู่แล้ว (ซึ่งตอนเชิญยังไม่มีสัตว์เลี้ยงร่วมกัน)
--    จำกัดสิทธิ์ให้เฉพาะ authenticated (ไม่ให้ anon เรียกได้) และค้นได้ทีละอีเมลที่รู้แน่ชัดเท่านั้น
CREATE OR REPLACE FUNCTION find_user_by_email(p_email TEXT)
RETURNS TABLE(user_id INT, name TEXT, email TEXT) AS $$
    SELECT user_id, name, email FROM users WHERE email = p_email LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION find_user_by_email(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION find_user_by_email(TEXT) TO authenticated;

-- 2. แก้ pet_access_insert: เดิมอนุญาตให้ authenticated user ใดๆ เพิ่มแถวให้ user_id ไหนก็ได้
--    (auth.uid() IS NOT NULL) ซึ่งกว้างเกินไป ปรับให้เพิ่มได้เฉพาะ:
--      - เพิ่มตัวเอง (ตอนสร้างสัตว์เลี้ยงใหม่ ผู้สร้างต้องเพิ่มตัวเองเป็น Owner)
--      - หรือเป็น Owner ของสัตว์เลี้ยงตัวนั้นอยู่แล้ว (เชิญสมาชิกครอบครัวเป็น Co-caretaker)
DROP POLICY IF EXISTS "pet_access_insert" ON pet_access;
CREATE POLICY "pet_access_insert" ON pet_access FOR INSERT WITH CHECK (
    user_id = auth_user_id()
    OR user_is_pet_owner(pet_id)
);
