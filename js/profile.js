/**
 * Profile Module
 */
var Profile = (function() {

    function init() {
        var user = Auth.getUser();
        if (!user) {
            var familyList = document.getElementById('familyList');
            if (familyList) familyList.innerHTML = '<p class="text-red-400">โหลดโปรไฟล์ไม่สำเร็จ กรุณารีเฟรชหน้าใหม่</p>';
            return;
        }

        document.getElementById('profileName').textContent = user.name;
        document.getElementById('profileRole').textContent = user.role;
        document.getElementById('profileAvatar').src = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(user.name) + '&background=663399&color=fff&size=160';
        document.getElementById('editName').value = user.name;
        document.getElementById('editEmail').value = user.email;
        document.getElementById('editRole').value = user.role;

        loadFamily();
        loadPetCount();
    }

    function loadFamily() {
        var user = Auth.getUser();
        var familyList = document.getElementById('familyList');

        // หา pet_id ทั้งหมดที่ตัวเองมีสิทธิ์ก่อน แล้วค่อยหาว่าใครมีสิทธิ์ร่วมกับสัตว์เลี้ยงตัวเดียวกันบ้าง
        // (เดิมพยายามยัด SQL subquery ตรงๆ ลงใน in.() ซึ่ง PostgREST ไม่รองรับ ทำให้ query
        // error เสมอ และเพราะไม่มี .catch() เลย ค้างที่ "กำลังโหลด..." ตลอดไปไม่ว่าจะมีสมาชิกจริงหรือไม่)
        Api.query('pet_access', 'select=pet_id&user_id=eq.' + user.user_id)
        .then(function(myAccess) {
            var petIds = (myAccess || []).map(function(a) { return a.pet_id; });
            if (!petIds.length) return [];
            return Api.query('pet_access', 'select=user_id&pet_id=in.(' + petIds.join(',') + ')');
        })
        .then(function(access) {
            var seen = {};
            var userIds = (access || []).map(function(a) { return a.user_id; }).filter(function(id) {
                if (id === user.user_id || seen[id]) return false;
                seen[id] = true;
                return true;
            });
            if (!userIds.length) return [];
            return Api.query('users', 'select=user_id,name,email,role&user_id=in.(' + userIds.join(',') + ')');
        })
        .then(function(members) {
            if (!members || !members.length) {
                familyList.innerHTML = '<p class="text-gray-500">ยังไม่มีสมาชิกอื่นในครอบครัว</p>';
                return;
            }
            familyList.innerHTML = members.map(function(m) {
                return '<div class="flex items-center gap-3 py-3 border-b border-gray-100 last:border-0">'
                    + '<img class="h-10 w-10 rounded-full object-cover" src="https://ui-avatars.com/api/?name=' + encodeURIComponent(m.name) + '&background=f2ebfa&color=4b2673" alt="">'
                    + '<div><p class="text-sm font-medium text-gray-900">' + m.name + '</p><p class="text-xs text-gray-500">' + m.email + ' • ' + m.role + '</p></div>'
                    + '</div>';
            }).join('');
        })
        .catch(function(err) {
            console.error('Load family error:', err);
            familyList.innerHTML = '<p class="text-red-400">โหลดข้อมูลสมาชิกไม่สำเร็จ: ' + (err.message || err) + '</p>';
        });
    }

    function loadPetCount() {
        var user = Auth.getUser();
        var countEl = document.getElementById('ownedPetCount');
        if (!countEl) return;
        Api.query('pet_access', 'select=pet_id&user_id=eq.' + user.user_id + '&access_role=eq.Owner')
        .then(function(rows) {
            countEl.textContent = (rows || []).length;
        })
        .catch(function(err) {
            console.error('Load owned pet count error:', err);
            countEl.textContent = '—';
        });
    }

    function save() {
        var user = Auth.getUser();
        var newName = document.getElementById('editName').value;
        if (!newName) { alert('กรุณากรอกชื่อ'); return; }
        Api.update('users', 'user_id=eq.' + user.user_id, { name: newName })
        .then(function() {
            user.name = newName;
            var msg = document.getElementById('profileMsg');
            msg.textContent = 'บันทึกสำเร็จ!';
            msg.classList.remove('hidden');
            setTimeout(function() { msg.classList.add('hidden'); }, 3000);
            // อัปเดต nav bar
            document.getElementById('profileName').textContent = newName;
            document.getElementById('profileAvatar').src = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(newName) + '&background=663399&color=fff&size=160';
        })
        .catch(function(err) {
            console.error('Save profile error:', err);
            alert('บันทึกไม่สำเร็จ: ' + (err.message || err));
        });
    }

    function changePassword() {
        var session = Auth.getSession();
        if (!session || !session.access_token) return;
        var email = Auth.getUser().email;
        // ใช้ Supabase Auth API ส่ง reset password email
        fetch(CONFIG.AUTH + '/recover', {
            method: 'POST',
            headers: { 'apikey': CONFIG.SB_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email })
        }).then(function() {
            alert('ส่งลิงก์เปลี่ยนรหัสผ่านไปที่ ' + email + ' แล้ว');
        }).catch(function() {
            alert('เกิดข้อผิดพลาด กรุณาลองใหม่');
        });
    }

    return { init: init, save: save, changePassword: changePassword };
})();
