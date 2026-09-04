-- =====================================================================
-- Migration: บังคับใช้ RLS แบบเข้มงวด (Strict Per-User RLS) ทั้งระบบ
--
-- ปัญหาที่เจอบน Production:
--   ตารางหลัก (pets, expenses, budgets, receipts, reminders) ยังใช้
--   policy แบบ "demo mode" จาก migration ช่วงแรก ซึ่งมีเงื่อนไข fallback
--   ประมาณ "auth_user_id() IS NULL" หรือ "ผู้ใช้ที่ยังไม่มี pet_access
--   เห็นข้อมูลทั้งหมด" ทำให้:
--     - คนที่ยังไม่ได้ login (anon) อ่านข้อมูลของทุกคนได้ทั้งหมด
--     - ผู้ใช้ที่ login แล้วแต่ยังไม่มี pet_access เห็นข้อมูลทั้งหมด
--     - พอเพิ่มสัตว์เลี้ยงตัวแรก (ได้ pet_access) ถึงเห็นแค่ของตัวเอง
--       และพอลบสัตว์เลี้ยงออก กลับไปเห็นข้อมูลทั้งหมดอีกครั้ง
--
-- วิธีแก้:
--   1. เปิด RLS ให้ครบทุกตาราง (บางตารางอาจยังไม่ได้เปิด)
--   2. ลบ policy เก่าทั้งหมดบน 8 ตาราง (รวม policy ที่อาจแก้มือไว้)
--   3. สร้าง policy ชุดใหม่แบบเข้มงวด (ตาม 20260831040000 + 0500 + 0700)
--   4. ตรวจ/ติดตั้ง auto_link_user + trigger handle_new_user ให้พร้อม
--      (ผู้ใช้ใหม่ต้องได้ auth_id ตั้งแต่สมัคร ไม่งั้นมองไม่เห็นข้อมูลตัวเอง)
--
-- รันซ้ำได้ (idempotent)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Helper functions (เหมือน migration ก่อนหน้า กันไว้ว่าต้องมีอยู่จริง)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auth_user_id()
RETURNS INT AS $$
    SELECT user_id FROM users WHERE auth_id = auth.uid() LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.user_has_pet_access(check_pet_id INT)
RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1 FROM pet_access
        WHERE pet_id = check_pet_id
        AND user_id = auth_user_id()
    );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.user_is_pet_owner(check_pet_id INT)
RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1 FROM pet_access
        WHERE pet_id = check_pet_id
        AND user_id = auth_user_id()
        AND access_role = 'Owner'
    );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.users_share_pet(check_user_id INT)
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

-- ให้ PostgREST roles (anon/authenticated) เรียกฟังก์ชันเหล่านี้ได้
-- (เผื่อกรณี privilege ถูก revoke ไว้ จะได้ไม่พัง)
GRANT EXECUTE ON FUNCTION public.auth_user_id() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_pet_access(INT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_is_pet_owner(INT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.users_share_pet(INT) TO anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. เปิด RLS ให้ครบทุกตาราง (idempotent)
-- ---------------------------------------------------------------------
ALTER TABLE public.users       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pets        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pet_access  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budgets     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receipts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reminders   ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------
-- 3. ลบ policy เก่าทั้งหมดบน 8 ตาราง
--    (ครอบคลุมชื่อ policy จากทุก migration + policy ที่แก้มือไว้)
-- ---------------------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
    FOR r IN
        SELECT policyname, tablename
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename IN ('users','pets','categories','pet_access','budgets','expenses','receipts','reminders')
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
    END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 4. สร้าง policy ชุดใหม่แบบเข้มงวด
--    (ไม่มี fallback เปิดข้อมูลทั้งหมดเด็ดขาด)
-- ---------------------------------------------------------------------

-- === categories: ข้อมูลสาธารณะ อ่านได้ทุกคน ===
CREATE POLICY "categories_select" ON public.categories
    FOR SELECT USING (true);

-- === users: เห็นเฉพาะตัวเอง + คนในครอบครัวเดียวกัน; สร้างได้เฉพาะ profile ตัวเอง ===
CREATE POLICY "users_select" ON public.users
    FOR SELECT USING (
        auth_id = auth.uid()
        OR users_share_pet(user_id)
    );

CREATE POLICY "users_insert" ON public.users
    FOR INSERT WITH CHECK (
        auth_id = auth.uid()
    );

-- === pets: เห็นเฉพาะสัตว์เลี้ยงที่มีสิทธิ์ (ผ่าน pet_access) ===
CREATE POLICY "pets_select" ON public.pets
    FOR SELECT USING (
        user_has_pet_access(pet_id)
    );

CREATE POLICY "pets_insert" ON public.pets
    FOR INSERT WITH CHECK (
        auth.uid() IS NOT NULL
    );

CREATE POLICY "pets_update" ON public.pets
    FOR UPDATE USING (
        user_is_pet_owner(pet_id)
    );

CREATE POLICY "pets_delete" ON public.pets
    FOR DELETE USING (
        user_is_pet_owner(pet_id)
    );

-- === pet_access ===
CREATE POLICY "pet_access_select" ON public.pet_access
    FOR SELECT USING (
        user_id = auth_user_id()
        OR user_has_pet_access(pet_id)
    );

CREATE POLICY "pet_access_insert" ON public.pet_access
    FOR INSERT WITH CHECK (
        auth.uid() IS NOT NULL
    );

CREATE POLICY "pet_access_update" ON public.pet_access
    FOR UPDATE USING (
        user_is_pet_owner(pet_id)
    );

CREATE POLICY "pet_access_delete" ON public.pet_access
    FOR DELETE USING (
        user_is_pet_owner(pet_id)
    );

-- === expenses: Owner/Co-caretaker ของสัตว์เลี้ยงเห็น/เพิ่มได้, Owner แก้ไข/ลบได้ ===
CREATE POLICY "expenses_select" ON public.expenses
    FOR SELECT USING (
        user_has_pet_access(pet_id)
    );

CREATE POLICY "expenses_insert" ON public.expenses
    FOR INSERT WITH CHECK (
        user_id = auth_user_id()
    );

CREATE POLICY "expenses_update" ON public.expenses
    FOR UPDATE USING (
        user_is_pet_owner(pet_id)
    );

CREATE POLICY "expenses_delete" ON public.expenses
    FOR DELETE USING (
        user_is_pet_owner(pet_id)
    );

-- === budgets: Owner จัดการได้, Co-caretaker ดูได้ ===
CREATE POLICY "budgets_select" ON public.budgets
    FOR SELECT USING (
        user_has_pet_access(pet_id)
    );

CREATE POLICY "budgets_insert" ON public.budgets
    FOR INSERT WITH CHECK (
        user_is_pet_owner(pet_id)
    );

CREATE POLICY "budgets_update" ON public.budgets
    FOR UPDATE USING (
        user_is_pet_owner(pet_id)
    );

CREATE POLICY "budgets_delete" ON public.budgets
    FOR DELETE USING (
        user_is_pet_owner(pet_id)
    );

-- === receipts ===
CREATE POLICY "receipts_select" ON public.receipts
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM expenses e
            WHERE e.transaction_id = receipts.transaction_id
            AND user_has_pet_access(e.pet_id)
        )
    );

