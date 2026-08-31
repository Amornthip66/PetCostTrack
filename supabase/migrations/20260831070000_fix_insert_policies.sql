-- =====================================================================
-- ส่วนที่ 8: แก้ INSERT/UPDATE/DELETE policies ที่หายไป
-- ปัญหา: เพิ่มสัตว์เลี้ยง/แก้ไข/ลบ ไม่ได้ เพราะไม่มี INSERT policy
-- =====================================================================

-- === pets: เพิ่ม INSERT/UPDATE/DELETE ===
-- ใครก็สร้างสัตว์เลี้ยงได้ (แล้วค่อยเพิ่ม pet_access)
CREATE POLICY "pets_insert" ON pets FOR INSERT WITH CHECK (
    auth.uid() IS NOT NULL
);

-- เฉพาะ Owner ของสัตว์เลี้ยงเท่านั้นที่แก้ไขได้
CREATE POLICY "pets_update" ON pets FOR UPDATE USING (
    user_is_pet_owner(pet_id)
);

-- เฉพาะ Owner ของสัตว์เลี้ยงเท่านั้นที่ลบได้
CREATE POLICY "pets_delete" ON pets FOR DELETE USING (
    user_is_pet_owner(pet_id)
);

-- === pet_access: เพิ่ม INSERT/UPDATE/DELETE ===
-- ใครก็เพิ่ม pet_access ได้ (ใช้ตอนสร้างสัตว์เลี้ยงใหม่)
CREATE POLICY "pet_access_insert" ON pet_access FOR INSERT WITH CHECK (
    auth.uid() IS NOT NULL
);

-- เฉพาะ Owner ของสัตว์เลี้ยงเท่านั้นที่แก้ไขสิทธิ์ได้
CREATE POLICY "pet_access_update" ON pet_access FOR UPDATE USING (
    user_is_pet_owner(pet_id)
);

-- เฉพาะ Owner ของสัตว์เลี้ยงเท่านั้นที่ลบสิทธิ์ได้
CREATE POLICY "pet_access_delete" ON pet_access FOR DELETE USING (
    user_is_pet_owner(pet_id)
);

-- === receipts: เพิ่ม INSERT ===
CREATE POLICY "receipts_insert" ON receipts FOR INSERT WITH CHECK (
    EXISTS (
        SELECT 1 FROM expenses e
        WHERE e.transaction_id = receipts.transaction_id
        AND user_has_pet_access(e.pet_id)
    )
);

-- === reminders: เพิ่ม INSERT ===
-- (budgets_all และ reminders_all ใช้ FOR ALL อยู่แล้ว แต่ต้องแก้ให้ INSERT ได้ตอน pet_access ยังไม่มี)
DROP POLICY IF EXISTS "budgets_all" ON budgets;
CREATE POLICY "budgets_insert" ON budgets FOR INSERT WITH CHECK (
    user_is_pet_owner(pet_id)
);
CREATE POLICY "budgets_update" ON budgets FOR UPDATE USING (
    user_is_pet_owner(pet_id)
);
CREATE POLICY "budgets_delete" ON budgets FOR DELETE USING (
    user_is_pet_owner(pet_id)
);

DROP POLICY IF EXISTS "reminders_all" ON reminders;
CREATE POLICY "reminders_insert" ON reminders FOR INSERT WITH CHECK (
    user_is_pet_owner(pet_id)
);
CREATE POLICY "reminders_update" ON reminders FOR UPDATE USING (
    user_is_pet_owner(pet_id)
);
CREATE POLICY "reminders_delete" ON reminders FOR DELETE USING (
    user_is_pet_owner(pet_id)
);

-- =====================================================================
-- แก้ auto_link_user: link เฉพาะเมื่อ email ตรงกัน (ไม่ steal ข้อมูลคนอื่น)
-- =====================================================================
CREATE OR REPLACE FUNCTION auto_link_user()
RETURNS VOID AS $$
DECLARE
    v_auth_id UUID := auth.uid();
    v_user_email TEXT;
    v_existing_user_id INT;
BEGIN
    -- ถ้ายังไม่มี users record สำหรับ auth นี้
    IF NOT EXISTS (SELECT 1 FROM users WHERE auth_id = v_auth_id) THEN
        -- ดึง email จาก auth.users
        SELECT email INTO v_user_email
        FROM auth.users 
        WHERE id = v_auth_id;
        
        IF v_user_email IS NOT NULL THEN
            -- หา users record ที่มี email เดียวกันแต่ไม่มี auth_id (seed data)
            SELECT user_id INTO v_existing_user_id 
            FROM users 
            WHERE email = v_user_email AND auth_id IS NULL
            LIMIT 1;
            
            IF v_existing_user_id IS NOT NULL THEN
                -- Link: อัปเดต auth_id ของ record เดิม
                UPDATE users SET auth_id = v_auth_id WHERE user_id = v_existing_user_id;
            ELSE
                -- สร้าง users record ใหม่
                INSERT INTO users (name, email, password, role, auth_id)
                VALUES (
                    COALESCE(v_user_email, 'User'),
                    v_user_email,
                    'auth_managed',
                    'Owner',
                    v_auth_id
                );
            END IF;
        END IF;
    END IF;
    
    -- ถ้ายังไม่มี pet_access → ให้สิทธิ์เข้าถึงทุกสัตว์เลี้ยง (เฉพาะตอนมีสัตว์เลี้ยง)
    IF EXISTS (SELECT 1 FROM pets) AND NOT EXISTS (
        SELECT 1 FROM pet_access 
        WHERE user_id = (SELECT user_id FROM users WHERE auth_id = v_auth_id)
    ) THEN
        INSERT INTO pet_access (pet_id, user_id, access_role)
        SELECT p.pet_id, 
               (SELECT user_id FROM users WHERE auth_id = v_auth_id),
               'Owner'
        FROM pets p
        ON CONFLICT DO NOTHING;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
