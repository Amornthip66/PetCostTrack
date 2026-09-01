-- =====================================================================
-- ส่วนที่ 4: Role-Based Row Level Security (RLS) Policies
-- วัตถุประสงค์: ให้ผู้ใช้เห็น/แก้ไขเฉพาะข้อมูลที่ตัวเองมีสิทธิ์
-- =====================================================================

-- 4.1 เพิ่มคอลัมน์ auth_id ในตาราง users เพื่อเชื่อมกับ Supabase Auth
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL;

-- 4.2 สร้าง Helper Function: ตรวจสอบว่า user_id ปัจจุบันเป็น Owner ของสัตว์เลี้ยงตัวไหนบ้าง
CREATE OR REPLACE FUNCTION get_user_pet_ids(check_user_id INT)
RETURNS SETOF INT AS $$
    SELECT pet_id FROM pet_access WHERE user_id = check_user_id;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- 4.3 สร้าง Helper Function: ดึง user_id จาก auth.uid()
CREATE OR REPLACE FUNCTION auth_user_id()
RETURNS INT AS $$
    SELECT user_id FROM users WHERE auth_id = auth.uid() LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- =====================================================================
-- DROP existing broad policies แล้วสร้างใหม่แบบ role-based
-- =====================================================================

-- === categories: อ่านได้ทุกคน (ข้อมูลสาธารณะ) ===
DROP POLICY IF EXISTS "Allow anon read categories" ON categories;
CREATE POLICY "Anyone can read categories" ON categories
    FOR SELECT USING (true);

-- === users: เห็นเฉพาะตัวเอง + คนในครอบครัวเดียวกัน ===
DROP POLICY IF EXISTS "Allow anon read users" ON users;
CREATE POLICY "Users can read own profile" ON users
    FOR SELECT USING (
        auth_id = auth.uid()  -- เห็นตัวเอง
        OR user_id IN (       -- เห็นคนในครอบครัวเดียวกัน (มีสัตว์เลี้ยงร่วม)
            SELECT pa2.user_id FROM pet_access pa2
            WHERE pa2.pet_id IN (
                SELECT pa1.pet_id FROM pet_access pa1
                WHERE pa1.user_id = auth_user_id()
            )
        )
    );

-- === pets: เห็นเฉพาะสัตว์เลี้ยงที่ตัวเองมีสิทธิ์ดูแล ===
DROP POLICY IF EXISTS "Allow anon read pets" ON pets;
CREATE POLICY "Users can read own pets" ON pets
    FOR SELECT USING (
        pet_id IN (SELECT pet_id FROM pet_access WHERE user_id = auth_user_id())
        OR auth_user_id() IS NULL  -- ยังไม่ login ก็เห็น (demo mode)
    );

-- === pet_access: เห็นเฉพาะสัตว์เลี้ยงที่ตัวเองมีสิทธิ์ ===
DROP POLICY IF EXISTS "Allow anon read pet_access" ON pet_access;
CREATE POLICY "Users can read own pet_access" ON pet_access
    FOR SELECT USING (
        user_id = auth_user_id()
        OR pet_id IN (SELECT pet_id FROM pet_access WHERE user_id = auth_user_id())
        OR auth_user_id() IS NULL
    );

-- === expenses: Owner/Co-caretaker ของสัตว์เลี้ยงเห็น/เพิ่มได้ ===
DROP POLICY IF EXISTS "Allow anon read expenses" ON expenses;
DROP POLICY IF EXISTS "Allow anon insert expenses" ON expenses;

CREATE POLICY "Users can read expenses for their pets" ON expenses
    FOR SELECT USING (
        pet_id IN (SELECT pet_id FROM pet_access WHERE user_id = auth_user_id())
        OR auth_user_id() IS NULL
    );

CREATE POLICY "Co-caretaker can insert expenses" ON expenses
    FOR INSERT WITH CHECK (
        user_id = auth_user_id()
        OR auth_user_id() IS NULL
    );

CREATE POLICY "Owner can update expenses" ON expenses
    FOR UPDATE USING (
        user_id = auth_user_id()
        AND EXISTS (
            SELECT 1 FROM pet_access
            WHERE pet_id = expenses.pet_id
            AND user_id = auth_user_id()
            AND access_role = 'Owner'
        )
    );

CREATE POLICY "Owner can delete expenses" ON expenses
    FOR DELETE USING (
        user_id = auth_user_id()
        AND EXISTS (
            SELECT 1 FROM pet_access
            WHERE pet_id = expenses.pet_id
            AND user_id = auth_user_id()
            AND access_role = 'Owner'
        )
    );

-- === budgets: Owner จัดการได้, Co-caretaker ดูได้ ===
DROP POLICY IF EXISTS "Allow anon read budgets" ON budgets;
CREATE POLICY "Users can read budgets for their pets" ON budgets
    FOR SELECT USING (
        pet_id IN (SELECT pet_id FROM pet_access WHERE user_id = auth_user_id())
        OR auth_user_id() IS NULL
    );

CREATE POLICY "Owner can manage budgets" ON budgets
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM pet_access
            WHERE pet_id = budgets.pet_id
            AND user_id = auth_user_id()
            AND access_role = 'Owner'
        )
        OR auth_user_id() IS NULL
    );

-- === receipts: เห็นเฉพาะใบเสร็จของค่าใช้จ่ายที่ตัวเองมีสิทธิ์ ===
DROP POLICY IF EXISTS "Allow anon read receipts" ON receipts;
CREATE POLICY "Users can read receipts for their expenses" ON receipts
    FOR SELECT USING (
        transaction_id IN (
            SELECT e.transaction_id FROM expenses e
            WHERE e.pet_id IN (SELECT pet_id FROM pet_access WHERE user_id = auth_user_id())
        )
        OR auth_user_id() IS NULL
    );

-- === reminders: Owner/Co-caretaker ของสัตว์เลี้ยงเห็น/จัดการได้ ===
DROP POLICY IF EXISTS "Allow anon read reminders" ON reminders;
CREATE POLICY "Users can read reminders for their pets" ON reminders
    FOR SELECT USING (
        pet_id IN (SELECT pet_id FROM pet_access WHERE user_id = auth_user_id())
        OR auth_user_id() IS NULL
    );

CREATE POLICY "Owner can manage reminders" ON reminders
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM pet_access
            WHERE pet_id = reminders.pet_id
            AND user_id = auth_user_id()
            AND access_role = 'Owner'
        )
        OR auth_user_id() IS NULL
    );
