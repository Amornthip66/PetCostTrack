// =====================================================================
// Edge Function: send-reminder-emails (F-05 AC ข้อ II — แจ้งเตือนทางอีเมล)
//
// pg_cron เรียกฟังก์ชันนี้ทุกวัน 07:00 น. เวลาไทย (migration
// 20261013100300_schedule_daily_jobs.sql) ขั้นตอนตั้งค่าอยู่ใน README.md ในโฟลเดอร์นี้
//
// สิ่งที่ฟังก์ชันนี้ทำ:
//   1. หา reminders ที่ยังไม่เสร็จ และถึงช่วงแจ้งเตือนของรายการนั้นแล้ว คือ
//      วันครบกำหนด <= วันนี้ + notify_days_before (ค่าเริ่มต้น 7 วัน) — รายการที่
//      เลยกำหนดแล้วก็ยังแจ้งต่อวันละครั้งจนกว่าจะกด "เสร็จแล้ว"
//   2. ส่งอีเมลถึงทุกคนที่มีสิทธิ์ต่อสัตว์เลี้ยงตัวนั้น (Owner + Co-caretaker)
//   3. อัปเดต last_notified_at กันส่งซ้ำในวันเดียวกัน (นับวันตามเวลาไทย)
//
// ใช้ Service Role Key (Supabase ตั้งให้อัตโนมัติใน SUPABASE_SERVICE_ROLE_KEY)
// อ่านข้อมูลข้ามผู้ใช้ได้โดยไม่ผ่าน RLS ตามรูปแบบงานเบื้องหลัง จึงต้องกันคนอื่น
// เรียกด้วย CRON_SECRET (ส่งมาใน header x-cron-secret) และ deploy แบบ --no-verify-jwt
//
// secrets ที่ต้องตั้ง:
//   RESEND_API_KEY        คีย์ของ Resend (https://resend.com)
//   CRON_SECRET           สตริงสุ่ม ต้องตรงกับ vault secret petcosttrack_cron_secret
//   REMINDER_EMAIL_FROM   (ไม่บังคับ) ผู้ส่ง เช่น "PetCostTrack <notify@yourdomain.com>"
//   APP_URL               (ไม่บังคับ) โดเมนเว็บ เช่น https://petcosttrack.vercel.app
// =====================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const DEFAULT_NOTIFY_DAYS = 7;
const MAX_NOTIFY_DAYS = 60; // ตรงกับ chk_reminders_notify_days

type Env = (key: string) => string | undefined;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// วันที่ปัจจุบันตามเวลาไทยในรูป YYYY-MM-DD (วันครบกำหนดเก็บเป็นวันที่ตามปฏิทินไทย)
export function bangkokDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// รายการที่ถึงช่วงแจ้งเตือนของตัวเองแล้ว (วันครบกำหนด <= วันนี้ + จำนวนวันล่วงหน้า)
// deno-lint-ignore no-explicit-any
export function isDueForNotice(r: any, today: string): boolean {
  const days = r.notify_days_before == null ? DEFAULT_NOTIFY_DAYS : Number(r.notify_days_before);
  return r.next_due_date <= addDays(today, days);
}

