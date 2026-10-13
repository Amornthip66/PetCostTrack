-- =====================================================================
-- Migration: ปรับการแจ้งเตือน — PET-314, PET-316
--
-- 1. reminders.notify_days_before (F-05 AC ข้อ I): จำนวนวันก่อนวันครบกำหนดที่เริ่มแจ้งเตือน
--    - ค่าเริ่มต้น 7 วัน (ตรงกับ Scenario 3 และค่าที่ใช้อยู่เดิม) แถวเดิมจึงได้ 7 อัตโนมัติ
--    - 0 = แจ้งเฉพาะวันที่ครบกำหนด, สูงสุด 60 วัน
--    ใช้ที่ฟอร์มเพิ่มการแจ้งเตือน, toast (js/notifications.js) และอีเมล (Edge Function)
-- 2. complete_reminder(): ปุ่ม "เสร็จแล้ว" เลื่อนไปรอบแรกที่ยังไม่ผ่าน (นับวันตามเวลาไทย)
--    เดิมบวก 1 รอบจากวันครบกำหนดเดิมเสมอ ถ้ากดช้า รอบใหม่ก็ยังเลยกำหนดอยู่
--    (เช่น รายเดือนครบ 31 ส.ค. กดวันที่ 13 ต.ค. เดิมได้ 30 ก.ย. ตอนนี้ได้ 31 ต.ค.)
--    ใช้วิธีคำนวณเดียวกับ procedure rollover_completed_reminders()
--    ยังเป็น SECURITY INVOKER: Co-caretaker ไม่ผ่าน RLS reminders_update จึงได้ error ภาษาไทย
-- รันซ้ำได้ (idempotent)
-- =====================================================================

ALTER TABLE public.reminders
    ADD COLUMN IF NOT EXISTS notify_days_before SMALLINT NOT NULL DEFAULT 7;

ALTER TABLE public.reminders DROP CONSTRAINT IF EXISTS chk_reminders_notify_days;
ALTER TABLE public.reminders ADD CONSTRAINT chk_reminders_notify_days
    CHECK (notify_days_before BETWEEN 0 AND 60);

COMMENT ON COLUMN public.reminders.notify_days_before IS
    'จำนวนวันก่อนวันครบกำหนดที่เริ่มแจ้งเตือน (0–60, ค่าเริ่มต้น 7)';

CREATE OR REPLACE FUNCTION public.complete_reminder(p_task_id integer)
 RETURNS SETOF reminders
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
    v_today date := (now() AT TIME ZONE 'Asia/Bangkok')::date;
    v_rem   public.reminders;
    v_step  interval;
    v_n     integer := 1;
    v_row   public.reminders;
BEGIN
    SELECT * INTO v_rem FROM public.reminders WHERE task_id = p_task_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'ไม่พบรายการแจ้งเตือนนี้ หรือคุณไม่มีสิทธิ์ (เฉพาะเจ้าของสัตว์เลี้ยงเท่านั้น)';
    END IF;
    v_step := CASE v_rem.frequency WHEN 'รายเดือน' THEN INTERVAL '1 month' ELSE INTERVAL '1 year' END;
    WHILE (v_rem.next_due_date + v_n * v_step)::date < v_today LOOP
        v_n := v_n + 1;
    END LOOP;
    UPDATE public.reminders
    SET next_due_date    = (v_rem.next_due_date + v_n * v_step)::date,
        is_completed     = FALSE,
        last_notified_at = NULL
    WHERE task_id = p_task_id
    RETURNING * INTO v_row;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'ไม่พบรายการแจ้งเตือนนี้ หรือคุณไม่มีสิทธิ์ (เฉพาะเจ้าของสัตว์เลี้ยงเท่านั้น)';
    END IF;
    RETURN NEXT v_row;
END;
$function$;
