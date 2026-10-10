-- =====================================================================
-- Stored Procedures สำหรับงานบำรุงรักษาข้อมูลของ PetCostTrack
-- เรียกด้วย CALL จาก SQL Editor หรือ pg_cron (PostgREST เรียก procedure ไม่ได้)
-- =====================================================================

-- 1) BR-03: คัดลอกงบประมาณของเดือนก่อนไปเป็นงบของเดือนที่ระบุ (ค่าเริ่มต้น = เดือนปัจจุบันตามเวลาไทย)
--    ไม่ทับงบที่ผู้ใช้ตั้งเองไว้แล้ว และข้ามสัตว์เลี้ยงที่เก็บเข้าคลัง
CREATE OR REPLACE PROCEDURE public.carry_over_monthly_budgets(
    IN    p_year    integer DEFAULT NULL,
    IN    p_month   integer DEFAULT NULL,
    INOUT p_created integer DEFAULT 0
)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $procedure$
DECLARE
    v_today date    := (now() AT TIME ZONE 'Asia/Bangkok')::date;
    v_year  integer := COALESCE(p_year,  EXTRACT(YEAR  FROM v_today)::int);
    v_month integer := COALESCE(p_month, EXTRACT(MONTH FROM v_today)::int);
    v_prev  date;
BEGIN
    IF v_month NOT BETWEEN 1 AND 12 THEN
        RAISE EXCEPTION 'เดือนต้องอยู่ระหว่าง 1 ถึง 12 (ได้รับ %)', v_month;
    END IF;
    v_prev := make_date(v_year, v_month, 1) - INTERVAL '1 month';

    INSERT INTO budgets (pet_id, budget_limit, budget_month, budget_year)
    SELECT b.pet_id, b.budget_limit, v_month, v_year
    FROM budgets b
    JOIN pets p ON p.pet_id = b.pet_id
    WHERE b.budget_month = EXTRACT(MONTH FROM v_prev)
      AND b.budget_year  = EXTRACT(YEAR  FROM v_prev)
      AND NOT p.is_archived
    ON CONFLICT (pet_id, budget_month, budget_year) DO NOTHING;

    GET DIAGNOSTICS p_created = ROW_COUNT;
    RAISE NOTICE 'คัดลอกงบประมาณไปเดือน %/% แล้ว % รายการ', v_month, v_year, p_created;
END;
$procedure$;

-- 2) เลื่อนการแจ้งเตือนที่ผู้ใช้กด "เสร็จแล้ว" (is_completed = true) ไปรอบถัดไปที่ยังไม่ผ่าน
--    นับรอบจากวันครบกำหนดเดิม (เดิม + n รอบ) เพื่อไม่ให้วันที่เลื่อนเพี้ยนตอนข้ามเดือนที่มีไม่ถึง 31 วัน
CREATE OR REPLACE PROCEDURE public.rollover_completed_reminders(
    INOUT p_rolled integer DEFAULT 0
)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $procedure$
DECLARE
    v_today date := (now() AT TIME ZONE 'Asia/Bangkok')::date;
    v_step  interval;
    v_n     integer;
    r       record;
BEGIN
    p_rolled := 0;
    FOR r IN SELECT task_id, frequency, next_due_date
             FROM reminders WHERE is_completed ORDER BY task_id FOR UPDATE
    LOOP
        v_step := CASE r.frequency WHEN 'รายเดือน' THEN INTERVAL '1 month' ELSE INTERVAL '1 year' END;
        v_n := 1;
        WHILE (r.next_due_date + v_n * v_step)::date < v_today LOOP
            v_n := v_n + 1;
        END LOOP;
        UPDATE reminders
        SET next_due_date    = (r.next_due_date + v_n * v_step)::date,
            is_completed     = FALSE,
            last_notified_at = NULL
        WHERE task_id = r.task_id;
        p_rolled := p_rolled + 1;
    END LOOP;
    RAISE NOTICE 'เลื่อนการแจ้งเตือนที่ทำเสร็จแล้วไปรอบถัดไป % รายการ', p_rolled;
END;
$procedure$;

-- 3) ลบคำเชิญที่ยังรอตอบรับแต่หมดอายุแล้ว (ค่าเริ่มต้นใช้ invitation_expiry_days() = 7 วัน)
CREATE OR REPLACE PROCEDURE public.purge_expired_invitations(
    IN    p_older_than_days integer DEFAULT NULL,
    INOUT p_deleted         integer DEFAULT 0
)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $procedure$
DECLARE
    v_days integer := COALESCE(p_older_than_days, invitation_expiry_days());
BEGIN
    IF v_days < 1 THEN
        RAISE EXCEPTION 'จำนวนวันต้องมากกว่า 0 (ได้รับ %)', v_days;
    END IF;
    DELETE FROM pet_invitations
    WHERE status = 'pending'
      AND created_at < now() - v_days * INTERVAL '1 day';
    GET DIAGNOSTICS p_deleted = ROW_COUNT;
    RAISE NOTICE 'ลบคำเชิญที่รอตอบรับเกิน % วันแล้ว % รายการ', v_days, p_deleted;
END;
$procedure$;

-- 4) รวมงานบำรุงรักษาประจำวัน งบประมาณคัดลอกเฉพาะวันที่ 1 ของเดือนตาม BR-03
CREATE OR REPLACE PROCEDURE public.run_daily_maintenance()
LANGUAGE plpgsql
SET search_path TO 'public'
AS $procedure$
DECLARE
    v_today       date    := (now() AT TIME ZONE 'Asia/Bangkok')::date;
    v_budgets     integer := 0;
    v_reminders   integer := 0;
    v_invitations integer := 0;
BEGIN
    IF EXTRACT(DAY FROM v_today) = 1 THEN
        CALL carry_over_monthly_budgets(NULL, NULL, v_budgets);
    END IF;
    CALL rollover_completed_reminders(v_reminders);
    CALL purge_expired_invitations(NULL, v_invitations);
    RAISE NOTICE 'สรุปวันที่ %: งบประมาณใหม่ %, การแจ้งเตือนที่เลื่อนรอบ %, คำเชิญที่ลบ %',
        v_today, v_budgets, v_reminders, v_invitations;
END;
$procedure$;

-- งานบำรุงรักษาสำหรับผู้ดูแลระบบเท่านั้น ไม่ให้ผู้ใช้ทั่วไปเรียก
REVOKE EXECUTE ON PROCEDURE public.carry_over_monthly_budgets(integer, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON PROCEDURE public.rollover_completed_reminders(integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON PROCEDURE public.purge_expired_invitations(integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON PROCEDURE public.run_daily_maintenance() FROM PUBLIC, anon, authenticated;
