-- =====================================================================
-- Migration: Fix 'Database error saving new user' during Signup
-- 
-- สาเหตุ: Trigger บน auth.users (on_auth_user_created) เรียกใช้ฟังก์ชันที่
--         ใช้ auth.uid() ซึ่งเป็น NULL ตอน signup ทำให้เกิด NOT NULL violation 
--         ใน pet_access (user_id IS NULL) และทำให้ Supabase Auth rollback
--
-- วิธีแก้:
--   1. แก้ไข handle_new_user() ให้ใช้ตัวแปร NEW (NEW.id, NEW.email, NEW.raw_user_meta_data)
--   2. ไม่ auto-insert pet_access ที่ user_id เป็น NULL
--   3. Link ข้อมูลผู้ใช้เดิมถ้าอีเมลตรงกับ seed data (auth_id IS NULL)
--   4. รองรับ ON CONFLICT (email) ป้องกันข้อผิดพลาด duplicate
-- =====================================================================

-- 1. สร้าง/อัปเดตฟังก์ชัน handle_new_user สำหรับ Trigger auth.users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    v_name TEXT;
    v_role TEXT;
    v_existing_user_id INT;
BEGIN
    -- ดึงชื่อและบทบาทจาก raw_user_meta_data (ส่งมาจากหน้าสมัครสมาชิก)
    v_name := COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1), 'User');
    v_role := COALESCE(NEW.raw_user_meta_data->>'role', 'Owner');

    -- ตรวจสอบ Role ให้อยู่ในค่าที่อนุญาต ('Owner', 'Co-caretaker')
    IF v_role NOT IN ('Owner', 'Co-caretaker') THEN
        v_role := 'Owner';
    END IF;

    -- ตรวจสอบว่ามีข้อมูลผู้ใช้เดิมในตาราง users ที่อีเมลตรงกันและยังไม่มี auth_id หรือไม่ (เช่น Seed Data)
    SELECT user_id INTO v_existing_user_id
    FROM public.users
    WHERE email = NEW.email AND auth_id IS NULL
    LIMIT 1;

    IF v_existing_user_id IS NOT NULL THEN
        -- Link กับข้อมูลเดิมที่มีอยู่
        UPDATE public.users 
        SET auth_id = NEW.id,
            name = COALESCE(NULLIF(v_name, ''), name),
            role = v_role
        WHERE user_id = v_existing_user_id;
    ELSE
        -- สร้างแถวผู้ใช้ใหม่ในตาราง public.users
        INSERT INTO public.users (name, email, password, role, auth_id)
        VALUES (
            v_name,
            NEW.email,
            'auth_managed',
            v_role,
            NEW.id
        )
        ON CONFLICT (email) DO UPDATE
        SET auth_id = EXCLUDED.auth_id,
            name = COALESCE(NULLIF(EXCLUDED.name, ''), public.users.name);
    END IF;

    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    -- ในกรณีที่เกิดข้อผิดพลาด ให้บันทึก error แต่ปล่อยให้ auth user สร้างสำเร็จได้
    RAISE WARNING 'handle_new_user error: %', SQLERRM;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 2. สร้าง Trigger บนตาราง auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();

-- 3. ปรับปรุงฟังก์ชัน auto_link_user (สำหรับเรียกผ่าน RPC เมื่อ user ล็อกอินแล้ว)
CREATE OR REPLACE FUNCTION public.auto_link_user()
RETURNS VOID AS $$
DECLARE
    v_auth_id UUID := auth.uid();
    v_user_email TEXT;
    v_existing_user_id INT;
BEGIN
    -- ถ้าไม่มี auth_id (ยังไม่ได้ login) ให้ return ออกทันที
    IF v_auth_id IS NULL THEN
        RETURN;
    END IF;

    -- ตรวจสอบว่าใน public.users มี auth_id นี้หรือยัง
    IF NOT EXISTS (SELECT 1 FROM public.users WHERE auth_id = v_auth_id) THEN
        -- ดึง email จาก auth.users
        SELECT email INTO v_user_email
        FROM auth.users 
        WHERE id = v_auth_id;
        
        IF v_user_email IS NOT NULL THEN
            -- หา users record ที่มีอีเมลตรงกันแต่ auth_id เป็น NULL
            SELECT user_id INTO v_existing_user_id 
            FROM public.users 
            WHERE email = v_user_email AND auth_id IS NULL
            LIMIT 1;
            
            IF v_existing_user_id IS NOT NULL THEN
                UPDATE public.users SET auth_id = v_auth_id WHERE user_id = v_existing_user_id;
            ELSE
                INSERT INTO public.users (name, email, password, role, auth_id)
                VALUES (
                    split_part(v_user_email, '@', 1),
                    v_user_email,
                    'auth_managed',
                    'Owner',
                    v_auth_id
                )
                ON CONFLICT (email) DO UPDATE SET auth_id = EXCLUDED.auth_id;
            END IF;
        END IF;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ให้สิทธิ์ execute ฟังก์ชัน
GRANT EXECUTE ON FUNCTION public.auto_link_user() TO authenticated;
GRANT EXECUTE ON FUNCTION public.auto_link_user() TO anon;
