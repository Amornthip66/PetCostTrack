-- =====================================================================
-- แก้ auto_link_user: 
-- 1. link เฉพาะเมื่อ email ตรงกัน (ไม่ steal ข้อมูลคนอื่น)
-- 2. ไม่ auto-assign pet_access ให้ user ใหม่ (ต้องสร้างสัตว์เลี้ยงเอง)
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
    
    -- ไม่ auto-assign pet_access — user ต้องสร้างสัตว์เลี้ยงเองผ่าน UI
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
