-- =====================================================================
-- Migration: Trigger ป้องกันการแก้สิทธิ์และการเก็บเข้าคลังโดยผู้ที่ไม่ใช่ Owner
--
-- ไฟล์นี้สร้างคืนจากสถานะฐานข้อมูลจริง (Supabase) ณ 13 ต.ค. 2569 เพราะตอนรัน
-- migration นี้ครั้งแรก ประวัติไม่ได้บันทึกคำสั่งไว้ (supabase_migrations มีแค่เลขเวอร์ชัน)
--
-- - prevent_non_owner_archive: Co-caretaker แก้โปรไฟล์ได้ (pets_update) แต่ห้ามเปลี่ยน
--   is_archived เพราะการเก็บเข้าคลัง/กู้คืนเป็นสิทธิ์ของ Owner (BR-02)
-- - guard_pet_access_update: แก้แถว pet_access ได้เฉพาะบทบาท ห้ามย้ายผู้ใช้/สัตว์เลี้ยง
--   และสัตว์เลี้ยงต้องเหลือ Owner อย่างน้อย 1 คน
-- รันซ้ำได้ (idempotent)
-- =====================================================================

CREATE OR REPLACE FUNCTION public.prevent_non_owner_archive()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    IF (to_jsonb(NEW) ? 'is_archived')
       AND (to_jsonb(NEW)->>'is_archived') IS DISTINCT FROM (to_jsonb(OLD)->>'is_archived')
       AND NOT user_is_pet_owner(OLD.pet_id) THEN
        RAISE EXCEPTION 'เฉพาะเจ้าของสัตว์เลี้ยง (Owner) เท่านั้นที่เก็บเข้าคลัง/กู้คืนสัตว์เลี้ยงได้';
    END IF;
    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_prevent_non_owner_archive ON public.pets;
CREATE TRIGGER trg_prevent_non_owner_archive
    BEFORE UPDATE ON public.pets
    FOR EACH ROW EXECUTE FUNCTION public.prevent_non_owner_archive();

CREATE OR REPLACE FUNCTION public.guard_pet_access_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN NEW;
    END IF;
    IF NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.pet_id IS DISTINCT FROM OLD.pet_id THEN
        RAISE EXCEPTION 'แก้ได้เฉพาะบทบาท (access_role) — การเพิ่มผู้ร่วมดูแลต้องทำผ่านระบบคำเชิญ';
    END IF;
    IF OLD.access_role = 'Owner' AND NEW.access_role <> 'Owner'
       AND NOT EXISTS (SELECT 1 FROM public.pet_access
                       WHERE pet_id = OLD.pet_id AND access_role = 'Owner' AND user_id <> OLD.user_id) THEN
        RAISE EXCEPTION 'สัตว์เลี้ยงต้องมีเจ้าของ (Owner) อย่างน้อย 1 คน';
    END IF;
    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_pet_access_update ON public.pet_access;
CREATE TRIGGER trg_guard_pet_access_update
    BEFORE UPDATE ON public.pet_access
    FOR EACH ROW EXECUTE FUNCTION public.guard_pet_access_update();

-- ---------------------------------------------------------------- budget_summary_view
-- security_invoker = true: view ตรวจ RLS ด้วยสิทธิ์ของผู้เรียก (ไม่ใช่เจ้าของ view)
-- จึงเห็นเฉพาะงบของสัตว์เลี้ยงที่ตนมีสิทธิ์ ยอดใช้จ่าย = รายจ่ายที่สัตว์ตัวนี้เป็นตัวหลัก
-- (หักส่วนที่แบ่งให้ตัวอื่น) + ส่วนแบ่งที่ได้รับจากรายจ่ายของตัวอื่น
CREATE OR REPLACE VIEW public.budget_summary_view WITH (security_invoker = true) AS
 SELECT b.budget_id,
    b.pet_id,
    b.budget_month,
    b.budget_year,
    b.budget_limit,
    (COALESCE(pri.net, (0)::numeric) + COALESCE(shr.amount, (0)::numeric)) AS total_spent,
    (b.budget_limit - (COALESCE(pri.net, (0)::numeric) + COALESCE(shr.amount, (0)::numeric))) AS remaining_budget
   FROM ((budgets b
     LEFT JOIN LATERAL ( SELECT sum((e.amount - COALESCE(( SELECT sum(x.share_amount) AS sum
                   FROM expense_pet_shares x
                  WHERE (x.transaction_id = e.transaction_id)), (0)::numeric))) AS net
           FROM expenses e
          WHERE ((e.pet_id = b.pet_id) AND (e.expense_date >= make_date((b.budget_year)::integer, (b.budget_month)::integer, 1)) AND (e.expense_date < (make_date((b.budget_year)::integer, (b.budget_month)::integer, 1) + '1 mon'::interval)))) pri ON (true))
     LEFT JOIN LATERAL ( SELECT sum(x.share_amount) AS amount
           FROM (expense_pet_shares x
             JOIN expenses e ON ((e.transaction_id = x.transaction_id)))
          WHERE ((x.pet_id = b.pet_id) AND (e.expense_date >= make_date((b.budget_year)::integer, (b.budget_month)::integer, 1)) AND (e.expense_date < (make_date((b.budget_year)::integer, (b.budget_month)::integer, 1) + '1 mon'::interval)))) shr ON (true));

REVOKE ALL ON public.budget_summary_view FROM anon;
