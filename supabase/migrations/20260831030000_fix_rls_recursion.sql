-- =====================================================================
-- ส่วนที่ 5: แก้ไข infinite recursion ใน RLS Policies
-- ปัญหา: pet_access policy อ้างตัวเอง → loop ไม่จบ
-- วิธีแก้: ใช้ SECURITY DEFINER functions + นโยบายที่เรียบง่ายขึ้น
-- =====================================================================

-- 5.1 Helper: ดึง user_id จาก auth.uid() (SECURITY DEFINER = bypass RLS)
CREATE OR REPLACE FUNCTION auth_user_id()
RETURNS INT AS $$
    SELECT user_id FROM users WHERE auth_id = auth.uid() LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- 5.2 Helper: ตรวจว่า user มีสิทธิ์เข้าถึง pet_id ไหม (SECURITY DEFINER)
CREATE OR REPLACE FUNCTION user_has_pet_access(check_pet_id INT)
RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1 FROM pet_access
        WHERE pet_id = check_pet_id
        AND user_id = auth_user_id()
    );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- 5.3 Helper: ตรวจว่า user เป็น Owner ของ pet_id ไหม
CREATE OR REPLACE FUNCTION user_is_pet_owner(check_pet_id INT)
RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1 FROM pet_access
        WHERE pet_id = check_pet_id
        AND user_id = auth_user_id()
        AND access_role = 'Owner'
    );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- 5.4 Helper: ตรวจว่า user_id มีสัตว์เลี้ยงร่วมกับ check_user_id ไหม
CREATE OR REPLACE FUNCTION users_share_pet(check_user_id INT)
RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1 FROM pet_access pa1
        WHERE pa1.user_id = auth_user_id()
        AND pa1.pet_id IN (
            SELECT pa2.pet_id FROM pet_access pa2
            WHERE pa2.user_id = check_user_id
        )
    );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- =====================================================================
-- DROP นโยบายเดิมทั้งหมด แล้วสร้างใหม่
-- =====================================================================

-- === categories ===
DROP POLICY IF EXISTS "Anyone can read categories" ON categories;
DROP POLICY IF EXISTS "Allow anon read categories" ON categories;
CREATE POLICY "categories_select" ON categories FOR SELECT USING (true);

-- === users ===
DROP POLICY IF EXISTS "Users can read own profile" ON users;
DROP POLICY IF EXISTS "Allow anon read users" ON users;
CREATE POLICY "users_select" ON users FOR SELECT USING (
    auth_id = auth.uid()           -- เห็นตัวเอง
    OR users_share_pet(user_id)    -- เห็นคนในครอบครัวเดียวกัน
    OR auth_user_id() IS NULL      -- demo mode
);

-- === pets ===
DROP POLICY IF EXISTS "Users can read own pets" ON pets;
DROP POLICY IF EXISTS "Allow anon read pets" ON pets;
CREATE POLICY "pets_select" ON pets FOR SELECT USING (
    user_has_pet_access(pet_id)
    OR auth_user_id() IS NULL
);

-- === pet_access ===
DROP POLICY IF EXISTS "Users can read own pet_access" ON pet_access;
DROP POLICY IF EXISTS "Allow anon read pet_access" ON pet_access;
CREATE POLICY "pet_access_select" ON pet_access FOR SELECT USING (
    user_id = auth_user_id()
    OR user_has_pet_access(pet_id)
    OR auth_user_id() IS NULL
);

-- === expenses ===
DROP POLICY IF EXISTS "Users can read expenses for their pets" ON expenses;
DROP POLICY IF EXISTS "Co-caretaker can insert expenses" ON expenses;
DROP POLICY IF EXISTS "Owner can update expenses" ON expenses;
DROP POLICY IF EXISTS "Owner can delete expenses" ON expenses;
DROP POLICY IF EXISTS "Allow anon read expenses" ON expenses;
DROP POLICY IF EXISTS "Allow anon insert expenses" ON expenses;

CREATE POLICY "expenses_select" ON expenses FOR SELECT USING (
    user_has_pet_access(pet_id)
    OR auth_user_id() IS NULL
);

CREATE POLICY "expenses_insert" ON expenses FOR INSERT WITH CHECK (
    user_id = auth_user_id()
    OR auth_user_id() IS NULL
);

CREATE POLICY "expenses_update" ON expenses FOR UPDATE USING (
    user_is_pet_owner(pet_id)
    OR auth_user_id() IS NULL
);

CREATE POLICY "expenses_delete" ON expenses FOR DELETE USING (
    user_is_pet_owner(pet_id)
    OR auth_user_id() IS NULL
);

-- === budgets ===
DROP POLICY IF EXISTS "Users can read budgets for their pets" ON budgets;
DROP POLICY IF EXISTS "Owner can manage budgets" ON budgets;
DROP POLICY IF EXISTS "Allow anon read budgets" ON budgets;

CREATE POLICY "budgets_select" ON budgets FOR SELECT USING (
    user_has_pet_access(pet_id)
    OR auth_user_id() IS NULL
);

CREATE POLICY "budgets_all" ON budgets FOR ALL USING (
    user_is_pet_owner(pet_id)
    OR auth_user_id() IS NULL
);

-- === receipts ===
DROP POLICY IF EXISTS "Users can read receipts for their expenses" ON receipts;
DROP POLICY IF EXISTS "Allow anon read receipts" ON receipts;

CREATE POLICY "receipts_select" ON receipts FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM expenses e
        WHERE e.transaction_id = receipts.transaction_id
        AND user_has_pet_access(e.pet_id)
    )
    OR auth_user_id() IS NULL
);

-- === reminders ===
DROP POLICY IF EXISTS "Users can read reminders for their pets" ON reminders;
DROP POLICY IF EXISTS "Owner can manage reminders" ON reminders;
DROP POLICY IF EXISTS "Allow anon read reminders" ON reminders;

CREATE POLICY "reminders_select" ON reminders FOR SELECT USING (
    user_has_pet_access(pet_id)
    OR auth_user_id() IS NULL
);

CREATE POLICY "reminders_all" ON reminders FOR ALL USING (
    user_is_pet_owner(pet_id)
    OR auth_user_id() IS NULL
);
