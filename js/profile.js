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
        loadPetArchive();
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

    // === เพิ่มสมาชิกในครอบครัว (Invite family member) ===
    function openInviteModal() {
        document.getElementById('inviteEmail').value = '';
        document.getElementById('inviteMsg').classList.add('hidden');
        document.getElementById('inviteModal').classList.remove('hidden');
        loadOwnedPetsForInvite();
    }

    function closeInviteModal() {
        document.getElementById('inviteModal').classList.add('hidden');
    }

    function loadOwnedPetsForInvite() {
        var user = Auth.getUser();
        var list = document.getElementById('invitePetsList');
        list.innerHTML = '<div class="text-gray-400 text-sm"><i class="fa-solid fa-spinner fa-spin mr-2"></i>กำลังโหลด...</div>';

        Api.query('pet_access', 'select=pet_id&user_id=eq.' + user.user_id + '&access_role=eq.Owner')
        .then(function(access) {
            var petIds = (access || []).map(function(a) { return a.pet_id; });
            if (!petIds.length) {
                list.innerHTML = '<p class="text-sm text-gray-500">คุณยังไม่มีสัตว์เลี้ยงที่เป็นเจ้าของ กรุณาเพิ่มสัตว์เลี้ยงก่อนเชิญสมาชิก</p>';
                return;
            }
            return Api.query('pets', 'select=pet_id,name&pet_id=in.(' + petIds.join(',') + ')&order=pet_id.asc')
            .then(function(pets) {
                list.innerHTML = (pets || []).map(function(p) {
                    return '<label class="flex items-center gap-2 text-sm text-gray-700">'
                        + '<input type="checkbox" class="invitePetCheckbox" value="' + p.pet_id + '" checked>'
                        + p.name
                        + '</label>';
                }).join('');
            });
        });
    }

    function addFamilyMember() {
        var emailInput = document.getElementById('inviteEmail');
        var msg = document.getElementById('inviteMsg');
        var email = emailInput.value.trim();
        msg.classList.add('hidden');

        if (!email) { alert('กรุณากรอกอีเมลของสมาชิกที่ต้องการเชิญ'); return; }

        var petIds = Array.prototype.slice.call(document.querySelectorAll('.invitePetCheckbox:checked'))
            .map(function(el) { return Number(el.value); });
        if (!petIds.length) { alert('กรุณาเลือกสัตว์เลี้ยงอย่างน้อย 1 ตัว'); return; }

        Promise.all(petIds.map(function(petId) {
            return Api.rpc('invite_co_caretaker', { p_pet_id: petId, p_email: email }).catch(function(err) {
                var text = (err && err.message) || String(err);
                // ถ้าสัตว์เลี้ยงบางตัวเชิญไปแล้วก่อนหน้า/เป็นสมาชิกอยู่แล้ว ข้ามได้โดยไม่ถือเป็นข้อผิดพลาด
                if (text.indexOf('อยู่แล้ว') >= 0) return null;
                throw err;
            });
        }))
        .then(function() {
            closeInviteModal();
            loadFamily();
        })
        .catch(function(err) {
            msg.textContent = (err && err.message) || String(err);
            msg.classList.remove('hidden');
        });
    }

    // === คลังสัตว์เลี้ยง (Pet Archive) — สัตว์เลี้ยงที่เก็บเข้าคลังแทนการลบถาวร ===
    function loadPetArchive() {
        var user = Auth.getUser();
        var list = document.getElementById('petArchiveList');
        if (!list || !user) return;

        Api.query('pet_access', 'select=pet_id,access_role&user_id=eq.' + user.user_id)
        .then(function(access) {
            access = access || [];
            var accessMap = {};
            access.forEach(function(a) { accessMap[a.pet_id] = a.access_role; });
            var petIds = access.map(function(a) { return a.pet_id; });
            if (!petIds.length) { list.innerHTML = '<p class="text-gray-500">ยังไม่มีสัตว์เลี้ยงในคลัง</p>'; return; }

            return Api.query('pets',
                'select=pet_id,name,type_breed,age,archived_note,archived_at&pet_id=in.(' + petIds.join(',') + ')'
                + '&is_archived=eq.true&order=archived_at.desc'
            ).then(function(pets) {
                pets = pets || [];
                if (!pets.length) { list.innerHTML = '<p class="text-gray-500">ยังไม่มีสัตว์เลี้ยงในคลัง</p>'; return; }

                list.innerHTML = pets.map(function(p) {
                    var isOwner = accessMap[p.pet_id] === 'Owner';
                    return '<div class="flex items-start gap-3 py-3 border-b border-gray-100 last:border-0">'
                        + '<div class="flex-shrink-0 w-10 h-10 rounded-full bg-gray-100 text-gray-400 flex items-center justify-center"><i class="fa-solid fa-paw"></i></div>'
                        + '<div class="flex-1 min-w-0">'
                        + '<p class="text-sm font-medium text-gray-900">' + p.name + '</p>'
                        + '<p class="text-xs text-gray-500">' + (p.type_breed || 'ไม่ระบุพันธุ์') + (p.age ? ' • ' + p.age + ' ปี' : '') + '</p>'
                        + '<p class="text-xs text-gray-500 mt-1"><i class="fa-solid fa-box-archive mr-1"></i>' + (p.archived_note || '') + (p.archived_at ? ' • ' + UI.formatDate(p.archived_at) : '') + '</p>'
                        + '</div>'
                        + (isOwner ? '<button onclick="Profile.restorePet(' + p.pet_id + ')" class="btn btn-sm btn-outline-primary flex-shrink-0" title="กู้คืน"><i class="fa-solid fa-rotate-left mr-1"></i>กู้คืน</button>' : '')
                        + '</div>';
                }).join('');
            });
        })
        .catch(function(err) {
            // เผื่อฐานข้อมูลจริงยังไม่ได้รัน migration 20260908000000_pet_archive.sql
            // (คอลัมน์ is_archived ยังไม่มี) — ไม่ให้หน้าโปรไฟล์พังทั้งหน้าเพราะ section นี้พัง
            console.error('Load pet archive error:', err);
            list.innerHTML = '<p class="text-red-400 text-sm">ไม่สามารถโหลดคลังสัตว์เลี้ยงได้</p>';
        });
    }

    function restorePet(petId) {
        if (!confirm('ต้องการกู้คืนสัตว์เลี้ยงตัวนี้กลับไปที่หน้า "สัตว์เลี้ยงของฉัน" หรือไม่?')) return;
        Api.update('pets', 'pet_id=eq.' + petId, { is_archived: false, archived_note: null, archived_at: null })
        .then(function() { loadPetArchive(); })
        .catch(function(err) { alert('ไม่สามารถกู้คืนได้: ' + (err.message || err)); });
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

    return {
        init: init, save: save, changePassword: changePassword,
        openInviteModal: openInviteModal, closeInviteModal: closeInviteModal, addFamilyMember: addFamilyMember,
        restorePet: restorePet
    };
})();
