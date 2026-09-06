-- =====================================================================
-- Migration: รองรับไฟล์ใบเสร็จ .pdf + เพิ่มสิทธิ์ลบ/แทนที่ใบเสร็จ
--
-- ที่มา:
--   1. เดิม chk_receipts_filetype อนุญาตแค่ .jpg/.jpeg/.png ต้องเพิ่ม .pdf
--   2. ตาราง receipts มีแค่ policy receipts_select และ receipts_insert
--      (จาก 20260904000000_enforce_strict_rls.sql) ไม่มี UPDATE/DELETE เลย
--      ทำให้ทั้งฟีเจอร์ "แทนที่ใบเสร็จเดิม" (Api.update) และ "ลบใบเสร็จ"
--      (Api.remove) ที่จะเพิ่มใหม่ ถูก RLS บล็อกเงียบๆ ต้องเพิ่ม policy
--      ให้ครบทั้ง UPDATE และ DELETE โดยใช้เงื่อนไขเดียวกับ receipts_insert
--      (ผู้ใช้ที่มีสิทธิ์เข้าถึงสัตว์เลี้ยงของรายจ่ายนั้น)
--   3. ปรับ storage bucket "receipts" (ถ้ามีอยู่แล้ว) ให้จำกัดขนาดไฟล์
--      ไม่เกิน 50MB และรับเฉพาะไฟล์ jpg/jpeg/png/pdf ที่ระดับ storage ด้วย
--      เป็นการป้องกันอีกชั้นนอกจาก check ฝั่ง client ใน history.js
--
-- รันซ้ำได้ (idempotent)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. ปรับ CHECK constraint ของนามสกุลไฟล์ใบเสร็จ: เพิ่ม .pdf
-- ---------------------------------------------------------------------
ALTER TABLE public.receipts DROP CONSTRAINT IF EXISTS chk_receipts_filetype;
ALTER TABLE public.receipts ADD CONSTRAINT chk_receipts_filetype CHECK (
    image_path ILIKE '%.jpg' OR image_path ILIKE '%.jpeg'
    OR image_path ILIKE '%.png' OR image_path ILIKE '%.pdf'
);

-- ---------------------------------------------------------------------
-- 2. เพิ่ม policy UPDATE/DELETE ให้ receipts (เดิมมีแค่ select/insert)
--    ใช้เงื่อนไขเดียวกับ receipts_insert: ผู้ใช้ต้องมีสิทธิ์เข้าถึง
--    สัตว์เลี้ยงของรายจ่ายที่ใบเสร็จนี้ผูกอยู่
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "receipts_update" ON public.receipts;
CREATE POLICY "receipts_update" ON public.receipts
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM expenses e
            WHERE e.transaction_id = receipts.transaction_id
            AND user_has_pet_access(e.pet_id)
        )
    );

DROP POLICY IF EXISTS "receipts_delete" ON public.receipts;
CREATE POLICY "receipts_delete" ON public.receipts
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM expenses e
            WHERE e.transaction_id = receipts.transaction_id
            AND user_has_pet_access(e.pet_id)
        )
    );

-- ---------------------------------------------------------------------
-- 3. จำกัดขนาดไฟล์ (50MB) และชนิดไฟล์ที่ storage bucket "receipts"
--    ถ้า bucket นี้ยังไม่ถูกสร้างไว้ (เช่น local dev ที่เพิ่ง reset)
--    statement นี้จะแค่ไม่ update แถวไหนเลย ไม่ error
-- ---------------------------------------------------------------------
UPDATE storage.buckets
SET file_size_limit = 52428800, -- 50 MiB
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'application/pdf']
WHERE id = 'receipts';
