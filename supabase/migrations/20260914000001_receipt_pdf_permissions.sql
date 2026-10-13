-- รองรับ PDF และการเปลี่ยน/ลบใบเสร็จ โดยคงสิทธิ์ Owner ตาม
-- expenses_update / expenses_delete ใน migration enforce_strict_rls
-- ไม่เปลี่ยนสิทธิ์อ่าน/เพิ่มใบเสร็จ หรือ policy ของตารางอื่น
BEGIN;

ALTER TABLE public.receipts
    DROP CONSTRAINT IF EXISTS chk_receipts_filetype;
ALTER TABLE public.receipts
    ADD CONSTRAINT chk_receipts_filetype CHECK (
        image_path ~* '\.(jpe?g|png|pdf)$'
    );

DROP POLICY IF EXISTS receipts_update ON public.receipts;
CREATE POLICY receipts_update ON public.receipts
    FOR UPDATE TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.expenses e
            WHERE e.transaction_id = receipts.transaction_id
              AND public.user_is_pet_owner(e.pet_id)
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.expenses e
            WHERE e.transaction_id = receipts.transaction_id
              AND public.user_is_pet_owner(e.pet_id)
        )
    );

DROP POLICY IF EXISTS receipts_delete ON public.receipts;
CREATE POLICY receipts_delete ON public.receipts
    FOR DELETE TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.expenses e
            WHERE e.transaction_id = receipts.transaction_id
              AND public.user_is_pet_owner(e.pet_id)
        )
    );

-- ปรับเฉพาะ bucket ใบเสร็จที่มีอยู่แล้ว ไม่เปลี่ยน public/private หรือ
-- Storage RLS และเก็บ MIME types เดิมไว้ (NULL หมายถึงไม่จำกัดชนิด)
UPDATE storage.buckets
SET file_size_limit = 52428800,
    allowed_mime_types = CASE
        WHEN allowed_mime_types IS NULL THEN NULL
        ELSE ARRAY(
            SELECT DISTINCT mime
            FROM unnest(allowed_mime_types || ARRAY[
                'image/jpeg', 'image/png', 'application/pdf'
            ]::text[]) AS mime
        )
    END
WHERE id = 'receipts';

COMMIT;