// deno-lint-ignore no-explicit-any
export async function handleRequest(req: Request, env: Env, deps: { supabase?: any; fetchFn?: typeof fetch; now?: Date } = {}) {
  const cronSecret = env('CRON_SECRET');
  if (!cronSecret) {
    return json({ error: 'CRON_SECRET ยังไม่ได้ตั้งค่า — รัน `supabase secrets set CRON_SECRET=...` ก่อน' }, 500);
  }
  if (req.headers.get('x-cron-secret') !== cronSecret) {
    return json({ error: 'unauthorized' }, 401);
  }
  const resendKey = env('RESEND_API_KEY');
  if (!resendKey) {
    return json({
      error: 'RESEND_API_KEY ยังไม่ได้ตั้งค่า — รัน `supabase secrets set RESEND_API_KEY=...` ก่อน ฟังก์ชันนี้ถึงจะส่งอีเมลได้จริง',
    }, 501);
  }

  const supabase = deps.supabase ?? createClient(env('SUPABASE_URL')!, env('SUPABASE_SERVICE_ROLE_KEY')!);
  const fetchFn = deps.fetchFn ?? fetch;
  const emailFrom = env('REMINDER_EMAIL_FROM') || 'PetCostTrack <onboarding@resend.dev>';
  const appUrl = (env('APP_URL') || '').replace(/\/+$/, '');

  const now = deps.now ?? new Date();
  const today = bangkokDate(now);
  // เริ่มวันนี้ตามเวลาไทย (00:00 +07:00) — ถ้าแจ้งไปแล้วหลังเวลานี้ ไม่ส่งซ้ำ
  const startOfToday = new Date(today + 'T00:00:00+07:00').toISOString();

  const base = 'task_id, next_due_date, pet_id, last_notified_at, pets(name), categories(category_name)';
  const build = (select: string) => supabase
    .from('reminders')
    .select(select)
    .eq('is_completed', false)
    .lte('next_due_date', addDays(today, MAX_NOTIFY_DAYS))
    .or(`last_notified_at.is.null,last_notified_at.lt.${startOfToday}`);

  let { data: rows, error } = await build(base + ', notify_days_before');
  if (error && /notify_days_before/.test(error.message)) {
    // migration 20261013100100 ยังไม่ได้รัน → ใช้ 7 วันทุกรายการ
    ({ data: rows, error } = await build(base));
  }
  if (error) return json({ error: error.message }, 500);

  // deno-lint-ignore no-explicit-any
  const due = (rows ?? []).filter((r: any) => isDueForNotice(r, today));
  if (!due.length) return json({ today, checked: rows?.length ?? 0, due: 0, sent: 0, errors: [] });

  // ผู้รับของทุกสัตว์เลี้ยงในรอบนี้ ดึงครั้งเดียว
  // deno-lint-ignore no-explicit-any
  const petIds = [...new Set(due.map((r: any) => r.pet_id))];
  const { data: access, error: accessError } = await supabase
    .from('pet_access')
    .select('pet_id, users(email, name)')
    .in('pet_id', petIds);
  if (accessError) return json({ error: accessError.message }, 500);

  const recipientsByPet = new Map<number, { email: string; name: string }[]>();
  // deno-lint-ignore no-explicit-any
  for (const a of (access ?? []) as any[]) {
    if (!a.users || !a.users.email) continue;
    const list = recipientsByPet.get(a.pet_id) ?? [];
    list.push({ email: a.users.email, name: a.users.name });
    recipientsByPet.set(a.pet_id, list);
  }

  let sent = 0;
  const errors: string[] = [];
  for (const r of due) {
    const recipients = recipientsByPet.get(r.pet_id) ?? [];
    let delivered = 0;
    for (const user of recipients) {
      try {
        await sendEmail(fetchFn, resendKey, emailFrom, appUrl, user, r, today);
        delivered++;
        sent++;
      } catch (e) {
        errors.push(`task_id=${r.task_id} email=${user.email}: ${e}`);
      }
    }
    // บันทึกว่าแจ้งแล้วเฉพาะเมื่อส่งถึงอย่างน้อย 1 คน (ถ้าส่งไม่ได้เลย รอบหน้าจะลองใหม่)
    if (delivered > 0) {
      const { error: updateError } = await supabase
        .from('reminders')
        .update({ last_notified_at: now.toISOString() })
        .eq('task_id', r.task_id);
      if (updateError) errors.push(`task_id=${r.task_id}: อัปเดต last_notified_at ไม่สำเร็จ — ${updateError.message}`);
    }
  }

  return json({ today, checked: rows?.length ?? 0, due: due.length, sent, errors });
}

async function sendEmail(
  fetchFn: typeof fetch,
  apiKey: string,
  from: string,
  appUrl: string,
  user: { email: string; name: string },
  // deno-lint-ignore no-explicit-any
  reminder: any,
  today: string,
) {
  const petName = reminder.pets?.name ?? 'สัตว์เลี้ยงของคุณ';
  const catName = reminder.categories?.category_name ?? 'รายการแจ้งเตือน';
  const dueDate = reminder.next_due_date;
  const overdue = dueDate < today;
  const subject = overdue
    ? `เลยกำหนด: ${catName} ของ ${petName} (ครบกำหนด ${dueDate})`
    : `แจ้งเตือน: ${catName} ของ ${petName} ครบกำหนด ${dueDate}`;
  const link = appUrl
    ? `<p style="margin-top:24px;"><a href="${escapeHtml(appUrl)}/reminders.html"
         style="background:#663399;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;">ดูรายละเอียดในแอป</a></p>`
    : '';

  const res = await fetchFn('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: user.email,
      subject,
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2 style="color:#663399;">🐾 PetCostTrack แจ้งเตือน</h2>
          <p>สวัสดีคุณ ${escapeHtml(user.name)},</p>
          <p><strong>${escapeHtml(catName)}</strong> ของ <strong>${escapeHtml(petName)}</strong>
             ${overdue ? 'เลยกำหนดมาแล้ว' : 'ใกล้ถึงกำหนด'} (วันที่ <strong>${escapeHtml(dueDate)}</strong>)</p>
          ${link}
        </div>
      `,
    }),
  });

  if (!res.ok) {
    throw new Error(`Resend API error: ${res.status} ${await res.text()}`);
  }
}

if (!Deno.env.get('PETCOST_TEST')) {
  Deno.serve((req: Request) => handleRequest(req, (k) => Deno.env.get(k)));
}
