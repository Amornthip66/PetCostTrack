-- =====================================================================
-- Migration: จำกัดผู้ร่วมดูแลสูงสุด 3 คน และคำเชิญหมดอายุใน 7 วัน
--
-- ไฟล์นี้สร้างคืนจากสถานะฐานข้อมูลจริง (Supabase) ณ 13 ต.ค. 2569 เพราะตอนรัน
-- migration นี้ครั้งแรก ประวัติไม่ได้บันทึกคำสั่งไว้ (supabase_migrations มีแค่เลขเวอร์ชัน)
--
-- ค่าคงที่ของกฎอยู่ในฟังก์ชันที่เดียว ทั้งตอนเชิญและตอนตอบรับอ่านจากฟังก์ชันเดียวกัน
-- คำเชิญที่ยังรอตอบรับ (และยังไม่หมดอายุ) นับรวมในโควตาด้วย
-- รันซ้ำได้ (idempotent)
-- =====================================================================

CREATE OR REPLACE FUNCTION public.invitation_expiry_days()
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
AS $function$ SELECT 7; $function$;

CREATE OR REPLACE FUNCTION public.max_co_caretakers()
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
AS $function$ SELECT 3; $function$;

CREATE OR REPLACE FUNCTION public.invite_co_caretaker(p_pet_id integer, p_email text)
 RETURNS pet_invitations
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_owner_id  INT := auth_user_id();
    v_target_id INT;
    v_taken     INT;
    v_row       pet_invitations;
BEGIN
    IF v_owner_id IS NULL THEN
        RAISE EXCEPTION 'ต้องเข้าสู่ระบบก่อน';
    END IF;
    IF NOT user_is_pet_owner(p_pet_id) THEN
        RAISE EXCEPTION 'คุณไม่ใช่เจ้าของสัตว์เลี้ยงตัวนี้ จึงเชิญสมาชิกไม่ได้';
    END IF;
    SELECT user_id INTO v_target_id FROM users WHERE email = p_email LIMIT 1;
    IF v_target_id IS NULL THEN
        RAISE EXCEPTION 'ไม่พบผู้ใช้ที่ใช้อีเมลนี้ในระบบ กรุณาให้สมาชิกลงทะเบียนก่อน แล้วลองอีกครั้ง';
    END IF;
    IF v_target_id = v_owner_id THEN
        RAISE EXCEPTION 'ไม่สามารถเชิญตัวเองได้';
    END IF;
    IF EXISTS (SELECT 1 FROM pet_access WHERE pet_id = p_pet_id AND user_id = v_target_id) THEN
        RAISE EXCEPTION 'สมาชิกคนนี้อยู่ในรายชื่อผู้ดูแลของสัตว์เลี้ยงตัวนี้อยู่แล้ว';
    END IF;
    SELECT
        (SELECT COUNT(*) FROM pet_access
          WHERE pet_id = p_pet_id AND access_role = 'Co-caretaker')
      + (SELECT COUNT(*) FROM pet_invitations
          WHERE pet_id = p_pet_id AND status = 'pending' AND invited_user_id <> v_target_id
            AND created_at >= now() - (invitation_expiry_days() * INTERVAL '1 day'))
    INTO v_taken;
    IF v_taken >= max_co_caretakers() THEN
        RAISE EXCEPTION 'สัตว์เลี้ยงตัวนี้มีผู้ร่วมดูแล (รวมคำเชิญที่รอตอบรับ) ครบ % คนแล้ว', max_co_caretakers();
    END IF;
    INSERT INTO pet_invitations (pet_id, invited_user_id, invited_by, status, created_at, responded_at)
    VALUES (p_pet_id, v_target_id, v_owner_id, 'pending', CURRENT_TIMESTAMP, NULL)
    ON CONFLICT (pet_id, invited_user_id) DO UPDATE
        SET status = 'pending', invited_by = v_owner_id, created_at = CURRENT_TIMESTAMP, responded_at = NULL
    RETURNING * INTO v_row;
    RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.accept_pet_invitation(p_invitation_id integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_uid     INT := auth_user_id();
    v_pet_id  INT;
    v_created TIMESTAMP;
BEGIN
    SELECT pet_id, created_at INTO v_pet_id, v_created FROM pet_invitations
        WHERE invitation_id = p_invitation_id AND invited_user_id = v_uid AND status = 'pending';
    IF v_pet_id IS NULL THEN
        RAISE EXCEPTION 'ไม่พบคำเชิญนี้ หรือดำเนินการไปแล้ว';
    END IF;
    IF v_created < now() - (invitation_expiry_days() * INTERVAL '1 day') THEN
        RAISE EXCEPTION 'คำเชิญนี้หมดอายุแล้ว (เกิน % วัน) กรุณาให้เจ้าของสัตว์เลี้ยงเชิญใหม่', invitation_expiry_days();
    END IF;
    IF (SELECT COUNT(*) FROM pet_access WHERE pet_id = v_pet_id AND access_role = 'Co-caretaker') >= max_co_caretakers() THEN
        RAISE EXCEPTION 'สัตว์เลี้ยงตัวนี้มีผู้ร่วมดูแลครบ % คนแล้ว', max_co_caretakers();
    END IF;
    INSERT INTO pet_access (pet_id, user_id, access_role)
    VALUES (v_pet_id, v_uid, 'Co-caretaker')
    ON CONFLICT DO NOTHING;
    UPDATE pet_invitations SET status = 'accepted', responded_at = CURRENT_TIMESTAMP
        WHERE invitation_id = p_invitation_id;
END;
$function$;
