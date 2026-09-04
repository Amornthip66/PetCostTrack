/**
 * Shared Components
 * Nav bar, page layout, common UI elements
 */
var UI = (function() {

    function renderNav(activePage) {
        var user = Auth.getUser();
        var session = Auth.getSession();
        var sessionEmail = (session && session.user && session.user.email) ? session.user.email : '';
        var meta = (session && session.user && (session.user.user_metadata || session.user.raw_user_meta_data)) || {};
        var userName = (user && user.name) ? user.name : (meta.name || (sessionEmail ? sessionEmail.split('@')[0] : 'ผู้ใช้งาน'));
        var userRole = (user && user.role) ? user.role : (meta.role || 'Owner');
        var avatarName = encodeURIComponent(userName);
        var pages = [
            { id: 'dashboard', label: 'แดชบอร์ด', icon: 'fa-chart-pie', href: 'index.html' },
            { id: 'pets', label: 'สัตว์เลี้ยงของฉัน', icon: 'fa-paw', href: 'pets.html' },
            { id: 'history', label: 'ประวัติรายจ่าย', icon: 'fa-clock-rotate-left', href: 'history.html' },
            { id: 'reminders', label: 'การแจ้งเตือน', icon: 'fa-bell', href: 'reminders.html' },
            { id: 'budgets', label: 'งบประมาณ', icon: 'fa-coins', href: 'budgets.html' },
            { id: 'profile', label: 'โปรไฟล์', icon: 'fa-user', href: 'profile.html' }
        ];

        // พื้นหลังแถบเมนูเป็นสีเข้ม เลยต้องใช้สีขาว/ม่วงอ่อนสำหรับตัวอักษรและไอคอนทั้งหมด
        // แทนสีเทาเข้มเดิมที่ใช้ตอนพื้นหลังยังเป็นสีขาว (ไม่งั้นจะมองไม่เห็น/contrast ไม่พอ)
        var navLinks = pages.map(function(p) {
            var cls = p.id === activePage
                ? 'border-white text-white inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium'
                : 'border-transparent text-purple-200 hover:border-purple-300 hover:text-white inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium transition';
            return '<a href="' + p.href + '" class="' + cls + '">' + p.label + '</a>';
        }).join('');

        // เมนูแบบเต็มความกว้างสำหรับแผงเมนูมือถือ (มีไอคอน + พื้นที่กดง่ายกว่าเดิม)
        var mobileNavLinks = pages.map(function(p) {
            var cls = p.id === activePage
                ? 'flex items-center gap-3 px-3 py-2.5 rounded-lg bg-white/10 text-white text-sm font-medium'
                : 'flex items-center gap-3 px-3 py-2.5 rounded-lg text-purple-200 hover:bg-white/10 hover:text-white text-sm font-medium transition';
            return '<a href="' + p.href + '" class="' + cls + '"><i class="fa-solid ' + p.icon + ' w-5 text-center"></i>' + p.label + '</a>';
        }).join('');

        // Header สีเข้ม (ไม่ใช่ม่วงสด #663399 ตรงๆ) ให้ดูเป็นแดชบอร์ดยุคใหม่ + เส้นขอบล่าง
        // สีม่วงแบรนด์บางๆ คั่นไว้ให้พอมีสีแบรนด์เชื่อมกับ nav link/ปุ่มที่ยังเป็น #663399
        return '<nav class="bg-[#1e1030] border-b border-pet/40 shadow-lg sticky top-0 z-40">'
            + '<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">'
            + '<div class="flex justify-between h-16">'
            + '<div class="flex items-center">'
            + '<div class="flex-shrink-0 flex items-center text-white">'
            + '<i class="fa-solid fa-paw text-2xl mr-2"></i>'
            + '<span class="font-bold text-xl tracking-wide">PetCostTrack</span>'
            + '</div>'
            + '<div class="hidden sm:ml-8 sm:flex sm:space-x-6">' + navLinks + '</div>'
            + '</div>'
            + '<div class="hidden sm:ml-6 sm:flex sm:items-center gap-3">'
            + '<a href="profile.html" class="flex items-center rounded-lg px-2 py-1 -mx-2 hover:bg-white/10 transition" title="ไปที่โปรไฟล์ของฉัน">'
            + '<div class="text-right mr-2">'
            + '<div class="text-sm font-medium text-white">' + userName + '</div>'
            + '<div class="text-xs text-purple-200">' + userRole + '</div>'
            + '</div>'
            + '<img class="h-10 w-10 rounded-full object-cover" src="https://ui-avatars.com/api/?name=' + avatarName + '&background=ffffff&color=663399" alt="Avatar">'
            + '</a>'
            + '<button onclick="Auth.logout().then(function(){window.location.href=\'login.html\'})" class="ml-2 btn btn-nav btn-sm" title="ออกจากระบบ"><i class="fa-solid fa-right-from-bracket"></i></button>'
            + '</div>'
            + '<div class="flex items-center gap-1 sm:hidden">'
            + '<a href="profile.html" title="ไปที่โปรไฟล์ของฉัน"><img class="h-8 w-8 rounded-full object-cover" src="https://ui-avatars.com/api/?name=' + avatarName + '&background=ffffff&color=663399" alt="Avatar"></a>'
            + '<button onclick="Auth.logout().then(function(){window.location.href=\'login.html\'})" class="p-2 text-purple-200 hover:text-white"><i class="fa-solid fa-right-from-bracket"></i></button>'
            + '</div>'
            + '</div></nav>';
    }

    function toggleMobileNav() {
        var panel = document.getElementById('mobileNavPanel');
        var btn = document.getElementById('mobileNavToggle');
        if (!panel) return;
        var willOpen = panel.classList.contains('hidden');
        panel.classList.toggle('hidden');
        if (btn) {
            btn.innerHTML = willOpen ? '<i class="fa-solid fa-xmark text-lg"></i>' : '<i class="fa-solid fa-bars text-lg"></i>';
            btn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
        }
    }

    function fmt(n) { return new Intl.NumberFormat('th-TH').format(n); }

    var THAI_MONTHS = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
    function formatDate(s) {
        var d = new Date(s);
        return d.getDate() + ' ' + THAI_MONTHS[d.getMonth()] + ' ' + (d.getFullYear() + 543);
    }

    function formatDateTime(s) {
        var d = new Date(s);
        return formatDate(s) + ' ' + String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
    }

    function getIcon(c) {
        if (!c) return {i:'fa-receipt',bg:'bg-gray-100',cl:'text-gray-500'};
        var n = c.toLowerCase();
        if (n.indexOf('อาหาร')>=0) return {i:'fa-bowl-food',bg:'bg-blue-100',cl:'text-blue-500'};
        if (n.indexOf('วัคซีน')>=0||n.indexOf('ตรวจ')>=0) return {i:'fa-syringe',bg:'bg-green-100',cl:'text-green-500'};
        if (n.indexOf('รักษา')>=0||n.indexOf('ฉุกเฉิน')>=0) return {i:'fa-stethoscope',bg:'bg-red-100',cl:'text-pet-hidden'};
        if (n.indexOf('เสียหาย')>=0||n.indexOf('พัง')>=0) return {i:'fa-couch',bg:'bg-orange-100',cl:'text-orange-500'};
        if (n.indexOf('ฝากเลี้ยง')>=0) return {i:'fa-house-user',bg:'bg-purple-100',cl:'text-purple-500'};
        if (n.indexOf('ถ่ายพยาธิ')>=0) return {i:'fa-pills',bg:'bg-teal-100',cl:'text-teal-500'};
        return {i:'fa-receipt',bg:'bg-gray-100',cl:'text-gray-500'};
    }

    function initPage(activePage) {
        if (!Auth.requireAuth()) return false;
        var nav = document.getElementById('mainNav');
        if (nav) nav.innerHTML = renderNav(activePage);
        return true;
    }

    return { renderNav: renderNav, toggleMobileNav: toggleMobileNav, initPage: initPage, fmt: fmt, formatDate: formatDate, formatDateTime: formatDateTime, getIcon: getIcon };
})();
