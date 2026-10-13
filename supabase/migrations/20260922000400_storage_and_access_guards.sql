-- =====================================================================
-- Migration: สิทธิ์แก้/ลบรายจ่ายภายใน 30 วัน และสิทธิ์ใบเสร็จ/ส่วนแบ่งตามรายจ่าย
--
-- ไฟล์นี้สร้างคืนจากสถานะฐานข้อมูลจริง (Supabase) ณ 13 ต.ค. 2569 เพราะตอนรัน
-- migration นี้ครั้งแรก ประวัติไม่ได้บันทึกคำสั่งไว้ (supabase_migrations มีแค่เลขเวอร์ชัน)
--
-- - expense_edit_window_days(): แก้ไข/ลบรายจ่ายได้ภายใน 30 วันหลังบันทึก (BR-05)
-- - user_can_modify_expense(): เงื่อนไขเดียวกับ expenses_update ใช้ซ้ำกับ receipts และ
--   expense_pet_shares เพื่อให้แก้ใบเสร็จ/ส่วนแบ่งได้เฉพาะคนที่แก้รายจ่ายนั้นได้
-- - expense_primary_pet() / expense_shared_with_me(): ใช้ใน policy โดยไม่เกิด RLS วนซ้ำ
-- - storage receipts: ไฟล์อยู่ในโฟลเดอร์ <pet_id>/ ตรวจสิทธิ์ด้วย user_has_pet_access()
-- รันซ้ำได้ (idempotent)
-- =====================================================================

CREATE OR REPLACE FUNCTION public.expense_edit_window_days()
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
AS $function$
    SELECT 30;
$function$;

CREATE OR REPLACE FUNCTION public.expense_primary_pet(p_transaction_id integer)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT pet_id FROM expenses WHERE transaction_id = p_transaction_id;
$function$;

CREATE OR REPLACE FUNCTION public.expense_shared_with_me(p_transaction_id integer)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT EXISTS (
        SELECT 1 FROM expense_pet_shares
        WHERE transaction_id = p_transaction_id
          AND user_has_pet_access(pet_id)
    );
$function$;

CREATE OR REPLACE FUNCTION public.user_can_modify_expense(p_transaction_id integer)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT EXISTS (
        SELECT 1 FROM expenses e
        WHERE e.transaction_id = p_transaction_id
          AND (user_is_pet_owner(e.pet_id)
               OR (e.user_id = auth_user_id() AND user_has_pet_access(e.pet_id)))
          AND e.created_at >= now() - (expense_edit_window_days() * INTERVAL '1 day')
    );
$function$;

CREATE OR REPLACE FUNCTION public.storage_path_pet_id(p_name text)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
AS $function$
    SELECT CASE WHEN split_part(p_name, '/', 1) ~ '^[0-9]{1,9}$'
                THEN split_part(p_name, '/', 1)::INT END;
$function$;

-- ---------------------------------------------------------------- expenses
DROP POLICY IF EXISTS expenses_select ON public.expenses;
CREATE POLICY expenses_select ON public.expenses
    FOR SELECT USING (user_has_pet_access(pet_id) OR expense_shared_with_me(transaction_id));

DROP POLICY IF EXISTS expenses_insert ON public.expenses;
CREATE POLICY expenses_insert ON public.expenses
    FOR INSERT WITH CHECK ((user_id = auth_user_id()) AND user_has_pet_access(pet_id));

DROP POLICY IF EXISTS expenses_update ON public.expenses;
CREATE POLICY expenses_update ON public.expenses
    FOR UPDATE
    USING ((user_is_pet_owner(pet_id) OR ((user_id = auth_user_id()) AND user_has_pet_access(pet_id)))
           AND (created_at >= (now() - ((expense_edit_window_days())::double precision * '1 day'::interval))))
    WITH CHECK (user_has_pet_access(pet_id));

DROP POLICY IF EXISTS expenses_delete ON public.expenses;
CREATE POLICY expenses_delete ON public.expenses
    FOR DELETE
    USING ((user_is_pet_owner(pet_id) OR ((user_id = auth_user_id()) AND user_has_pet_access(pet_id)))
           AND (created_at >= (now() - ((expense_edit_window_days())::double precision * '1 day'::interval))));

-- ---------------------------------------------------------------- expense_pet_shares
DROP POLICY IF EXISTS expense_pet_shares_select ON public.expense_pet_shares;
CREATE POLICY expense_pet_shares_select ON public.expense_pet_shares
    FOR SELECT USING (user_has_pet_access(pet_id) OR user_has_pet_access(expense_primary_pet(transaction_id)));

DROP POLICY IF EXISTS expense_pet_shares_insert ON public.expense_pet_shares;
CREATE POLICY expense_pet_shares_insert ON public.expense_pet_shares
    FOR INSERT WITH CHECK (user_has_pet_access(pet_id) AND user_can_modify_expense(transaction_id));

DROP POLICY IF EXISTS expense_pet_shares_delete ON public.expense_pet_shares;
CREATE POLICY expense_pet_shares_delete ON public.expense_pet_shares
    FOR DELETE USING (user_can_modify_expense(transaction_id));

-- ---------------------------------------------------------------- receipts
DROP POLICY IF EXISTS receipts_select ON public.receipts;
CREATE POLICY receipts_select ON public.receipts
    FOR SELECT USING (user_has_pet_access(expense_primary_pet(transaction_id)));

DROP POLICY IF EXISTS receipts_insert ON public.receipts;
CREATE POLICY receipts_insert ON public.receipts
    FOR INSERT WITH CHECK (user_can_modify_expense(transaction_id));

DROP POLICY IF EXISTS receipts_update ON public.receipts;
CREATE POLICY receipts_update ON public.receipts
    FOR UPDATE USING (user_can_modify_expense(transaction_id))
    WITH CHECK (user_can_modify_expense(transaction_id));

DROP POLICY IF EXISTS receipts_delete ON public.receipts;
CREATE POLICY receipts_delete ON public.receipts
    FOR DELETE USING (user_can_modify_expense(transaction_id));

-- ---------------------------------------------------------------- storage: bucket receipts
DROP POLICY IF EXISTS receipts_storage_select ON storage.objects;
CREATE POLICY receipts_storage_select ON storage.objects
    FOR SELECT USING ((bucket_id = 'receipts') AND user_has_pet_access(((storage.foldername(name))[1])::integer));

DROP POLICY IF EXISTS receipts_storage_insert ON storage.objects;
CREATE POLICY receipts_storage_insert ON storage.objects
    FOR INSERT WITH CHECK ((bucket_id = 'receipts') AND user_has_pet_access(((storage.foldername(name))[1])::integer));

DROP POLICY IF EXISTS receipts_storage_update ON storage.objects;
CREATE POLICY receipts_storage_update ON storage.objects
    FOR UPDATE USING ((bucket_id = 'receipts') AND user_has_pet_access(((storage.foldername(name))[1])::integer));

DROP POLICY IF EXISTS receipts_storage_delete ON storage.objects;
CREATE POLICY receipts_storage_delete ON storage.objects
    FOR DELETE USING ((bucket_id = 'receipts') AND user_has_pet_access(((storage.foldername(name))[1])::integer));
