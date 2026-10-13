-- =====================================================================
-- Migration: คงชื่อผู้บันทึกรายจ่ายไว้หลังถูกถอดสิทธิ์ (BR-06) — PET-313
--
-- เดิม users_select ให้เห็นเฉพาะตัวเอง และผู้ที่ "ยังดูแลสัตว์เลี้ยงร่วมกันอยู่"
-- (users_share_pet) พอ Owner ถอดสิทธิ์ Co-caretaker ออก รายจ่ายที่คนนั้นเคยบันทึก
-- ยังอยู่ แต่ join users(name) ได้ NULL หน้าประวัติจึงขึ้น "ไม่ทราบชื่อ"
--
-- เพิ่มเงื่อนไขให้เห็นแถว users ของ:
--   1. ผู้ที่บันทึกรายจ่ายของสัตว์เลี้ยงที่ฉันมีสิทธิ์ (รวมรายจ่ายที่แบ่งมาให้สัตว์ของฉัน)
--   2. ผู้ที่ส่งคำเชิญที่ยังรอตอบรับถึงฉัน (หน้าการแจ้งเตือนจะแสดงชื่อผู้เชิญได้)
-- ผู้ใช้ที่ไม่เกี่ยวข้องกันยังมองไม่เห็นกันเหมือนเดิม
-- รันซ้ำได้ (idempotent)
-- =====================================================================

CREATE OR REPLACE FUNCTION public.user_name_visible(check_user_id integer)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT EXISTS (
        SELECT 1 FROM expenses e
        WHERE e.user_id = check_user_id
          AND (user_has_pet_access(e.pet_id) OR expense_shared_with_me(e.transaction_id))
    ) OR EXISTS (
        SELECT 1 FROM pet_invitations i
        WHERE i.invited_by = check_user_id
          AND i.invited_user_id = auth_user_id()
          AND i.status = 'pending'
    );
$function$;

REVOKE EXECUTE ON FUNCTION public.user_name_visible(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_name_visible(integer) TO authenticated, service_role;

DROP POLICY IF EXISTS users_select ON public.users;
CREATE POLICY users_select ON public.users
    FOR SELECT USING ((auth_id = auth.uid()) OR users_share_pet(user_id) OR user_name_visible(user_id));
