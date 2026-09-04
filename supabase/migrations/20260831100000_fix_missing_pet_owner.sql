-- =====================================================================
-- Migration: แก้ปัญหาลบสัตว์เลี้ยงไม่ได้ (ไม่พบข้อมูลที่จะลบ หรือคุณไม่มีสิทธิ์ลบรายการนี้)
--
-- สาเหตุ: ตอนสร้างสัตว์เลี้ยงใหม่ (js/pets.js) โค้ดเดิม insert ลง pet_access
--         โดยใช้ access_role = user.role (บทบาทระดับบัญชีของผู้ใช้ เช่น
--         'Co-caretaker') แทนที่จะบังคับให้เป็น 'Owner' เสมอ
--         ทำให้สัตว์เลี้ยงบางตัวไม่มีใครเป็น Owner เลย และ RLS policy
--         "pets_delete" / "pets_update" ซึ่งเช็ค user_is_pet_owner(pet_id)
--         (ต้อง access_role = 'Owner') เลยบล็อกไม่ให้ผู้สร้างแก้ไข/ลบ
--         สัตว์เลี้ยงของตัวเอง
--
-- วิธีแก้ข้อมูลเดิม: สำหรับสัตว์เลี้ยงตัวใดที่ยังไม่มีแถวที่ access_role = 'Owner'
--         เลยสักแถว ให้เลื่อนสิทธิ์ของทุกคนที่มี pet_access กับสัตว์เลี้ยงตัวนั้น
--         ขึ้นเป็น 'Owner' (เพื่อให้อย่างน้อยมีคนลบ/แก้ไขได้)
-- =====================================================================

UPDATE pet_access pa
SET access_role = 'Owner'
WHERE access_role <> 'Owner'
  AND NOT EXISTS (
      SELECT 1 FROM pet_access pa2
      WHERE pa2.pet_id = pa.pet_id
      AND pa2.access_role = 'Owner'
  );
