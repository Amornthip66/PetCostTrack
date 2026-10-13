-- =====================================================================
-- Migration: ถอนสิทธิ์เรียกฟังก์ชันจากผู้ที่ไม่ได้ล็อกอิน
--
-- ไฟล์นี้สร้างคืนจากสถานะฐานข้อมูลจริง (Supabase) ณ 13 ต.ค. 2569 เพราะตอนรัน
-- migration นี้ครั้งแรก ประวัติไม่ได้บันทึกคำสั่งไว้ (supabase_migrations มีแค่เลขเวอร์ชัน)
--
-- - ทุกฟังก์ชันที่มีอยู่ ณ ตอนนั้น: ถอนจาก PUBLIC และ anon ให้เฉพาะ authenticated/service_role
-- - find_user_by_email / get_user_pet_ids: ไม่มีหน้าเว็บเรียกแล้ว และเปิดให้ค้นอีเมล
--   ผู้ใช้อื่นได้ จึงถอนจาก authenticated ด้วย
-- (ฟังก์ชันที่สร้างหลังจากนี้ต้อง REVOKE เองในไฟล์ของตัวเอง)
-- รันซ้ำได้ (idempotent)
-- =====================================================================

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.find_user_by_email(text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.get_user_pet_ids(integer) FROM authenticated;
