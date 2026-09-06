-- =====================================================================
-- Migration: แบ่งค่าใช้จ่าย 1 รายการให้หลายสัตว์เลี้ยง (ข้อ 3.5)
--
-- ที่มา: Open Question ในเอกสาร proposal (หัวข้อ 16/17.3) — "ระบบควรจัดการกับ
-- ค่าใช้จ่ายรวมอย่างไร (เช่น ซื้ออาหาร 1 ถุง แบ่งให้แมว 2 ตัวกิน)" ผลสำรวจ 43.5%
-- เลือกให้ผูก 1 Transaction กับสัตว์เลี้ยงหลายตัวพร้อมหารเฉลี่ยอัตโนมัติ คำแนะนำ
-- เชิง Database Design ในเอกสารให้ทำผ่านตาราง junction เช่น ExpenseAllocation
--
-- แนวทางที่เลือกใช้ (ยืนยันกับผู้ใช้แล้วก่อนเริ่มทำ): เป็น "ตารางเสริม" (additive)
-- เท่านั้น ไม่แตะ expenses.pet_id เดิมเลย — pet_id เดิมยังเป็น "สัตว์เลี้ยงหลัก"
-- ของรายจ่ายนั้นเหมือนเดิมทุกประการ เหตุผล: pet_id เดิมถูกใช้เป็น dependency
-- โดยตรงในจุดที่มีความเสี่ยงสูงถ้าแก้ไข ได้แก่
--   1. RLS ทุก policy ของ expenses/receipts (เช็คสิทธิ์ผ่าน pet_id เสมอ)
--   2. js/dashboard.js (กรอง/คำนวณ KPI ตาม pet_id)
--   3. js/budgets.js (คำนวณยอดใช้จ่ายเทียบงบประมาณตาม pet_id)
--   4. budget_summary_view (SQL view ที่ join ผ่าน pet_id)
-- การเปลี่ยนเป็น many-to-many แบบเต็มรูปแบบ (แทนที่ pet_id ด้วย junction table)
-- จะต้องแก้ไขทั้ง 4 จุดนี้ ซึ่งขัดกับเงื่อนไข "ห้ามกระทบของเดิม" จึงเลือกทำเป็น
-- ตารางข้อมูลเสริมแทน — ยอดรวมในแดชบอร์ด/งบประมาณยังคำนวณจาก expenses.pet_id/
-- amount เหมือนเดิมทุกประการ (ไม่นับส่วนแบ่งในตารางนี้รวมด้วย ตามที่ยืนยันกับ
-- ผู้ใช้แล้ว — อาจพิจารณาทำในเวอร์ชันถัดไป)
--
-- ขอบเขต: สร้างตารางใหม่ + RLS policy ใหม่เท่านั้น ไม่แก้ไขตาราง/policy/view/
-- ฟังก์ชันเดิมแม้แต่บรรทัดเดียว
--
-- ข้อจำกัดที่ทราบอยู่แล้ว: ไม่มี constraint ระดับฐานข้อมูลที่ป้องกันการเพิ่ม
-- pet_id เดียวกับ expenses.pet_id (สัตว์เลี้ยงหลัก) ซ้ำเข้ามาเป็นแถวในตารางนี้
-- อีก (Postgres CHECK constraint อ้างอิงตารางอื่นไม่ได้ ต้องใช้ trigger ซึ่งเพิ่ม
-- ความซับซ้อนเกินจำเป็นสำหรับฟีเจอร์เสริมนี้) ฝั่ง client (js/history.js) กรอง
-- กรณีนี้ออกให้แล้วทั้งตอนแสดงตัวเลือกและตอนบันทึก แต่การเรียก API ตรงๆ
-- (ข้าม UI) ยังสามารถสร้างข้อมูลซ้ำซ้อนแบบนี้ได้ในทางเทคนิค
--
-- รันซ้ำได้ (idempotent)
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.expense_pet_shares (
    share_id        INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    transaction_id  INT NOT NULL REFERENCES public.expenses(transaction_id) ON DELETE CASCADE ON UPDATE CASCADE,
    pet_id          INT NOT NULL REFERENCES public.pets(pet_id)             ON DELETE CASCADE ON UPDATE CASCADE,
    share_amount    NUMERIC(10,2) NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_expense_pet_shares_amount CHECK (share_amount >= 0),
    CONSTRAINT uq_expense_pet_shares_transaction_pet UNIQUE (transaction_id, pet_id)
);

COMMENT ON TABLE public.expense_pet_shares IS
    'ตารางเสริม (additive): สัตว์เลี้ยงตัวอื่นๆ ที่ร่วมใช้จ่ายรายการเดียวกัน นอกเหนือจากสัตว์เลี้ยงหลักใน expenses.pet_id — เป็นข้อมูลเสริมสำหรับดูภายหลังเท่านั้น ไม่ถูกนับรวมในยอดสรุปของ dashboard/budgets ในเวอร์ชันนี้';

ALTER TABLE public.expense_pet_shares ENABLE ROW LEVEL SECURITY;

-- อ่านได้ถ้ามีสิทธิ์เข้าถึงสัตว์เลี้ยงที่ถูกแบ่ง หรือมีสิทธิ์เข้าถึงสัตว์เลี้ยงหลักของรายจ่ายนั้น
DROP POLICY IF EXISTS "expense_pet_shares_select" ON public.expense_pet_shares;
CREATE POLICY "expense_pet_shares_select" ON public.expense_pet_shares
    FOR SELECT USING (
        user_has_pet_access(pet_id)
        OR EXISTS (
            SELECT 1 FROM expenses e
            WHERE e.transaction_id = expense_pet_shares.transaction_id
            AND user_has_pet_access(e.pet_id)
        )
    );

-- เพิ่มได้ต้องมีสิทธิ์เข้าถึงทั้งสัตว์เลี้ยงที่จะแบ่งให้ และสัตว์เลี้ยงหลักของรายจ่ายนั้น
DROP POLICY IF EXISTS "expense_pet_shares_insert" ON public.expense_pet_shares;
CREATE POLICY "expense_pet_shares_insert" ON public.expense_pet_shares
    FOR INSERT WITH CHECK (
        user_has_pet_access(pet_id)
        AND EXISTS (
            SELECT 1 FROM expenses e
            WHERE e.transaction_id = expense_pet_shares.transaction_id
            AND user_has_pet_access(e.pet_id)
        )
    );

-- ลบได้เฉพาะผู้ที่มีสิทธิ์แก้ไข/ลบรายจ่ายหลักนั้นอยู่แล้ว (เงื่อนไขเดียวกับ
-- expenses_update/expenses_delete จาก 20260911000000_cocaretaker_expense_pet_permissions.sql)
DROP POLICY IF EXISTS "expense_pet_shares_delete" ON public.expense_pet_shares;
CREATE POLICY "expense_pet_shares_delete" ON public.expense_pet_shares
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM expenses e
            WHERE e.transaction_id = expense_pet_shares.transaction_id
            AND (
                user_is_pet_owner(e.pet_id)
                OR (e.user_id = auth_user_id() AND user_has_pet_access(e.pet_id))
            )
        )
    );
