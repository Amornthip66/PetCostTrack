-- =====================================================================
-- Migration: ตั้งเวลางานประจำวันด้วย pg_cron — PET-314, PET-315, PET-318
--
-- 1. petcosttrack-daily-maintenance  ทุกวัน 00:05 น. เวลาไทย (17:05 UTC)
--    CALL run_daily_maintenance() → คัดลอกงบ (วันที่ 1), เลื่อนรอบแจ้งเตือนที่ค้าง,
--    ลบคำเชิญที่หมดอายุ
-- 2. petcosttrack-reminder-emails    ทุกวัน 07:00 น. เวลาไทย (00:00 UTC)
--    เรียก Edge Function send-reminder-emails ผ่าน pg_net
--
-- ต้องทำก่อนรันไฟล์นี้ (ครั้งเดียว ใน SQL Editor — ไม่เก็บค่าจริงไว้ใน repo):
--   select vault.create_secret('https://<project-ref>.supabase.co', 'petcosttrack_project_url');
--   select vault.create_secret('<สตริงสุ่มยาวๆ>', 'petcosttrack_cron_secret');
-- และตั้งค่าเดียวกันเป็น secret ของ Edge Function:
--   supabase secrets set CRON_SECRET=<สตริงสุ่มยาวๆ เดียวกัน>
-- (ดูขั้นตอนเต็มใน supabase/functions/send-reminder-emails/README.md)
--
-- cron.schedule() ที่ใช้ชื่อเดิมจะแทนที่งานเดิม รันซ้ำได้ (idempotent)
-- =====================================================================

-- pg_cron สร้าง schema cron ของตัวเอง; pg_net ลงใน schema extensions ตามแนวทาง Supabase
-- (ไม่ลงใน public เพื่อไม่ให้ Security Advisor เตือน extension_in_public)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

SELECT cron.schedule(
    'petcosttrack-daily-maintenance',
    '5 17 * * *',
    'CALL public.run_daily_maintenance();'
);

SELECT cron.schedule(
    'petcosttrack-reminder-emails',
    '0 0 * * *',
    $job$
    SELECT net.http_post(
        url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'petcosttrack_project_url')
                   || '/functions/v1/send-reminder-emails',
        headers := jsonb_build_object(
                       'Content-Type', 'application/json',
                       'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'petcosttrack_cron_secret')
                   ),
        body    := '{}'::jsonb
    ) AS request_id;
    $job$
);
