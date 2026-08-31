-- Allow anon to read all tables
CREATE POLICY "Allow anon read users" ON users FOR SELECT USING (true);
CREATE POLICY "Allow anon read pets" ON pets FOR SELECT USING (true);
CREATE POLICY "Allow anon read categories" ON categories FOR SELECT USING (true);
CREATE POLICY "Allow anon read expenses" ON expenses FOR SELECT USING (true);
CREATE POLICY "Allow anon read budgets" ON budgets FOR SELECT USING (true);
CREATE POLICY "Allow anon read receipts" ON receipts FOR SELECT USING (true);
CREATE POLICY "Allow anon read reminders" ON reminders FOR SELECT USING (true);
CREATE POLICY "Allow anon read pet_access" ON pet_access FOR SELECT USING (true);

-- Allow anon to insert expenses
CREATE POLICY "Allow anon insert expenses" ON expenses FOR INSERT WITH CHECK (true);
