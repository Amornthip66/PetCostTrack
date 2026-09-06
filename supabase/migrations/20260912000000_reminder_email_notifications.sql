-- =====================================================================
-- Migration: รองรับการแจ้งเตือนทางอีเมลสำหรับ reminders (ข้อ 3.4)
--
-- ที่มา: proposal (F-05 / Constraint แจ้งเตือน) แนะนำให้แจ้งเตือนแบบผสมผสาน
-- LINE Notify + อีเมล แต่ LINE Notify ถูกปิดให้บริการถาวรตั้งแต่ 31 มี.ค. 2025
-- (ประกาศทางการของ LINE Developers) ช่องทางภายนอกที่ทำต่อในเวอร์ชันนี้จึงเป็น
-- อีเมลผ่าน Supabase Edge Function (ดู supabase/functions/send-reminder-emails/)
--
-- คอลัมน์ last_notified_at ใช้กันไม่ให้ Edge Function ส่งอีเมลซ้ำทุกครั้งที่ cron
-- รัน (เช่น รันทุกวัน) สำหรับ reminder เดิมที่เพิ่งแจ้งไปแล้วในรอบล่าสุด
--
-- ขอบเขต: เพิ่มคอลัมน์ใหม่แบบ NULLABLE ในตาราง reminders เท่านั้น ไม่มีการลบ/แก้ไข
-- คอลัมน์เดิม ไม่กระทบ query เดิมที่ระบุชื่อคอลัมน์ตรงๆ (js/reminders.js) เพราะไม่มี
-- ที่ไหนใช้ select=* กับตารางนี้ และไม่แก้ RLS policy ของ reminders เลย
--
-- รันซ้ำได้ (idempotent)
-- =====================================================================

ALTER TABLE public.reminders
    ADD COLUMN IF NOT EXISTS last_notified_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.reminders.last_notified_at IS
    'เวลาที่ส่งอีเมลแจ้งเตือนล่าสุดสำหรับ reminder นี้ (เขียนโดย Edge Function send-reminder-emails เท่านั้น ใช้ service-role key ซึ่งไม่ผ่าน RLS ปกติของผู้ใช้)';
