// deno-lint-ignore-file no-explicit-any -- ตัวจำลอง Supabase client ในไฟล์ทดสอบ
// ทดสอบ send-reminder-emails โดยไม่ต่อ Supabase/Resend จริง
// รัน: PETCOST_TEST=1 deno test --allow-env supabase/functions/send-reminder-emails/index.test.ts
import { handleRequest, bangkokDate, isDueForNotice } from './index.ts';

function assertEq(a: unknown, b: unknown, msg = '') {
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  if (sa !== sb) throw new Error(`${msg}\n  expected ${sb}\n  actual   ${sa}`);
}

// --- tiny fake of the supabase-js query builder used by the function ---
function fakeSupabase(opts: { reminders: any[]; access: any[]; missingColumn?: boolean }) {
  const log: any = { selects: [], updates: [], filters: [] };
  function builder(table: string) {
    const st: any = { table, filters: [] as string[] };
    const api: any = {
      select(s: string) { st.select = s; log.selects.push(`${table}:${s}`); return api; },
      eq(c: string, v: unknown) { st.filters.push(`eq ${c} ${v}`); return st.update ? finishUpdate() : api; },
      lte(c: string, v: unknown) { st.filters.push(`lte ${c} ${v}`); return api; },
      or(s: string) { st.filters.push(`or ${s}`); log.filters.push(st.filters.slice()); return Promise.resolve(result()); },
      in(c: string, v: unknown[]) { st.filters.push(`in ${c} ${v}`); return Promise.resolve(result()); },
      update(row: unknown) { st.update = row; return api; },
    };
    function finishUpdate() { log.updates.push({ table, row: st.update, filters: st.filters.slice() }); return Promise.resolve({ error: null }); }
    function result() {
      if (table === 'reminders') {
        if (opts.missingColumn && st.select.includes('notify_days_before')) {
          return { data: null, error: { message: 'column reminders.notify_days_before does not exist' } };
        }
        return { data: opts.reminders, error: null };
      }
      if (table === 'pet_access') return { data: opts.access, error: null };
      return { data: [], error: null };
    }
    return api;
  }
  return { client: { from: builder }, log };
}