CREATE POLICY "receipts_insert" ON public.receipts
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM expenses e
            WHERE e.transaction_id = receipts.transaction_id
            AND user_has_pet_access(e.pet_id)
        )
    );

-- === reminders: Owner จัดการได้, Co-caretaker ดูได้ ===
CREATE POLICY "reminders_select" ON public.reminders
    FOR SELECT USING (
        user_has_pet_access(pet_id)
    );

CREATE POLICY "reminders_insert" ON public.reminders
    FOR INSERT WITH CHECK (
        user_is_pet_owner(pet_id)
    );

CREATE POLICY "reminders_update" ON public.reminders
    FOR UPDATE USING (
        user_is_pet_owner(pet_id)
    );

CREATE POLICY "reminders_delete" ON public.reminders
    FOR DELETE USING (
        user_is_pet_owner(pet_id)
    );

-- ---------------------------------------------------------------------
-- 5. auto_link_user + trigger handle_new_user (เผื่อ Production ยังใช้
--    เวอร์ชันเก่าที่ link ผิด/ไม่ link ให้ ผู้ใช้ใหม่จะได้ auth_id ตั้งแต่สมัคร)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auto_link_user()
RETURNS VOID AS $$
DECLARE
    v_auth_id UUID := auth.uid();
    v_user_email TEXT;
    v_existing_user_id INT;
BEGIN
    -- ถ้ายังไม่มี users record สำหรับ auth นี้ (ยังไม่ได้ link)
    IF NOT EXISTS (SELECT 1 FROM public.users WHERE auth_id = v_auth_id) THEN
        -- ดึง email จาก auth.users
        SELECT email INTO v_user_email
        FROM auth.users
        WHERE id = v_auth_id;

        IF v_user_email IS NOT NULL THEN
            -- หา users record ที่มีอีเมลตรงกันและยังไม่มี auth_id (seed data)
            SELECT user_id INTO v_existing_user_id
            FROM public.users
            WHERE email = v_user_email AND auth_id IS NULL
            LIMIT 1;

            IF v_existing_user_id IS NOT NULL THEN
                -- Link กับแถวเดิม (seed)
                UPDATE public.users
                SET auth_id = v_auth_id
                WHERE user_id = v_existing_user_id;
            ELSE
                -- สร้าง users record ใหม่
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

GRANT EXECUTE ON FUNCTION public.auto_link_user() TO authenticated;
GRANT EXECUTE ON FUNCTION public.auto_link_user() TO anon;

-- Trigger: หลังสร้าง auth user ให้สร้าง/link users record ทันที
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    v_name TEXT;
    v_role TEXT;
    v_existing_user_id INT;
BEGIN
    v_name := COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1), 'User');
    v_role := COALESCE(NEW.raw_user_meta_data->>'role', 'Owner');

    IF v_role NOT IN ('Owner', 'Co-caretaker') THEN
        v_role := 'Owner';
    END IF;

    SELECT user_id INTO v_existing_user_id
    FROM public.users
    WHERE email = NEW.email AND auth_id IS NULL
    LIMIT 1;

    IF v_existing_user_id IS NOT NULL THEN
        UPDATE public.users
        SET auth_id = NEW.id,
            name = COALESCE(NULLIF(v_name, ''), name),
            role = v_role
        WHERE user_id = v_existing_user_id;
    ELSE
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
    RAISE WARNING 'handle_new_user error: %', SQLERRM;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();

-- ---------------------------------------------------------------------
-- 6. ข้อมูล fix (จาก 20260831100000): สัตว์เลี้ยงตัวไหนที่ยังไม่มีใครเป็น
--    Owner เลย ให้เลื่อนสิทธิ์คนแรกที่ดูแลอยู่ขึ้นเป็น Owner
--    (ไม่งั้น policy pets_update/pets_delete (user_is_pet_owner)
--    จะบล็อกไม่ให้แก้ไข/ลบสัตว์เลี้ยงตัวนั้น)
-- ---------------------------------------------------------------------
UPDATE pet_access pa
SET access_role = 'Owner'
WHERE access_role <> 'Owner'
  AND NOT EXISTS (
      SELECT 1 FROM pet_access pa2
      WHERE pa2.pet_id = pa.pet_id
      AND pa2.access_role = 'Owner'
  );