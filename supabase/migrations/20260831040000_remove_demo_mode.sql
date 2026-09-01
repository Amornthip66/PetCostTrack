-- =====================================================================
-- ส่วนที่ 6: ลบ Demo Mode — ผู้ใช้ต้อง Login เท่านั้น
-- =====================================================================

-- === categories: ยังอ่านได้ทุกคน (ข้อมูลสาธารณะ) ===
-- ไม่ต้องแก้

-- === users: ลบ demo mode ===
DROP POLICY IF EXISTS "users_select" ON users;
CREATE POLICY "users_select" ON users FOR SELECT USING (
    auth_id = auth.uid()
    OR users_share_pet(user_id)
);

-- === pets ===
DROP POLICY IF EXISTS "pets_select" ON pets;
CREATE POLICY "pets_select" ON pets FOR SELECT USING (
    user_has_pet_access(pet_id)
);

-- === pet_access ===
DROP POLICY IF EXISTS "pet_access_select" ON pet_access;
CREATE POLICY "pet_access_select" ON pet_access FOR SELECT USING (
    user_id = auth_user_id()
    OR user_has_pet_access(pet_id)
);

-- === expenses ===
DROP POLICY IF EXISTS "expenses_select" ON expenses;
DROP POLICY IF EXISTS "expenses_insert" ON expenses;
DROP POLICY IF EXISTS "expenses_update" ON expenses;
DROP POLICY IF EXISTS "expenses_delete" ON expenses;

CREATE POLICY "expenses_select" ON expenses FOR SELECT USING (
    user_has_pet_access(pet_id)
);
CREATE POLICY "expenses_insert" ON expenses FOR INSERT WITH CHECK (
    user_id = auth_user_id()
);
CREATE POLICY "expenses_update" ON expenses FOR UPDATE USING (
    user_is_pet_owner(pet_id)
);
CREATE POLICY "expenses_delete" ON expenses FOR DELETE USING (
    user_is_pet_owner(pet_id)
);

-- === budgets ===
DROP POLICY IF EXISTS "budgets_select" ON budgets;
DROP POLICY IF EXISTS "budgets_all" ON budgets;

CREATE POLICY "budgets_select" ON budgets FOR SELECT USING (
    user_has_pet_access(pet_id)
);
CREATE POLICY "budgets_all" ON budgets FOR ALL USING (
    user_is_pet_owner(pet_id)
);

-- === receipts ===
DROP POLICY IF EXISTS "receipts_select" ON receipts;
CREATE POLICY "receipts_select" ON receipts FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM expenses e
        WHERE e.transaction_id = receipts.transaction_id
        AND user_has_pet_access(e.pet_id)
    )
);

-- === reminders ===
DROP POLICY IF EXISTS "reminders_select" ON reminders;
DROP POLICY IF EXISTS "reminders_all" ON reminders;

CREATE POLICY "reminders_select" ON reminders FOR SELECT USING (
    user_has_pet_access(pet_id)
);
CREATE POLICY "reminders_all" ON reminders FOR ALL USING (
    user_is_pet_owner(pet_id)
);
