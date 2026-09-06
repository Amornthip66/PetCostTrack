/**
 * ExpenseAllocation — คำนวณ/ตรวจสอบส่วนแบ่งค่าใช้จ่ายระหว่างสัตว์เลี้ยงหลายตัว
 *
 * เป็น "แหล่งความจริงเดียว" (single source of truth) สำหรับกฎการจัดสรร:
 *   Total Net Amount = Primary Pet Amount + Sum of All Shared Pet Amounts
 *
 * ใช้ร่วมกันโดย js/history.js (ฟอร์มเพิ่มรายจ่ายที่หน้าประวัติ) และ js/dashboard.js
 * (ฟอร์มเพิ่มรายจ่ายที่หน้าแดชบอร์ด) เพื่อไม่ให้กฎการตรวจสอบเพี้ยนไปคนละแบบระหว่าง
 * 2 หน้า — เป็น pure function ล้วนๆ ไม่แตะ DOM เลย ทั้งสองหน้าเรียกใช้ฟังก์ชันชุด
 * เดียวกันนี้แล้วนำผลไปแสดงผล/ผูกกับ element ของตัวเองต่อ
 */
var ExpenseAllocation = (function() {

    // เผื่อความคลาดเคลื่อนจาก floating point ที่ระดับทศนิยม 2 ตำแหน่ง (เช่น 0.1+0.2)
    var EPSILON = 0.005;

    // ปัดเศษเป็นทศนิยม 2 ตำแหน่งตามที่ระบบใช้อยู่แล้ว — ตรงกับคอลัมน์ expenses.amount
    // (DECIMAL(10,2)) และ expense_pet_shares.share_amount (NUMERIC(10,2)) ในฐานข้อมูล
    // ไม่ได้คิดค้นระบบปัดเศษ/สกุลเงินใหม่ ใช้รูปแบบเดียวกับที่ js/history.js เดิมใช้อยู่
    // (Math.round(x*100)/100) เพียงย้ายมารวมไว้ที่เดียวให้ทั้งสองหน้าเรียกใช้ร่วมกัน
    function round2(n) {
        var num = Number(n);
        return Math.round((isNaN(num) ? 0 : num) * 100) / 100;
    }

    // ตรวจสอบความถูกต้องของจำนวนเงินแต่ละช่อง (functional requirement ข้อ 5)
    // คืนค่า 'ok' | 'empty' | 'invalid' | 'negative' | 'precision'
    function validateAmount(value) {
        if (value === '' || value === null || value === undefined) return 'empty';
        var n = Number(value);
        if (isNaN(n)) return 'invalid';
        if (n < 0) return 'negative';
        // ทศนิยมเกิน 2 ตำแหน่ง (เช่น 10.005) ไม่ตรงกับความละเอียดของคอลัมน์ในฐานข้อมูล
        if (Math.abs(round2(n) - n) > 0.0001) return 'precision';
        return 'ok';
    }

    // คำนวณผลรวมการจัดสรรทั้งหมด เทียบกับยอดรวมทั้งหมด แล้วบอกสถานะ
    //   status: 'valid' (พอดี) | 'under' (ยังไม่ครบ) | 'over' (เกิน)
    // sharedAmounts: array ของตัวเลข/สตริง (ค่าที่ parse ไม่ได้ถือเป็น 0 ในผลรวม แต่ผู้เรียก
    // ควรเช็ค validateAmount() แยกต่างหากก่อน เพื่อแจ้ง error เฉพาะช่องที่กรอกผิดด้วย)
    function compute(totalAmount, primaryAmount, sharedAmounts) {
        var total = round2(totalAmount);
        var primary = round2(primaryAmount);
        var sumShared = round2((sharedAmounts || []).reduce(function(sum, x) {
            var n = Number(x);
            return sum + (isNaN(n) ? 0 : n);
        }, 0));
        var allocated = round2(primary + sumShared);
        var remaining = round2(total - allocated);

        var status = 'valid';
        if (remaining > EPSILON) status = 'under';
        else if (remaining < -EPSILON) status = 'over';

        return {
            total: total,
            primary: primary,
            sumShared: sumShared,
            allocated: allocated,
            remaining: remaining,
            status: status
        };
    }

    return {
        EPSILON: EPSILON,
        round2: round2,
        validateAmount: validateAmount,
        compute: compute
    };
})();
