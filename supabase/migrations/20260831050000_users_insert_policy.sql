-- เพิ่ม INSERT policy สำหรับ users table
-- ให้ authenticated user สร้าง profile ตัวเองได้ตอน signup
CREATE POLICY "users_insert" ON users FOR INSERT WITH CHECK (
    auth_id = auth.uid()
);
