-- =====================================================================
-- PetCostTrack — ชุดแก้ไข Sprint 3 (ไฟล์ 2/2) ตั้งเวลางานประจำวันด้วย pg_cron
-- = migration 20261013100300_schedule_daily_jobs.sql
--
-- ทำตามลำดับก่อนรันไฟล์นี้:
--   1. Deploy Edge Function และตั้ง secret (ดู supabase/functions/send-reminder-emails/README.md)
--   2. สร้าง Vault secret 2 ค่า — แก้ <...> เป็นค่าจริงแล้วรัน 2 บรรทัดนี้ครั้งเดียว
--      (ลบ -- หน้าบรรทัดออกก่อนรัน และอย่า commit ค่าจริงลง repo)
--
-- select vault.create_secret('https://slnakwquneyczqhxyfqb.supabase.co', 'petcosttrack_project_url');
-- select vault.create_secret('<สตริงสุ่มเดียวกับ CRON_SECRET ของ Edge Function>', 'petcosttrack_cron_secret');
--
--   3. รันส่วนที่เหลือของไฟล์นี้
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

-- ตรวจผล: ต้องมีงาน 2 รายการ
SELECT jobname, schedule, active FROM cron.job WHERE jobname LIKE 'petcosttrack-%' ORDER BY jobname;
-- ตรวจว่ามี Vault secret ครบ 2 ค่า (ไม่แสดงค่าจริง)
SELECT name FROM vault.decrypted_secrets WHERE name IN ('petcosttrack_project_url', 'petcosttrack_cron_secret');
