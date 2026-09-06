/**
 * In-app Reminder Notifications (ข้อ 3.4 — เด้งแจ้งเตือนภายในแอป)
 *
 * โมดูลนี้เป็นอิสระจาก Dashboard/History/Reminders ทุกโมดูลโดยตั้งใจ: ไม่แก้ไข
 * หรือเรียกใช้ตัวแปร/ฟังก์ชันภายในของโมดูลอื่นเลย ใช้แค่ Api/Auth/UI ที่มีอยู่แล้ว
 * ทุกหน้า เพื่อลดความเสี่ยงที่จะไปกระทบฟีเจอร์อื่นที่ไม่เกี่ยวข้อง
 *
 * แสดง toast แจ้งเตือนบนแดชบอร์ดเมื่อมีรายการแจ้งเตือน (reminders) ที่ใกล้ถึงกำหนด
 * (ภายใน 7 วัน ตรงกับตัวอย่างใน User Scenario 3 ของเอกสาร proposal) หรือเลยกำหนดไปแล้ว
 *
 * หมายเหตุ: proposal เดิมแนะนำให้แจ้งเตือนผ่าน LINE Notify ควบคู่กับ toast ในแอป แต่
 * LINE Notify ถูกปิดให้บริการถาวรตั้งแต่ 31 มี.ค. 2025 (ประกาศทางการของ LINE Developers)
 * ช่องทางแจ้งเตือนภายนอกที่ทำต่อในเวอร์ชันนี้จึงเป็นอีเมลแทน (ดู
 * supabase/functions/send-reminder-emails/) ส่วน toast นี้คือช่องทาง "ภายในแอป"
 */
