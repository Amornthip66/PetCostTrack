# send-reminder-emails

Edge Function ส่งอีเมลแจ้งเตือนเมื่อรายการแจ้งเตือน (reminders) ถึงช่วงแจ้งเตือน
ตามจำนวนวันล่วงหน้าที่ผู้ใช้ตั้งไว้ในแต่ละรายการ (`reminders.notify_days_before`
ค่าเริ่มต้น 7 วัน) — Acceptance Criteria F-05 ข้อ II

pg_cron เรียกฟังก์ชันนี้ทุกวัน 07:00 น. เวลาไทย ผ่าน pg_net
(migration `20261013100300_schedule_daily_jobs.sql`)

## ทำไมใช้อีเมลแทน LINE Notify ตามที่ proposal แนะนำ

LINE Notify ถูกปิดให้บริการถาวรตั้งแต่ 31 มีนาคม 2025 (ประกาศทางการของ LINE
Developers: https://developers.line.biz/en/news/2025/04/01/line-notify/) ทางเลือกที่เหลือ
คือ LINE Messaging API ซึ่งต้องมี LINE Official Account + webhook + ผูกบัญชีผู้ใช้กับ
LINE user ID ผ่าน LINE Login จึงเลือกอีเมลเป็นช่องทางนอกแอป ส่วนในแอปมี toast
(`js/notifications.js`)

## ขั้นตอนติดตั้ง (ทำครั้งเดียว)

1. **สมัคร [Resend](https://resend.com)** แล้วสร้าง API key (free tier พอสำหรับโปรเจกต์นี้)
   ถ้ายังไม่ได้ยืนยันโดเมน ให้ใช้ผู้ส่ง `onboarding@resend.dev` ซึ่งส่งได้เฉพาะอีเมลของ
   เจ้าของบัญชี Resend — ถ้าจะส่งถึงสมาชิกทุกคนต้องยืนยันโดเมนของตัวเองก่อน

2. **ตั้ง secret ของฟังก์ชัน** (`CRON_SECRET` เป็นสตริงสุ่มยาวๆ ที่คิดขึ้นเอง):
   ```bash
   supabase secrets set RESEND_API_KEY=re_xxxxxxxxxxxx
   supabase secrets set CRON_SECRET=<สตริงสุ่ม>
   supabase secrets set APP_URL=https://<โดเมนของเว็บ>
   supabase secrets set REMINDER_EMAIL_FROM="PetCostTrack <notify@yourdomain.com>"   # ไม่บังคับ
   ```
   (`SUPABASE_URL` และ `SUPABASE_SERVICE_ROLE_KEY` Supabase ตั้งให้อัตโนมัติ)

3. **Deploy** (ปิดการตรวจ JWT เพราะฟังก์ชันตรวจ `x-cron-secret` เอง):
   ```bash
   supabase functions deploy send-reminder-emails --no-verify-jwt
   ```

4. **เก็บค่าที่ pg_cron ใช้เรียกฟังก์ชันไว้ใน Vault** (SQL Editor ครั้งเดียว ไม่เก็บใน repo):
   ```sql
   select vault.create_secret('https://<project-ref>.supabase.co', 'petcosttrack_project_url');
   select vault.create_secret('<สตริงสุ่มเดียวกับ CRON_SECRET>', 'petcosttrack_cron_secret');
   ```

5. **ตั้งเวลา** ด้วย migration `20261013100300_schedule_daily_jobs.sql`
   (`supabase db push` หรือรันไฟล์นั้นใน SQL Editor)

## ทดสอบด้วยตัวเอง

```bash
curl -X POST "https://<project-ref>.supabase.co/functions/v1/send-reminder-emails" \
     -H "x-cron-secret: <สตริงสุ่ม>"
```
ผลลัพธ์เป็น JSON เช่น `{"today":"2026-10-14","checked":4,"due":2,"sent":3,"errors":[]}`
- ไม่ส่ง `x-cron-secret` หรือส่งผิด → HTTP 401
- ยังไม่ได้ตั้ง `RESEND_API_KEY` → HTTP 501 พร้อมข้อความแจ้ง (ไม่ error แบบเงียบ)

ดูผลการเรียกจาก pg_cron ได้ที่:
```sql
select * from cron.job_run_details order by start_time desc limit 10;
select status_code, content from net._http_response order by created desc limit 5;
```

## พฤติกรรม

- เลือกรายการที่ยังไม่เสร็จ และ `วันครบกำหนด <= วันนี้ + notify_days_before`
  รายการที่เลยกำหนดแล้วจะแจ้งต่อวันละครั้งจนกว่าจะกด "เสร็จแล้ว" (หัวข้ออีเมลขึ้นต้นด้วย "เลยกำหนด")
- ส่งถึงทุกคนที่มีสิทธิ์ต่อสัตว์เลี้ยงตัวนั้น (Owner + Co-caretaker จาก `pet_access`)
- `last_notified_at` กันส่งซ้ำในวันเดียวกัน (นับวันตามเวลาไทย) และจะบันทึกก็ต่อเมื่อส่งถึง
  อย่างน้อย 1 คน รอบหน้าจึงลองใหม่ได้ถ้าส่งไม่สำเร็จ
- ถ้าฐานข้อมูลยังไม่มีคอลัมน์ `notify_days_before` ใช้ 7 วันทุกรายการ

## หมายเหตุด้านความปลอดภัย

- ฟังก์ชันใช้ Service Role Key อ่าน/เขียนข้ามผู้ใช้ (ไม่ผ่าน RLS) ตามรูปแบบงานเบื้องหลัง —
  **ห้าม** เผยแพร่ Service Role Key ไปฝั่ง client
- ชื่อสัตว์เลี้ยง/หมวดหมู่/ผู้ใช้ถูก escape ก่อนใส่ใน HTML ของอีเมล

## ทดสอบอัตโนมัติ

ฟังก์ชันหลักแยกเป็น `handleRequest(req, env, deps)` จึงทดสอบได้โดยไม่ต้องต่อ Supabase/Resend จริง
(ตั้ง `PETCOST_TEST=1` เพื่อไม่ให้ไฟล์เรียก `Deno.serve` ตอน import)
