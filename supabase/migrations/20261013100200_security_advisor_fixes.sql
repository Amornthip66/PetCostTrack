-- =====================================================================
-- Migration: แก้คำเตือนของ Supabase Security Advisor — PET-319
--
-- 1. function_search_path_mutable (10 ฟังก์ชัน): ล็อก search_path = public
-- 2. anon_security_definer_function_executable: pet_photo_access() เรียกได้จาก anon
--    → ถอนสิทธิ์ และจำกัดชื่อโฟลเดอร์ที่เป็นตัวเลขไม่เกิน 9 หลัก (กัน integer overflow)
-- 3. ฟังก์ชันของ Trigger ไม่ต้องให้ผู้ใช้เรียกตรงผ่าน /rest/v1/rpc ได้
--    (PostgreSQL ไม่ตรวจสิทธิ์ EXECUTE ตอน Trigger ทำงาน Trigger จึงยังทำงานตามเดิม)
-- 4. ฟังก์ชันที่สร้างใหม่ในอนาคตจะไม่ได้สิทธิ์ EXECUTE ให้ anon/PUBLIC อัตโนมัติ
--
-- ที่ยังเหลือโดยตั้งใจ:
--   - authenticated เรียก SECURITY DEFINER ได้: เป็น RPC ที่หน้าเว็บใช้ และฟังก์ชันตรวจสิทธิ์
--     ที่ RLS เรียก (ต้องเป็น SECURITY DEFINER เพื่อไม่ให้ RLS วนซ้ำ)
--   - Leaked Password Protection: ตั้งที่ Dashboard และต้องใช้ Supabase Pro Plan ขึ้นไป
-- รันซ้ำได้ (idempotent)
-- =====================================================================

-- 1. search_path
ALTER FUNCTION public.auth_user_id() SET search_path = public;
ALTER FUNCTION public.user_has_pet_access(integer) SET search_path = public;
ALTER FUNCTION public.user_is_pet_owner(integer) SET search_path = public;
ALTER FUNCTION public.users_share_pet(integer) SET search_path = public;
ALTER FUNCTION public.get_user_pet_ids(integer) SET search_path = public;
ALTER FUNCTION public.storage_path_pet_id(text) SET search_path = public;
ALTER FUNCTION public.expense_edit_window_days() SET search_path = public;
ALTER FUNCTION public.invitation_expiry_days() SET search_path = public;
ALTER FUNCTION public.max_co_caretakers() SET search_path = public;

-- 2. pet_photo_access(): เหมือนเดิมทุกอย่าง ยกเว้น {1,9} และ search_path
CREATE OR REPLACE FUNCTION public.pet_photo_access(object_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT CASE
        WHEN (storage.foldername(object_name))[1] ~ '^[0-9]{1,9}$'
            THEN public.user_has_pet_access(((storage.foldername(object_name))[1])::INT)
        ELSE false
    END;
$function$;

REVOKE EXECUTE ON FUNCTION public.pet_photo_access(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pet_photo_access(text) TO authenticated, service_role;

-- 3. ฟังก์ชันของ Trigger
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_pet_access_update() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prevent_non_owner_archive() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_expense_recorder_role() FROM PUBLIC, anon, authenticated;

-- 4. ค่าเริ่มต้นของฟังก์ชันที่สร้างใหม่ (มีผลกับฟังก์ชันที่บทบาทปัจจุบันสร้าง)
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
