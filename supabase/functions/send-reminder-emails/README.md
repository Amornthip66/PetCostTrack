# send-reminder-emails

Edge Function สำหรับส่งอีเมลแจ้งเตือนเมื่อรายการแจ้งเตือน (reminders) ใกล้ถึงกำหนด
(ภายใน 7 วัน) — เป็นส่วนหนึ่งของข้อ 3.4 (ช่องทางแจ้งเตือนภายนอกแอป)

> **สถานะปัจจุบัน:** เป็นโครงโค้ด (scaffold) ที่พร้อม deploy แต่ **ยังไม่ได้ส่งอีเมลจริง**
> เพราะยังไม่มี API key ของบริการส่งอีเมล ต้องตั้งค่าตามขั้นตอนด้านล่างก่อน

## ทำไมไม่ใช้ LINE Notify ตามที่ proposal แนะนำ

LINE Notify ถูกปิดให้บริการถาวรตั้งแต่ 31 มีนาคม 2025 (ประกาศทางการของ LINE
Developers: https://developers.line.biz/en/news/2025/04/01/line-notify/) ปัจจุบัน
ไม่สามารถขอ token หรือเรียก API ของ LINE Notify ได้อีกต่อไป ทางเลือกที่เหลือของ
LINE คือ LINE Messaging API ซึ่งต้องมี LINE Official Account + webhook + ระบบ
ผูกบัญชีผู้ใช้แต่ละคนกับ LINE user ID ผ่าน LINE Login (OAuth) — ซับซ้อนกว่ามาก
และเป็นงานคนละขนาดกับ LINE Notify เดิม จึงเลือกทำอีเมลเป็นช่องทางหลักแทนในรอบนี้

## ขั้นตอนติดตั้งใช้งานจริง

1. **สมัครบริการส่งอีเมล** — ตัวอย่างในโค้ดใช้ [Resend](https://resend.com) (มี
   free tier, ตั้งค่าง่าย) แต่จะสลับไปใช้ SendGrid/Postmark/AWS SES หรืออื่นๆ ก็ได้
   โดยแก้ส่วน `sendEmail()` ใน `index.ts` ให้เรียก API ของผู้ให้บริการนั้นแทน

2. **Deploy ฟังก์ชันนี้:**
   ```bash
   supabase functions deploy send-reminder-emails
   ```

3. **ตั้งค่า secret:**
   ```bash
   supabase secrets set RESEND_API_KEY=re_xxxxxxxxxxxxxxxx
   supabase secrets set REMINDER_EMAIL_FROM="PetCostTrack <notify@yourdomain.com>"
   ```
   (`SUPABASE_URL` และ `SUPABASE_SERVICE_ROLE_KEY` Supabase ตั้งให้อัตโนมัติอยู่แล้ว
   ไม่ต้องตั้งเอง)

4. **แก้ลิงก์ในอีเมล** — ใน `index.ts` ค้นหา `YOUR_APP_DOMAIN` แล้วแทนที่ด้วยโดเมน
   จริงที่ deploy แอปนี้ไว้

5. **ตั้งให้รันตามตารางเวลา** (เช่น ทุกวันตอนเช้า) เลือกวิธีใดวิธีหนึ่ง:

   **วิธี A — Supabase Dashboard (ง่ายสุด):**
   ไปที่ Edge Functions → เลือกฟังก์ชันนี้ → แท็บ "Cron" → ตั้ง schedule (เช่น
   `0 8 * * *` = ทุกวัน 8 โมงเช้า UTC)

   **วิธี B — pg_cron + pg_net (ถ้าต้องการควบคุมจาก SQL):**
   ```sql
   select cron.schedule(
     'send-reminder-emails-daily',
     '0 8 * * *',
     $$
     select net.http_post(
       url := 'https://<project-ref>.supabase.co/functions/v1/send-reminder-emails',
       headers := jsonb_build_object(
         'Authorization', 'Bearer ' || '<SERVICE_ROLE_KEY หรือ anon key ที่ตั้ง JWT verify ให้ผ่าน>',
         'Content-Type', 'application/json'
       )
     );
     $$
   );
   ```
   ต้องเปิด extension `pg_cron` และ `pg_net` ในโปรเจกต์ก่อน (Database → Extensions)

## ทดสอบด้วยตัวเอง (ก่อนตั้ง cron)

```bash
supabase functions invoke send-reminder-emails
```
ถ้า `RESEND_API_KEY` ยังไม่ได้ตั้งค่า ฟังก์ชันจะตอบกลับ HTTP 501 พร้อมข้อความแจ้ง
ให้ตั้งค่าก่อน (ไม่ error แบบเงียบๆ)

## หมายเหตุด้านความถูกต้อง

- ฟังก์ชันนี้ใช้ Service Role Key อ่าน/เขียนข้ามผู้ใช้ทุกคน (ไม่ผ่าน RLS) ตามรูปแบบ
  มาตรฐานของงานเบื้องหลัง — **ห้าม** เผยแพร่ Service Role Key นี้ไปฝั่ง client เด็ดขาด
- คอลัมน์ `reminders.last_notified_at` (เพิ่มโดย migration
  `20260912000000_reminder_email_notifications.sql`) กันไม่ให้ส่งอีเมลซ้ำทุกครั้งที่
  cron รันสำหรับ reminder เดียวกันที่เพิ่งแจ้งไปแล้วในรอบล่าสุด
