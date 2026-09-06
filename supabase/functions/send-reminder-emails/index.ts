// =====================================================================
// Edge Function: send-reminder-emails (ข้อ 3.4 — แจ้งเตือนทางอีเมล)
//
// สโครง (scaffold) พร้อม deploy — ยังไม่มี API key ของบริการส่งอีเมลจริงในตอนนี้
// จึงต้องตั้งค่า secret ก่อนใช้งานได้จริง (ดูขั้นตอนใน README.md ในโฟลเดอร์นี้)
//
// สิ่งที่ฟังก์ชันนี้ทำ:
//   1. หา reminders ที่ยังไม่เสร็จ (is_completed = false) และถึงกำหนดภายใน
//      DUE_SOON_DAYS วัน ที่ยังไม่เคยแจ้งเตือนในรอบล่าสุด (last_notified_at)
//   2. หาผู้ใช้ทุกคนที่มีสิทธิ์เข้าถึงสัตว์เลี้ยงตัวนั้น (Owner + Co-caretaker
//      ทุกคนผ่านตาราง pet_access) แล้วส่งอีเมลแจ้งเตือนให้ทุกคน
//   3. อัปเดต last_notified_at กันส่งซ้ำในรอบถัดไปที่ยังไม่ถึงเวลาแจ้งใหม่
//
// ฟังก์ชันนี้ใช้ Service Role Key (Supabase มีให้อัตโนมัติในสภาพแวดล้อม Edge
// Function ผ่าน SUPABASE_SERVICE_ROLE_KEY) จึงไม่ผ่าน RLS ตามปกติของผู้ใช้ —
// เป็นรูปแบบมาตรฐานสำหรับงานเบื้องหลัง (background job) ที่ต้องอ่านข้อมูลข้าม
// ผู้ใช้หลายคน ไม่ใช่การอ่านข้อมูลแทนผู้ใช้คนใดคนหนึ่ง
//
// วิธี deploy:
//   supabase functions deploy send-reminder-emails
//   supabase secrets set RESEND_API_KEY=xxxxxxxxxxxx
//   supabase secrets set REMINDER_EMAIL_FROM="PetCostTrack <notify@yourdomain.com>"
// แล้วตั้งให้รันตามตารางเวลา (เช่น ทุกวัน) ผ่าน Supabase Dashboard → Edge
// Functions → Cron หรือ pg_cron + pg_net — ดูรายละเอียดเพิ่มเติมใน README.md
// =====================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
// TODO: ผู้ใช้ต้องตั้งค่าเอง — ยังไม่มีคีย์จริงในเซสชันที่สร้างสโครงนี้
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const EMAIL_FROM = Deno.env.get('REMINDER_EMAIL_FROM') || 'PetCostTrack <onboarding@resend.dev>';
// ตรงกับ User Scenario 3 ในเอกสาร proposal: แจ้งเตือนล่วงหน้า 7 วันก่อนถึงกำหนด
const DUE_SOON_DAYS = 7;

Deno.serve(async (req: Request) => {
  if (!RESEND_API_KEY) {
    return new Response(
      JSON.stringify({
        error:
          'RESEND_API_KEY ยังไม่ได้ตั้งค่า — รัน `supabase secrets set RESEND_API_KEY=...` ก่อน ฟังก์ชันนี้ถึงจะส่งอีเมลได้จริง',
      }),
      { status: 501, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const cutoff = new Date(today.getTime() + DUE_SOON_DAYS * 86400000);
  const cutoffDate = cutoff.toISOString().split('T')[0];

  const { data: reminders, error } = await supabase
    .from('reminders')
    .select('task_id, next_due_date, pet_id, last_notified_at, pets(name), categories(category_name)')
    .eq('is_completed', false)
    .lte('next_due_date', cutoffDate)
    .or(`last_notified_at.is.null,last_notified_at.lt.${today.toISOString()}`);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let sent = 0;
  const errors: string[] = [];

  for (const r of reminders ?? []) {
    // ผู้ใช้ทุกคนที่มีสิทธิ์เข้าถึงสัตว์เลี้ยงตัวนี้ (Owner + Co-caretaker ทุกคน)
    const { data: access, error: accessError } = await supabase
      .from('pet_access')
      .select('users(email, name)')
      .eq('pet_id', r.pet_id);

    if (accessError) {
      errors.push(`task_id=${r.task_id}: โหลดรายชื่อผู้ใช้ไม่สำเร็จ — ${accessError.message}`);
      continue;
    }

    const recipients = (access ?? [])
      .map((a: any) => a.users)
      .filter((u: any) => u && u.email);

    for (const user of recipients) {
      try {
        await sendEmail(user.email, user.name, r);
        sent++;
      } catch (e) {
        errors.push(`task_id=${r.task_id} email=${user.email}: ${e}`);
      }
    }

    const { error: updateError } = await supabase
      .from('reminders')
      .update({ last_notified_at: new Date().toISOString() })
      .eq('task_id', r.task_id);
    if (updateError) {
      errors.push(`task_id=${r.task_id}: อัปเดต last_notified_at ไม่สำเร็จ — ${updateError.message}`);
    }
  }

  return new Response(JSON.stringify({ sent, errors }), {
    headers: { 'Content-Type': 'application/json' },
  });
});

async function sendEmail(to: string, name: string, reminder: any) {
  const petName = reminder.pets?.name ?? 'สัตว์เลี้ยงของคุณ';
  const catName = reminder.categories?.category_name ?? 'รายการแจ้งเตือน';
  const dueDate = reminder.next_due_date;

  // ตัวอย่างนี้ใช้ Resend (https://resend.com) เป็นบริการส่งอีเมล — จะสลับไปใช้
  // บริการอื่น (SendGrid, Postmark, AWS SES ฯลฯ) ก็ทำได้ แค่เปลี่ยน URL/body ให้
  // ตรงกับ API ของผู้ให้บริการนั้น ส่วนที่เหลือของฟังก์ชันไม่ต้องแก้
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to,
      subject: `แจ้งเตือน: ${catName} ของ ${petName} ใกล้ถึงกำหนด`,
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2 style="color:#663399;">🐾 PetCostTrack แจ้งเตือน</h2>
          <p>สวัสดีคุณ ${name || ''},</p>
          <p><strong>${catName}</strong> ของ <strong>${petName}</strong> ใกล้ถึงกำหนดวันที่ <strong>${dueDate}</strong></p>
          <p style="margin-top:24px;">
            <a href="https://YOUR_APP_DOMAIN/reminders.html"
               style="background:#663399;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;">
              ดูรายละเอียดในแอป
            </a>
          </p>
        </div>
      `,
    }),
  });

  if (!res.ok) {
    throw new Error(`Resend API error: ${res.status} ${await res.text()}`);
  }
}
