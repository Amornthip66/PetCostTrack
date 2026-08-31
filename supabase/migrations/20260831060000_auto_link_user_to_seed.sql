-- =====================================================================
-- ส่วนที่ 7: Auto-link user กับ seed data
-- ปัญหา: seed data ถูก INSERT โดยไม่มี auth_id
--         ทำให้ user ที่ signup ใหม่ไม่เห็นข้อมูล seed เลย
--
-- วิธีแก้: 
--   1. ถ้ามี users record ที่มีอีเมลเดียวกันแต่ไม่มี auth_id → link เลย
--   2. ถ้ายังไม่มี pet_access → ให้สิทธิ์เข้าถึงสัตว์เลี้ยงทุกตัว
-- =====================================================================

-- Function: auto-link auth user กับ existing users record
CREATE OR REPLACE FUNCTION auto_link_user()
RETURNS VOID AS $$
DECLARE
    v_auth_id UUID := auth.uid();
    v_existing_user_id INT;
BEGIN
    -- ถ้ายังไม่มี users record สำหรับ auth นี้ → หา record ที่มี auth_id = NULL แล้ว link
    IF NOT EXISTS (SELECT 1 FROM users WHERE auth_id = v_auth_id) THEN
        -- ลองหา users record ที่ไม่มี auth_id ตัวแรก
        SELECT user_id INTO v_existing_user_id 
        FROM users 
        WHERE auth_id IS NULL 
        LIMIT 1;
        
        IF v_existing_user_id IS NOT NULL THEN
            UPDATE users SET auth_id = v_auth_id WHERE user_id = v_existing_user_id;
        ELSE
            -- ไม่มี record ว่าง → สร้างใหม่ด้วย email จาก auth
            INSERT INTO users (name, email, password, role, auth_id)
            SELECT 
                COALESCE(raw_user_meta_data->>'name', email),
                email,
                'auth_managed',
                'Owner',
                v_auth_id
            FROM auth.users 
            WHERE id = v_auth_id
            ON CONFLICT (email) DO UPDATE SET auth_id = v_auth_id;
        END IF;
    END IF;
    
    -- ถ้ายังไม่มี pet_access → ให้สิทธิ์เข้าถึงทุกสัตว์เลี้ยง
    IF NOT EXISTS (
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

-- ให้ authenticated user เรียก function นี้ได้
GRANT EXECUTE ON FUNCTION auto_link_user() TO authenticated;
GRANT EXECUTE ON FUNCTION auto_link_user() TO anon;

-- Trigger: auto-link ทุกครั้งที่มี INSERT ลง users (หลัง signup)
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    -- auto-link ทันทีหลัง insert
    PERFORM auto_link_user();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION handle_new_user();
