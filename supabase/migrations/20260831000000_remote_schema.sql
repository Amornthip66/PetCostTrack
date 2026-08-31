-- ----------------------------------------------------------------------------
-- ตาราง 1: users   (Entity: USER)
-- ----------------------------------------------------------------------------
CREATE TABLE users (
    user_id     INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name        VARCHAR(100)  NOT NULL,
    email       VARCHAR(150)  NOT NULL,
    -- เก็บค่า hash ของรหัสผ่าน (bcrypt/argon2) ห้ามเก็บ plain text
    -- เงื่อนไข "ยาวไม่น้อยกว่า 8 ตัวอักษร" (Backlog #1) ตรวจที่ Application ก่อน hash
    password    VARCHAR(255)  NOT NULL,
    -- role ระดับผู้ใช้ทั่วไป ตาม Data Requirements ("User Data: ...Role")
    role        VARCHAR(20)   NOT NULL DEFAULT 'Owner',

    CONSTRAINT uq_users_email      UNIQUE (email),
    CONSTRAINT chk_users_email_fmt CHECK (email LIKE '%_@__%.__%'),
    CONSTRAINT chk_users_role      CHECK (role IN ('Owner', 'Co-caretaker'))
);

-- ----------------------------------------------------------------------------
-- ตาราง 2: pets   (Entity: PET)
-- ไม่มีคอลัมน์ owner_id ตรง ๆ ความเป็นเจ้าของ/ผู้ร่วมดูแลอยู่ในตาราง pet_access
-- ----------------------------------------------------------------------------
CREATE TABLE pets (
    pet_id      INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    type_breed  VARCHAR(100),
    age         SMALLINT,

    CONSTRAINT chk_pets_age CHECK (age IS NULL OR age >= 0)
);

-- ----------------------------------------------------------------------------
-- ตาราง 3: categories   (Entity: CATEGORY)
-- ----------------------------------------------------------------------------
CREATE TABLE categories (
    category_id    INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    category_name  VARCHAR(100) NOT NULL,

    CONSTRAINT uq_categories_name UNIQUE (category_name)
);

-- ----------------------------------------------------------------------------
-- ตาราง 4: pet_access   (ความสัมพันธ์ M:N PET_ACCESS ระหว่าง PET และ USER)
-- ----------------------------------------------------------------------------
CREATE TABLE pet_access (
    pet_id       INT NOT NULL REFERENCES pets(pet_id)   ON DELETE CASCADE ON UPDATE CASCADE,
    user_id      INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE ON UPDATE CASCADE,
    access_role  VARCHAR(20) NOT NULL,

    PRIMARY KEY (pet_id, user_id),
    CONSTRAINT chk_pet_access_role CHECK (access_role IN ('Owner', 'Co-caretaker'))
);

-- ----------------------------------------------------------------------------
-- ตาราง 5: budgets   (Entity: BUDGET + ความสัมพันธ์ SET_FOR)
-- budget_summary (derived attribute ในผัง) ไม่เก็บเป็นคอลัมน์ -> ดู VIEW ท้ายไฟล์
-- ----------------------------------------------------------------------------
CREATE TABLE budgets (
    budget_id     INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    budget_limit  DECIMAL(10, 2) NOT NULL,
    budget_month  SMALLINT NOT NULL,
    budget_year   SMALLINT NOT NULL,
    pet_id        INT NOT NULL REFERENCES pets(pet_id) ON DELETE CASCADE ON UPDATE CASCADE,

    CONSTRAINT chk_budgets_limit  CHECK (budget_limit > 0),
    CONSTRAINT chk_budgets_month  CHECK (budget_month BETWEEN 1 AND 12),
    CONSTRAINT chk_budgets_year   CHECK (budget_year BETWEEN 2000 AND 2100),
    CONSTRAINT uq_budgets_period  UNIQUE (pet_id, budget_month, budget_year)
);

-- ----------------------------------------------------------------------------
-- ตาราง 6: expenses   (Entity: EXPENSE + INCURS, RECORDS, CLASSIFIED_AS)
-- ----------------------------------------------------------------------------
CREATE TABLE expenses (
    transaction_id  INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    amount          DECIMAL(10, 2) NOT NULL,
    expense_date    DATE NOT NULL,
    expense_type    VARCHAR(10) NOT NULL,
    pet_id          INT NOT NULL REFERENCES pets(pet_id)             ON DELETE CASCADE  ON UPDATE CASCADE,
    user_id         INT NOT NULL REFERENCES users(user_id)           ON DELETE RESTRICT ON UPDATE CASCADE,
    category_id     INT NOT NULL REFERENCES categories(category_id) ON DELETE RESTRICT ON UPDATE CASCADE,

    CONSTRAINT chk_expenses_amount CHECK (amount >= 0),
    CONSTRAINT chk_expenses_type   CHECK (expense_type IN ('หลัก', 'แฝง'))
);

-- ----------------------------------------------------------------------------
-- ตาราง 7: receipts   (Entity: RECEIPT + HAS_RECEIPT)
-- ----------------------------------------------------------------------------
CREATE TABLE receipts (
    receipt_id      INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    receipt_date    DATE NOT NULL,
    image_path      VARCHAR(255) NOT NULL,
    transaction_id  INT NOT NULL REFERENCES expenses(transaction_id) ON DELETE CASCADE ON UPDATE CASCADE,

    -- BR-04: ไฟล์ใบเสร็จต้องเป็นนามสกุลรูปภาพ (jpg, png) เท่านั้น
    CONSTRAINT chk_receipts_filetype CHECK (
        image_path LIKE '%.jpg' OR image_path LIKE '%.jpeg' OR image_path LIKE '%.png'
    )
);

-- ----------------------------------------------------------------------------
-- ตาราง 8: reminders   (Entity: REMINDER + SCHEDULES, CATEGORIZED_AS)
-- ----------------------------------------------------------------------------
CREATE TABLE reminders (
    task_id        INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    frequency      VARCHAR(10) NOT NULL,
    next_due_date  DATE NOT NULL,
    pet_id         INT NOT NULL REFERENCES pets(pet_id)             ON DELETE CASCADE  ON UPDATE CASCADE,
    category_id    INT NOT NULL REFERENCES categories(category_id) ON DELETE RESTRICT ON UPDATE CASCADE,

    CONSTRAINT chk_reminders_frequency CHECK (frequency IN ('รายเดือน', 'รายปี'))
);

-- ============================================================================
-- VIEW: budget_summary_view  (สาธิต derived attribute "budget_summary" ใน ER)
-- ============================================================================
CREATE OR REPLACE VIEW budget_summary_view AS
SELECT
    b.budget_id,
    b.pet_id,
    b.budget_month,
    b.budget_year,
    b.budget_limit,
    COALESCE(SUM(e.amount), 0)                   AS total_spent,
    b.budget_limit - COALESCE(SUM(e.amount), 0)   AS remaining_budget
FROM budgets b
LEFT JOIN expenses e
       ON e.pet_id = b.pet_id
      AND EXTRACT(MONTH FROM e.expense_date) = b.budget_month
      AND EXTRACT(YEAR  FROM e.expense_date) = b.budget_year
GROUP BY b.budget_id, b.pet_id, b.budget_month, b.budget_year, b.budget_limit;


-- ============================================================================
-- ส่วนที่ 2: INSERT ข้อมูลตัวอย่าง (Seed Data)
-- ข้อมูลอ้างอิงจาก User Scenario ในเอกสาร Project Proposal (ข้อ 6 และ ข้อ 15
-- Example End-to-End Scenario) และรายชื่อสมาชิกกลุ่มบนหน้าปก ส่วนชื่อสัตว์เลี้ยง/
-- อีเมล/จำนวนเงินที่ไม่ได้ระบุตัวเลขชัดเจนในเอกสาร ใช้เป็นค่าตัวอย่างเพื่อสาธิตการ
-- ทำงานของฐานข้อมูลเท่านั้น (ปรับแก้ได้ตามต้องการ)
-- ============================================================================

-- 2.1 ผู้ใช้งาน (จากหน้าปกโครงงาน: Product Owner / Scrum Master ของกลุ่ม 39)
INSERT INTO users (name, email, password, role) VALUES
    ('ปานชนก พรหมศรีสวัสดิ์', 'panchanok@example.com', '$2y$10$demoHashPlaceholder0000000000000000000001', 'Owner'),
    ('อมรทิพย์ เรืองคำ',       'amonthip@example.com',  '$2y$10$demoHashPlaceholder0000000000000000000002', 'Co-caretaker');

-- 2.2 หมวดหมู่ค่าใช้จ่าย (ชื่อหมวดหมู่อ้างอิงจากตัวอย่างในเอกสาร เช่น Scenario 1,
-- Scenario 3 และ Project Background ข้อ 1.1)
INSERT INTO categories (category_name) VALUES
    ('อาหาร'),
    ('วัคซีนประจำปี'),
    ('ถ่ายพยาธิ'),
    ('ค่าใช้จ่ายแฝง - ค่ารักษาพยาบาลฉุกเฉิน'),
    ('ค่าใช้จ่ายแฝง - สิ่งของเสียหาย'),
    ('ค่าฝากเลี้ยง');

-- 2.3 สัตว์เลี้ยง (Scenario 15 กล่าวถึงสุนัข, Problem 2.1 ข้อ 3 กล่าวถึงแมว)
INSERT INTO pets (name, type_breed, age) VALUES
    ('น้องโบโบ้',  'สุนัข พันธุ์ผสม', 3),
    ('น้องเหมียว', 'แมว พันธุ์ไทย',   2);

-- 2.4 สิทธิ์การเข้าถึงสัตว์เลี้ยง (PET_ACCESS: ปานชนกเป็น Owner ทั้งสองตัว,
-- อมรทิพย์เป็น Co-caretaker ร่วมดูแลทั้งสองตัว ตามบริบทครอบครัวในเอกสาร)
INSERT INTO pet_access (pet_id, user_id, access_role)
SELECT p.pet_id, u.user_id, 'Owner'
FROM pets p, users u
WHERE u.email = 'panchanok@example.com';

INSERT INTO pet_access (pet_id, user_id, access_role)
SELECT p.pet_id, u.user_id, 'Co-caretaker'
FROM pets p, users u
WHERE u.email = 'amonthip@example.com';

-- 2.5 งบประมาณรายเดือนของแต่ละสัตว์เลี้ยง (BR-03: ตั้งเป็นรายเดือน)
INSERT INTO budgets (budget_limit, budget_month, budget_year, pet_id)
SELECT 3000.00, EXTRACT(MONTH FROM CURRENT_DATE), EXTRACT(YEAR FROM CURRENT_DATE), pet_id
FROM pets WHERE name = 'น้องโบโบ้';

INSERT INTO budgets (budget_limit, budget_month, budget_year, pet_id)
SELECT 1500.00, EXTRACT(MONTH FROM CURRENT_DATE), EXTRACT(YEAR FROM CURRENT_DATE), pet_id
FROM pets WHERE name = 'น้องเหมียว';

-- 2.6 รายการค่าใช้จ่าย
-- (a) Scenario 15: น้องโบโบ้กินของเล่น ต้องพาไปหาหมอฉุกเฉิน (ค่าใช้จ่ายแฝง)
--     บันทึกโดยปานชนก (Owner)
INSERT INTO expenses (amount, expense_date, expense_type, pet_id, user_id, category_id)
SELECT 2500.00, CURRENT_DATE - INTERVAL '3 days', 'แฝง',
       p.pet_id, u.user_id, c.category_id
FROM pets p, users u, categories c
WHERE p.name = 'น้องโบโบ้'
  AND u.email = 'panchanok@example.com'
  AND c.category_name = 'ค่าใช้จ่ายแฝง - ค่ารักษาพยาบาลฉุกเฉิน';

-- (b) Scenario 1: สัตว์เลี้ยงทำของในบ้านพัง ต้องซื้อของใหม่ทดแทน (ค่าใช้จ่ายแฝง)
--     บันทึกโดยปานชนก (Owner)
INSERT INTO expenses (amount, expense_date, expense_type, pet_id, user_id, category_id)
SELECT 450.00, CURRENT_DATE - INTERVAL '10 days', 'แฝง',
       p.pet_id, u.user_id, c.category_id
FROM pets p, users u, categories c
WHERE p.name = 'น้องโบโบ้'
  AND u.email = 'panchanok@example.com'
  AND c.category_name = 'ค่าใช้จ่ายแฝง - สิ่งของเสียหาย';

-- (c) ค่าอาหารประจำเดือนของน้องเหมียว (ค่าใช้จ่ายหลัก) บันทึกโดยอมรทิพย์
--     (Co-caretaker บันทึกรายจ่ายของตนเองได้ ตาม Backlog #9 / BR-01)
INSERT INTO expenses (amount, expense_date, expense_type, pet_id, user_id, category_id)
SELECT 690.00, CURRENT_DATE - INTERVAL '1 days', 'หลัก',
       p.pet_id, u.user_id, c.category_id
FROM pets p, users u, categories c
WHERE p.name = 'น้องเหมียว'
  AND u.email = 'amonthip@example.com'
  AND c.category_name = 'อาหาร';

-- 2.7 ใบเสร็จแนบกับรายการ (a) ตาม Scenario 15 "ถ่ายรูปใบเสร็จเพื่อแนบเข้าระบบ"
INSERT INTO receipts (receipt_date, image_path, transaction_id)
SELECT CURRENT_DATE - INTERVAL '3 days',
       'receipts/bobo_emergency_vet_2500.jpg',
       e.transaction_id
FROM expenses e
JOIN categories c ON c.category_id = e.category_id
WHERE c.category_name = 'ค่าใช้จ่ายแฝง - ค่ารักษาพยาบาลฉุกเฉิน';

-- 2.8 รายการแจ้งเตือน (Scenario 3: ตั้งแจ้งเตือนวัคซีนประจำปีล่วงหน้า)
INSERT INTO reminders (frequency, next_due_date, pet_id, category_id)
SELECT 'รายปี', CURRENT_DATE + INTERVAL '1 year',
       p.pet_id, c.category_id
FROM pets p, categories c
WHERE p.name = 'น้องโบโบ้'
  AND c.category_name = 'วัคซีนประจำปี';

-- แจ้งเตือนถ่ายพยาธิของน้องเหมียว (Problem 2.1 ข้อ 3 กล่าวถึงการถ่ายพยาธิ)
INSERT INTO reminders (frequency, next_due_date, pet_id, category_id)
SELECT 'รายเดือน', CURRENT_DATE + INTERVAL '30 days',
       p.pet_id, c.category_id
FROM pets p, categories c
WHERE p.name = 'น้องเหมียว'
  AND c.category_name = 'ถ่ายพยาธิ';

-- ============================================================================
-- ตรวจสอบผลลัพธ์อย่างรวดเร็ว (เรียกใช้แยกได้ตามต้องการ ไม่จำเป็นต้องรันตอน setup)
-- SELECT * FROM budget_summary_view;
-- SELECT e.transaction_id, p.name AS pet_name, u.name AS spender, c.category_name,
--        e.amount, e.expense_type, e.expense_date
-- FROM expenses e
-- JOIN pets p ON p.pet_id = e.pet_id
-- JOIN users u ON u.user_id = e.user_id
-- JOIN categories c ON c.category_id = e.category_id
-- ORDER BY e.expense_date DESC;
-- ============================================================================
-- ============================================================================
-- ส่วนที่ 3: คำสั่งปรับปรุงโครงสร้างเพิ่มเติม (Database Enhancements)
-- ============================================================================

-- 1. เพิ่มคอลัมน์คำอธิบาย (Note) ในตาราง expenses เพื่อให้ระบุรายละเอียดเพิ่มเติมได้
ALTER TABLE expenses 
ADD COLUMN expense_note VARCHAR(255);

-- 2. เพิ่มคอลัมน์สถานะการจัดการในตาราง reminders (เพื่อเช็คว่าดำเนินการหรือยัง)
ALTER TABLE reminders 
ADD COLUMN is_completed BOOLEAN DEFAULT FALSE;

-- 3. เพิ่มคอลัมน์ created_at สำหรับเก็บเวลาที่บันทึกข้อมูล (ช่วยในการจัดเรียงและ Audit)
ALTER TABLE users ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE pets ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE expenses ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE reminders ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- 4. ปรับแก้ Foreign Key ของ user_id ในตาราง expenses 
-- เพื่อให้เวลาระบบลบบัญชีผู้ร่วมดูแล (Co-caretaker) ยอดค่าใช้จ่ายของสัตว์เลี้ยงจะไม่ถูกลบหายไป
-- ขั้นแรก: อนุญาตให้ user_id มีค่าว่าง (NULL) ได้
ALTER TABLE expenses ALTER COLUMN user_id DROP NOT NULL;

-- ขั้นที่สอง: ลบข้อจำกัด (Constraint) เดิม (PostgreSQL ตั้งชื่ออัตโนมัติว่า expenses_user_id_fkey)
ALTER TABLE expenses DROP CONSTRAINT expenses_user_id_fkey;

-- ขั้นที่สาม: สร้างข้อจำกัดใหม่เป็น ON DELETE SET NULL
ALTER TABLE expenses ADD CONSTRAINT expenses_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(user_id)
    ON DELETE SET NULL ON UPDATE CASCADE;