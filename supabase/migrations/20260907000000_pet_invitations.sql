-- =====================================================================
-- ส่วนที่ 11: คำเชิญเป็นผู้ร่วมดูแล (Pet Co-caretaker Invitations)
-- เดิม "เชิญสมาชิก" ใน pets.html/profile.html เพิ่มสิทธิ์ Co-caretaker ให้ทันที
-- โดยที่อีกฝ่ายไม่ได้ตอบรับอะไรเลย เปลี่ยนเป็นระบบคำเชิญที่ต้องรอผู้ถูกเชิญ
-- กดตอบรับ/ปฏิเสธก่อน ถึงจะได้สิทธิ์ Co-caretaker จริง และให้คำเชิญที่ค้างอยู่
-- ไปแสดงอยู่บนสุดของหน้า "การแจ้งเตือน" (reminders.html) แยกจากรายการแจ้งเตือน
-- ปกติให้ชัดเจน (ดู js/reminders.js + reminders.html ที่แก้คู่กัน)
-- =====================================================================

-- 1. ตาราง pet_invitations
CREATE TABLE pet_invitations (
    invitation_id   INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    pet_id          INT NOT NULL REFERENCES pets(pet_id)   ON DELETE CASCADE  ON UPDATE CASCADE,
    invited_user_id INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE  ON UPDATE CASCADE,
    invited_by      INT REFERENCES users(user_id)          ON DELETE SET NULL ON UPDATE CASCADE,
    status          VARCHAR(10) NOT NULL DEFAULT 'pending',
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    responded_at    TIMESTAMP,

    CONSTRAINT chk_pet_invitations_status CHECK (status IN ('pending', 'accepted', 'declined')),
    -- คนคนเดียวมีคำเชิญค้างอยู่กับสัตว์เลี้ยงตัวเดียวกันได้แค่ 1 แถว (เชิญซ้ำ = อัปเดตแถวเดิม
    -- กลับเป็น pending แทนที่จะสร้างแถวใหม่ซ้อนกันเรื่อยๆ — ดู invite_co_caretaker() ด้านล่าง)
    CONSTRAINT uq_pet_invitations_pet_user UNIQUE (pet_id, invited_user_id)
);

ALTER TABLE pet_invitations ENABLE ROW LEVEL SECURITY;

-- เห็นคำเชิญได้เฉพาะ: ผู้ถูกเชิญเอง (เพื่อไปแสดงในหน้า reminders) หรือเจ้าของสัตว์เลี้ยง
-- ตัวนั้น (เพื่อดูสถานะคำเชิญที่ตัวเองส่งไปในหน้าจัดการครอบครัว)
CREATE POLICY "pet_invitations_select" ON pet_invitations FOR SELECT USING (
    invited_user_id = auth_user_id()
    OR user_is_pet_owner(pet_id)
);

-- ไม่เปิด INSERT/UPDATE/DELETE ตรงๆ ผ่าน REST เลย — ทุกการเปลี่ยนแปลงสถานะต้องผ่าน
-- RPC function ด้านล่าง (SECURITY DEFINER) เพื่อบังคับ validation ฝั่งเซิร์ฟเวอร์เสมอ
-- (เช่น ต้องเป็นเจ้าของจริงถึงเชิญได้, ต้องเป็นผู้ถูกเชิญจริงถึงตอบรับ/ปฏิเสธได้)

-- 2. RPC: เจ้าของสัตว์เลี้ยงส่งคำเชิญ (แทนการเพิ่ม pet_access ทันที)
CREATE OR REPLACE FUNCTION invite_co_caretaker(p_pet_id INT, p_email TEXT)
RETURNS pet_invitations AS $$
DECLARE
    v_owner_id  INT := auth_user_id();
    v_target_id INT;
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

    INSERT INTO pet_invitations (pet_id, invited_user_id, invited_by, status, created_at, responded_at)
    VALUES (p_pet_id, v_target_id, v_owner_id, 'pending', CURRENT_TIMESTAMP, NULL)
    ON CONFLICT (pet_id, invited_user_id) DO UPDATE
        SET status = 'pending', invited_by = v_owner_id, created_at = CURRENT_TIMESTAMP, responded_at = NULL
    RETURNING * INTO v_row;

    RETURN v_row;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION invite_co_caretaker(INT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION invite_co_caretaker(INT, TEXT) TO authenticated;

-- 3. RPC: ผู้ถูกเชิญกดตอบรับ -> ได้สิทธิ์ Co-caretaker จริงตอนนี้เท่านั้น
CREATE OR REPLACE FUNCTION accept_pet_invitation(p_invitation_id INT)
RETURNS VOID AS $$
DECLARE
    v_uid    INT := auth_user_id();
    v_pet_id INT;
BEGIN
    SELECT pet_id INTO v_pet_id FROM pet_invitations
        WHERE invitation_id = p_invitation_id AND invited_user_id = v_uid AND status = 'pending';
    IF v_pet_id IS NULL THEN
        RAISE EXCEPTION 'ไม่พบคำเชิญนี้ หรือดำเนินการไปแล้ว';
    END IF;

    INSERT INTO pet_access (pet_id, user_id, access_role)
    VALUES (v_pet_id, v_uid, 'Co-caretaker')
    ON CONFLICT DO NOTHING;

    UPDATE pet_invitations SET status = 'accepted', responded_at = CURRENT_TIMESTAMP
        WHERE invitation_id = p_invitation_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION accept_pet_invitation(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION accept_pet_invitation(INT) TO authenticated;

-- 4. RPC: ผู้ถูกเชิญกดปฏิเสธ
CREATE OR REPLACE FUNCTION decline_pet_invitation(p_invitation_id INT)
RETURNS VOID AS $$
DECLARE
    v_uid INT := auth_user_id();
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pet_invitations
        WHERE invitation_id = p_invitation_id AND invited_user_id = v_uid AND status = 'pending'
    ) THEN
        RAISE EXCEPTION 'ไม่พบคำเชิญนี้ หรือดำเนินการไปแล้ว';
    END IF;

    UPDATE pet_invitations SET status = 'declined', responded_at = CURRENT_TIMESTAMP
        WHERE invitation_id = p_invitation_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION decline_pet_invitation(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION decline_pet_invitation(INT) TO authenticated;

-- 5. RPC: เจ้าของสัตว์เลี้ยงยกเลิกคำเชิญที่ยังค้างอยู่ (เผื่อเชิญผิดคน/เปลี่ยนใจ)
CREATE OR REPLACE FUNCTION cancel_pet_invitation(p_invitation_id INT)
RETURNS VOID AS $$
DECLARE
    v_pet_id INT;
BEGIN
    SELECT pet_id INTO v_pet_id FROM pet_invitations
        WHERE invitation_id = p_invitation_id AND status = 'pending';
    IF v_pet_id IS NULL OR NOT user_is_pet_owner(v_pet_id) THEN
        RAISE EXCEPTION 'ไม่พบคำเชิญนี้ หรือคุณไม่มีสิทธิ์ยกเลิก';
    END IF;

    DELETE FROM pet_invitations WHERE invitation_id = p_invitation_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION cancel_pet_invitation(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cancel_pet_invitation(INT) TO authenticated;
