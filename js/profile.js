/**
 * Profile Module
 */
var Profile = (function() {

    function init() {
        var user = Auth.getUser();
        if (!user) return;

        document.getElementById('profileName').textContent = user.name;
        document.getElementById('profileRole').textContent = user.role;
        document.getElementById('profileAvatar').src = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(user.name) + '&background=0ea5e9&color=fff&size=160';
        document.getElementById('editName').value = user.name;
        document.getElementById('editEmail').value = user.email;
        document.getElementById('editRole').value = user.role;

        loadFamily();
    }

    function loadFamily() {
        var user = Auth.getUser();
        // หา user_id ของคนที่มีสัตว์เลี้ยงร่วมกัน
        Api.query('pet_access', 'select=user_id,access_role&pet_id=in.(select pet_id from pet_access where user_id=' + user.user_id + ')')
        .then(function(access) {
            var userIds = (access || []).map(function(a) { return a.user_id; });
            userIds = userIds.filter(function(id) { return id !== user.user_id; });
            if (!userIds.length) {
                document.getElementById('familyList').innerHTML = '<p class="text-gray-500">ยังไม่มีสมาชิกอื่นในครอบครัว</p>';
                return;
            }
            return Api.query('users', 'select=user_id,name,email,role&user_id=in.(' + userIds.join(',') + ')');
        })
        .then(function(members) {
            if (!members) return;
            document.getElementById('familyList').innerHTML = members.map(function(m) {
                return '<div class="flex items-center gap-3 py-3 border-b border-gray-100 last:border-0">'
                    + '<img class="h-10 w-10 rounded-full object-cover" src="https://ui-avatars.com/api/?name=' + encodeURIComponent(m.name) + '&background=e0f2fe&color=0369a1" alt="">'
                    + '<div><p class="text-sm font-medium text-gray-900">' + m.name + '</p><p class="text-xs text-gray-500">' + m.email + ' • ' + m.role + '</p></div>'
                    + '</div>';
            }).join('');
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
            document.getElementById('profileAvatar').src = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(newName) + '&background=0ea5e9&color=fff&size=160';
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