function fakeFetch(failFor: string[] = []) {
  const calls: any[] = [];
  const fn = (async (_url: string, init: any) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    if (failFor.includes(body.to)) return new Response('boom', { status: 500 });
    return new Response('{"id":"x"}', { status: 200 });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const env = (extra: Record<string, string | undefined> = {}) => (k: string) =>
  ({ CRON_SECRET: 's3cret', RESEND_API_KEY: 're_test', APP_URL: 'https://petcost.example/', ...extra } as Record<string, string | undefined>)[k];
const req = (secret?: string) => new Request('http://x/', { method: 'POST', headers: secret ? { 'x-cron-secret': secret } : {} });
const NOW = new Date('2026-10-13T01:00:00Z'); // 08:00 เวลาไทย

const reminders = [
  { task_id: 1, pet_id: 10, next_due_date: '2026-10-20', notify_days_before: 7, pets: { name: '<b>โบโบ้</b>' }, categories: { category_name: 'วัคซีน' } },
  { task_id: 2, pet_id: 10, next_due_date: '2026-10-21', notify_days_before: 7, pets: { name: 'โบโบ้' }, categories: { category_name: 'ถ่ายพยาธิ' } },
  { task_id: 3, pet_id: 20, next_due_date: '2026-11-10', notify_days_before: 30, pets: { name: 'เหมียว' }, categories: { category_name: 'ตรวจสุขภาพ' } },
  { task_id: 4, pet_id: 20, next_due_date: '2026-10-13', notify_days_before: 0, pets: { name: 'เหมียว' }, categories: { category_name: 'อาบน้ำ' } },
  { task_id: 5, pet_id: 30, next_due_date: '2026-10-01', notify_days_before: 7, pets: { name: 'ถั่ว' }, categories: { category_name: 'ค่าฝากเลี้ยง' } },
  { task_id: 6, pet_id: 10, next_due_date: '2026-10-19', notify_days_before: null, pets: { name: 'โบโบ้' }, categories: { category_name: 'อาหาร' } },
];
const access = [
  { pet_id: 10, users: { email: 'owner@example.com', name: 'เจ้าของ' } },
  { pet_id: 10, users: { email: 'co@example.com', name: 'ผู้ร่วม' } },
  { pet_id: 20, users: { email: 'owner@example.com', name: 'เจ้าของ' } },
  { pet_id: 30, users: null },
];

Deno.test('1. ไม่ตั้ง CRON_SECRET → 500', async () => {
  const r = await handleRequest(req('s3cret'), env({ CRON_SECRET: undefined }));
  assertEq(r.status, 500);
});
Deno.test('2. header x-cron-secret ผิด/ไม่มี → 401', async () => {
  assertEq((await handleRequest(req('nope'), env())).status, 401);
  assertEq((await handleRequest(req(), env())).status, 401);
});
Deno.test('3. ไม่ตั้ง RESEND_API_KEY → 501', async () => {
  assertEq((await handleRequest(req('s3cret'), env({ RESEND_API_KEY: undefined }))).status, 501);
});
Deno.test('4. เลือกรายการตามจำนวนวันล่วงหน้าของแต่ละรายการ และส่งถึงทุกคนที่มีสิทธิ์', async () => {
  const sb = fakeSupabase({ reminders, access });
  const f = fakeFetch();
  const r = await handleRequest(req('s3cret'), env(), { supabase: sb.client, fetchFn: f.fn, now: NOW });
  const body = await r.json();
  assertEq(body.today, '2026-10-13', 'วันนี้ตามเวลาไทย');
  assertEq(body.due, 5, 'task 1,3,4,5,6 ถึงช่วงแจ้ง (task 2 ยังไม่ถึง)');
  const pairs = f.calls.map((c) => c.to + '|' + c.subject).sort();
  assertEq(pairs.length, 6, 'pet10: 2 รายการ x 2 คน, pet20: 2 รายการ x 1 คน, pet30: ไม่มีผู้รับ');
  const updated = sb.log.updates.map((u: any) => u.filters[0]).sort();
  assertEq(updated, ['eq task_id 1', 'eq task_id 3', 'eq task_id 4', 'eq task_id 6'], 'task 5 ไม่มีผู้รับจึงไม่บันทึกว่าแจ้งแล้ว');
  const html1 = f.calls.find((c) => c.subject.includes('วัคซีน')).html;
  if (html1.includes('<b>โบโบ้</b>') || !html1.includes('&lt;b&gt;โบโบ้&lt;/b&gt;')) throw new Error('ชื่อสัตว์เลี้ยงต้องถูก escape');
  if (!html1.includes('https://petcost.example/reminders.html')) throw new Error('ลิงก์ APP_URL ไม่ถูกต้อง');
  const filters = sb.log.filters[0];
  assertEq(filters.includes('lte next_due_date 2026-12-12'), true, 'ดึงล่วงหน้าสูงสุด 60 วัน');
  assertEq(filters.some((x: string) => x.startsWith('or last_notified_at.is.null,last_notified_at.lt.2026-10-12T17:00:00.000Z')), true, 'กันส่งซ้ำในวันเดียวกัน (เริ่มวันตามเวลาไทย)');
});
Deno.test('5. รายการที่เลยกำหนดแล้วใช้หัวข้อ "เลยกำหนด"', async () => {
  const sb = fakeSupabase({ reminders: [reminders[4]], access: [{ pet_id: 30, users: { email: 'b@example.com', name: 'บี' } }] });
  const f = fakeFetch();
  await handleRequest(req('s3cret'), env(), { supabase: sb.client, fetchFn: f.fn, now: NOW });
  assertEq(f.calls[0].subject.startsWith('เลยกำหนด:'), true);
});
Deno.test('6. ฐานข้อมูลยังไม่มีคอลัมน์ notify_days_before → ถอยไปใช้ 7 วัน', async () => {
  const sb = fakeSupabase({ reminders: reminders.map((r) => ({ ...r, notify_days_before: undefined })), access, missingColumn: true });
  const f = fakeFetch();
  const body = await (await handleRequest(req('s3cret'), env(), { supabase: sb.client, fetchFn: f.fn, now: NOW })).json();
  assertEq(sb.log.selects.filter((s: string) => s.startsWith('reminders')).length, 2, 'ลอง 2 ครั้ง');
  assertEq(body.due, 4, 'ค่าเริ่มต้น 7 วัน: task 1,4,5,6 (task 3 ครบ 10 พ.ย. ยังไม่ถึง, task 2 ยังไม่ถึง)');
});
Deno.test('7. ส่งไม่สำเร็จทุกคน → ไม่บันทึกว่าแจ้งแล้ว และรายงาน error', async () => {
  const sb = fakeSupabase({ reminders: [reminders[0]], access: access.slice(0, 2) });
  const f = fakeFetch(['owner@example.com', 'co@example.com']);
  const body = await (await handleRequest(req('s3cret'), env(), { supabase: sb.client, fetchFn: f.fn, now: NOW })).json();
  assertEq(body.sent, 0); assertEq(body.errors.length, 2); assertEq(sb.log.updates.length, 0);
});
Deno.test('8. bangkokDate / isDueForNotice', () => {
  assertEq(bangkokDate(new Date('2026-10-13T18:30:00Z')), '2026-10-14');
  assertEq(isDueForNotice({ next_due_date: '2026-10-20', notify_days_before: null }, '2026-10-13'), true);
  assertEq(isDueForNotice({ next_due_date: '2026-10-21', notify_days_before: 7 }, '2026-10-13'), false);
});