var Notifications = (function() {

    var DUE_SOON_DAYS = 7;
    var DISMISS_KEY = 'reminderToastDismissed';

    function ensureContainer() {
        var el = document.getElementById('reminderToastContainer');
        if (el) return el;
        el = document.createElement('div');
        el.id = 'reminderToastContainer';
        el.className = 'fixed top-4 right-4 z-[9999] flex flex-col gap-3 w-full max-w-sm px-4 sm:px-0';
        document.body.appendChild(el);
        return el;
    }

    // ปิด toast — persist:true คือผู้ใช้กดปิดเอง (จำไว้ทั้ง session ไม่ต้องผุดซ้ำ),
    // persist:false คือปิดอัตโนมัติหลังผ่านไปสักพัก (ยังผุดใหม่ได้ถ้าเข้าหน้าใหม่)
    function dismiss(toastId, persist) {
        var card = document.getElementById(toastId);
        if (card) {
            card.style.opacity = '0';
            card.style.transform = 'translateX(1rem)';
            setTimeout(function() {
                if (card && card.parentNode) card.parentNode.removeChild(card);
            }, 250);
        }
        if (persist) {
            try { sessionStorage.setItem(DISMISS_KEY, '1'); } catch (e) { /* private mode ฯลฯ - ไม่ critical */ }
        }
    }

    function itemLine(r) {
        var petName = r.pets ? r.pets.name : '';
        var catName = r.categories ? r.categories.category_name : 'รายการ';
        var dateLabel = (UI && UI.formatDate) ? UI.formatDate(r.next_due_date) : r.next_due_date;
        return '<li class="flex items-center gap-2 text-xs text-gray-600">'
            + '<i class="fa-solid fa-circle text-[6px] flex-shrink-0 ' + (r._overdue ? 'text-red-500' : 'text-amber-500') + '"></i>'
            + '<span class="truncate">' + catName + (petName ? ' • ' + petName : '') + ' — ' + dateLabel + '</span>'
            + '</li>';
    }

    function renderToast(overdue, dueSoon) {
        var wrap = ensureContainer();
        var toastId = 'reminderToast_' + Date.now();
        var overdueCount = overdue.length;
        var dueCount = dueSoon.length;
        var itemsHtml = overdue.concat(dueSoon).slice(0, 4).map(itemLine).join('');
        var moreCount = (overdueCount + dueCount) - Math.min(overdueCount + dueCount, 4);

        var card = document.createElement('div');
        card.id = toastId;
        card.className = 'bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden transition-all duration-300 ease-out';
        card.style.opacity = '0';
        card.style.transform = 'translateX(1rem)';
        card.innerHTML =
            '<div class="flex items-start gap-3 p-4">'
                + '<div class="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ' + (overdueCount ? 'bg-red-100 text-red-500' : 'bg-amber-100 text-amber-500') + '">'
                    + '<i class="fa-solid fa-bell"></i>'
                + '</div>'
                + '<div class="flex-1 min-w-0">'
                    + '<p class="text-sm font-semibold text-gray-900">'
                        + (overdueCount
                            ? overdueCount + ' รายการเลยกำหนดแล้ว' + (dueCount ? ' และอีก ' + dueCount + ' รายการใกล้ถึงกำหนด' : '')
                            : dueCount + ' รายการใกล้ถึงกำหนดภายใน ' + DUE_SOON_DAYS + ' วัน')
                    + '</p>'
                    + '<ul class="mt-1.5 space-y-1">' + itemsHtml + '</ul>'
                    + (moreCount > 0 ? '<p class="text-xs text-gray-400 mt-1">และอีก ' + moreCount + ' รายการ</p>' : '')
                    + '<a href="reminders.html" class="inline-block mt-2 text-xs font-medium text-pet hover:underline">ดูรายการแจ้งเตือนทั้งหมด →</a>'
                + '</div>'
                + '<button type="button" onclick="Notifications.dismiss(\'' + toastId + '\', true)" class="flex-shrink-0 text-gray-300 hover:text-gray-500" title="ปิด"><i class="fa-solid fa-xmark"></i></button>'
            + '</div>';
        wrap.appendChild(card);

        // เล่น transition slide-in (ต้องรอ 1 frame ให้ browser apply style เริ่มต้นก่อน)
        requestAnimationFrame(function() {
            card.style.opacity = '1';
            card.style.transform = 'translateX(0)';
        });

        // ปิดอัตโนมัติหลัง 12 วิ (ไม่ persist กันไม่ให้ผุดซ้ำถ้าผู้ใช้แค่รอเฉยๆ ยังไม่ได้อ่าน)
        setTimeout(function() { dismiss(toastId, false); }, 12000);
    }

    // เรียกครั้งเดียวตอนโหลดหน้าแดชบอร์ด — ถ้า query ล้มเหลวด้วยเหตุผลใดก็ตาม (migration
    // ยังไม่ได้รัน, network error ฯลฯ) จะแค่ไม่แสดง toast ไม่ throw error รบกวนหน้าอื่น
    function checkReminders() {
        try {
            if (sessionStorage.getItem(DISMISS_KEY) === '1') return;
        } catch (e) { /* ignore */ }

        if (!Auth || !Auth.isLoggedIn || !Auth.isLoggedIn()) return;

        Api.query('reminders', 'select=task_id,next_due_date,is_completed,pets(name),categories(category_name)&is_completed=eq.false&order=next_due_date.asc&limit=50')
        .then(function(rows) {
            rows = rows || [];
            var today = new Date();
            today.setHours(0, 0, 0, 0);
            var soonCutoff = new Date(today.getTime() + DUE_SOON_DAYS * 86400000);

            var overdue = [], dueSoon = [];
            rows.forEach(function(r) {
                var d = new Date(r.next_due_date);
                if (isNaN(d.getTime())) return;
                if (d < today) { r._overdue = true; overdue.push(r); }
                else if (d <= soonCutoff) { dueSoon.push(r); }
            });

            if (overdue.length || dueSoon.length) renderToast(overdue, dueSoon);
        })
        .catch(function(err) {
            console.warn('Notifications.checkReminders failed (non-critical):', err);
        });
    }

    return { checkReminders: checkReminders, dismiss: dismiss };
})();
