-- =====================================================================
-- Migration: คืนสิทธิ์ Co-caretaker ตาม BR-05 ที่ระบุใน Proposal
--
-- ที่มา (BR-05):
--   "ผู้ร่วมดูแล (Co-caretaker) สามารถแก้ไขหรือลบได้เฉพาะรายการค่าใช้จ่ายที่
--   ตนเองบันทึกเท่านั้น ส่วนเจ้าของหลัก (Owner) มีสิทธิ์จัดการได้ทุกรายการของ
--   สัตว์เลี้ยง นอกจากนี้ Co-caretaker ยังมีสิทธิ์แก้ไขข้อมูลโปรไฟล์สัตว์เลี้ยงได้
--   (ตามผลสำรวจผู้ใช้ 60.9%) แต่ไม่มีสิทธิ์ลบโปรไฟล์ ซึ่งยังคงเป็นสิทธิ์เฉพาะของ
--   Owner ตาม BR-02"
--
-- ปัญหาที่เจอ:
--   Policy เดิมจาก 20260904000000_enforce_strict_rls.sql:
--     - expenses_update / expenses_delete: USING (user_is_pet_owner(pet_id))
--       เท่านั้น — ไม่มีเงื่อนไข "หรือเป็นเจ้าของรายการเอง" เลย ทำให้ Co-caretaker
--       แก้ไข/ลบรายจ่ายของตัวเองไม่ได้จริงในฐานข้อมูล แม้ฝั่ง client
--       (js/history.js: canModify()) จะออกแบบ UI ให้กดปุ่มแก้ไข/ลบได้อยู่แล้วก็ตาม
--       (เขียนคอมเมนต์ไว้ในโค้ดเองว่าเงื่อนไข RLS "ควร" ตรงกับ canModify() แต่ของจริง
--       ในฐานข้อมูลไม่ตรง เป็น RLS ที่ตกหล่นจากตอนพัฒนา ไม่ใช่ฟีเจอร์ใหม่)
--     - pets_update: USING (user_is_pet_owner(pet_id)) เท่านั้น — ทั้งที่ปุ่ม
--       "แก้ไข" ในหน้า My Pets (js/pets.js) โชว์ให้ทุกคนที่มีสิทธิ์เข้าถึงกดได้
--       อยู่แล้ว (ไม่ได้ซ่อนเฉพาะ Owner) แต่ Co-caretaker กดแล้วจะเงียบๆ ไม่มีอะไร
--       ถูกอัปเดตเพราะ RLS บล็อก
--
-- ขอบเขตการแก้ไข (จำกัดเฉพาะ 2 เรื่องนี้เท่านั้น ไม่แตะ policy อื่น):
--   1. expenses_update / expenses_delete: เพิ่มเงื่อนไข "เป็นเจ้าของรายการเอง (user_id
--      = auth_user_id()) และยังมีสิทธิ์เข้าถึงสัตว์เลี้ยงตัวนั้นอยู่ ณ ปัจจุบัน
--      (user_has_pet_access)" ต่อจากเงื่อนไข Owner เดิม — เพิ่มเงื่อนไข "ยังมีสิทธิ์
--      เข้าถึงอยู่" กันกรณีถูกถอดออกจาก pet_access ไปแล้ว (BR-06) แต่ยังพยายามเรียก
--      แก้ไข/ลบรายการเก่าของตัวเองอยู่ ซึ่งไม่ควรทำได้อีกต่อไป
--   2. pets_update: เปลี่ยนจาก user_is_pet_owner เป็น user_has_pet_access (ครอบคลุม
--      ทั้ง Owner และ Co-caretaker) — ส่วน pets_delete (BR-02: เฉพาะ Owner ลบได้)
--      ไม่ถูกแก้ไขในไฟล์นี้เลย ยังเป็น user_is_pet_owner เหมือนเดิม
--
-- หมายเหตุ (ข้อจำกัดที่ทราบอยู่แล้ว): pets_update ครอบคลุมทุกคอลัมน์ของตาราง pets
-- รวมถึงคอลัมน์เก็บเข้าคลัง (is_archived/archived_note/archived_at) ที่ตั้งใจให้
-- เฉพาะ Owner กดผ่าน UI เท่านั้น (js/pets.js: ปุ่ม "เก็บเข้าคลัง" โชว์เฉพาะ Owner)
-- Postgres RLS ไม่รองรับการจำกัดสิทธิ์ระดับคอลัมน์ในนโยบายเดียวง่ายๆ จึงยังมีช่องที่
-- Co-caretaker เรียก API ตรงๆ (ข้าม UI) เพื่อตั้งค่า is_archived ได้ — ไม่ได้อยู่ใน
-- ขอบเขตของ BR-05/BR-02 ที่ต้องแก้ในรอบนี้ แต่ควรพิจารณาทำ trigger แยกต่างหากถ้า
-- ต้องการปิดช่องนี้ในอนาคต
--
-- รันซ้ำได้ (idempotent) — ไม่กระทบ policy ของตารางอื่น (pets_delete, pets_select,
-- pets_insert, receipts_*, budgets_*, reminders_*, pet_access_* ฯลฯ)
-- =====================================================================

-- === expenses: Owner จัดการได้ทุกรายการของสัตว์เลี้ยง, Co-caretaker แก้/ลบได้
--     เฉพาะรายการที่ตนเองบันทึก "และ" ยังมีสิทธิ์เข้าถึงสัตว์เลี้ยงตัวนั้นอยู่ ===
DROP POLICY IF EXISTS "expenses_update" ON public.expenses;
CREATE POLICY "expenses_update" ON public.expenses
    FOR UPDATE USING (
        user_is_pet_owner(pet_id)
        OR (user_id = auth_user_id() AND user_has_pet_access(pet_id))
    );

DROP POLICY IF EXISTS "expenses_delete" ON public.expenses;
CREATE POLICY "expenses_delete" ON public.expenses
    FOR DELETE USING (
        user_is_pet_owner(pet_id)
        OR (user_id = auth_user_id() AND user_has_pet_access(pet_id))
    );

-- === pets: Co-caretaker แก้ไขโปรไฟล์ได้ (เดิมจำกัดไว้แค่ Owner) ===
DROP POLICY IF EXISTS "pets_update" ON public.pets;
CREATE POLICY "pets_update" ON public.pets
    FOR UPDATE USING (
        user_has_pet_access(pet_id)
    );
