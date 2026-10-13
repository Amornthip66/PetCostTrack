-- =====================================================================
-- Migration: เลื่อนการแจ้งเตือนที่เกิดซ้ำไปรอบถัดไปเมื่อทำเสร็จ
--
-- ไฟล์นี้สร้างคืนจากสถานะฐานข้อมูลจริง (Supabase) ณ 13 ต.ค. 2569 เพราะตอนรัน
-- migration นี้ครั้งแรก ประวัติไม่ได้บันทึกคำสั่งไว้ (supabase_migrations มีแค่เลขเวอร์ชัน)
--
-- complete_reminder() เป็น SECURITY INVOKER จึงผ่าน RLS reminders_update ตามปกติ
-- (เฉพาะ Owner) ถ้าไม่มีสิทธิ์จะไม่มีแถวถูกแก้และแจ้ง error ภาษาไทย
-- รันซ้ำได้ (idempotent)
-- =====================================================================

CREATE OR REPLACE FUNCTION public.complete_reminder(p_task_id integer)
 RETURNS SETOF reminders
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
    v_row public.reminders;
BEGIN
    UPDATE public.reminders
    SET next_due_date = (next_due_date + CASE frequency
                            WHEN 'รายเดือน' THEN INTERVAL '1 month'
                            ELSE INTERVAL '1 year'
                         END)::DATE,
        is_completed = FALSE,
        last_notified_at = NULL
    WHERE task_id = p_task_id
    RETURNING * INTO v_row;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'ไม่พบรายการแจ้งเตือนนี้ หรือคุณไม่มีสิทธิ์ (เฉพาะเจ้าของสัตว์เลี้ยงเท่านั้น)';
    END IF;
    RETURN NEXT v_row;
END;
$function$;
