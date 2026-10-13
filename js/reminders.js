/**
 * Reminders Module
 */
var Reminders = (function() {

    var _pets = [], _categories = [], _reminders = [], _invitations = [];
    // สิทธิ์ของผู้ใช้ต่อสัตว์เลี้ยงแต่ละตัว (pet_id → 'Owner' | 'Co-caretaker')
    // ตั้ง/แก้/ลบการแจ้งเตือนได้เฉพาะ Owner ตาม RLS reminders_insert/update/delete
    // จึงซ่อนปุ่มให้ Co-caretaker (การบังคับจริงยังอยู่ที่ RLS)
    var _petRoleMap = {};
    // อายุคำเชิญ อ่านจากฐานข้อมูล (invitation_expiry_days) ถ้าเรียกไม่ได้ใช้ 7 วัน
    var _inviteExpiryDays = 7;
    var DEFAULT_NOTIFY_DAYS = 7;

    function init() {
        Promise.all([
            queryActivePetsResilient(),
            Api.query('categories', 'select=category_id,category_name'),
            loadPetRoleMap(),
            loadInviteExpiryDays().then(loadInvitations)
        ]).then(function(r) {
            _pets = r[0] || [];
            _categories = r[1] || [];
            populateForm();
            load();
        });
    }

    function loadPetRoleMap() {
        var userPromise = Auth.getUser() ? Promise.resolve(Auth.getUser()) : Auth.loadProfile();
        return userPromise.then(function(user) {
            if (!user || !user.user_id) return;
            return Api.query('pet_access', 'select=pet_id,access_role&user_id=eq.' + user.user_id)
            .then(function(rows) {
                _petRoleMap = {};
                (rows || []).forEach(function(r) { _petRoleMap[r.pet_id] = r.access_role; });
            });
        }).catch(function(err) {
            console.warn('Load pet_access map failed:', err);
        });
    }

    function isOwnerOf(petId) {
        return _petRoleMap[petId] === 'Owner';
    }

    function loadInviteExpiryDays() {
        return Api.rpc('invitation_expiry_days', {}).then(function(days) {
            if (typeof days === 'number' && days > 0) _inviteExpiryDays = days;
        }).catch(function(err) {
            console.warn('invitation_expiry_days RPC failed, using default 7:', err);
        });
    }

    // ดึงสัตว์เลี้ยงที่ยังไม่ถูกเก็บเข้าคลังแบบกันพัง (ไม่ควรตั้งแจ้งเตือนใหม่ให้สัตว์เลี้ยงที่
    // เสียชีวิต/ย้ายไปแล้ว) เผื่อฐานข้อมูลจริงยังไม่ได้รัน migration
    // 20260908000000_pet_archive.sql (ที่เพิ่มคอลัมน์ is_archived)
    function queryActivePetsResilient() {
        return Api.query('pets', 'select=pet_id,name&is_archived=eq.false')
        .catch(function(err) {
            console.warn('pets query with is_archived failed, falling back:', err);
            return Api.query('pets', 'select=pet_id,name');
        });
    }

    // === คำเชิญเป็นผู้ร่วมดูแล (แยกจากรายการแจ้งเตือนปกติ อยู่บนสุดของหน้าเสมอ) ===
    function loadInvitations() {
        var user = Auth.getUser();
        if (!user || !user.user_id) { renderInvitations(); return Promise.resolve(); }
        // แสดงเฉพาะคำเชิญที่ยังไม่หมดอายุ (คำเชิญที่เกินอายุตอบรับไม่ได้อยู่แล้ว
        // accept_pet_invitation() จะปฏิเสธ จึงไม่ควรขึ้นปุ่มตอบรับให้กด)
        var notBefore = new Date(Date.now() - _inviteExpiryDays * 86400000).toISOString();
        return Api.query('pet_invitations',
            'select=invitation_id,created_at,pets(name),inviter:users!invited_by(name)'
            + '&invited_user_id=eq.' + user.user_id + '&status=eq.pending'
            + '&created_at=gte.' + encodeURIComponent(notBefore) + '&order=created_at.desc'
        ).then(function(data) {
            _invitations = data || [];
            renderInvitations();
        }).catch(function(err) {
            console.error('Load invitations error:', err);
            _invitations = [];
            renderInvitations();
        });
    }

    function renderInvitations() {
        var section = document.getElementById('invitationsSection');
        var list = document.getElementById('invitationsList');
        if (!section || !list) return;
        if (!_invitations.length) { section.classList.add('hidden'); return; }
        section.classList.remove('hidden');
        list.innerHTML = _invitations.map(function(inv) {
            var petName = inv.pets ? inv.pets.name : 'สัตว์เลี้ยง';
            var inviterName = inv.inviter ? inv.inviter.name : 'เจ้าของสัตว์เลี้ยง';
            return '<div class="bg-white rounded-lg p-4 flex flex-col sm:flex-row sm:items-center gap-3 border border-amber-200">'
                + '<div class="flex-shrink-0 w-10 h-10 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center"><i class="fa-solid fa-envelope-open-text"></i></div>'
                + '<div class="flex-1 min-w-0">'
                + '<p class="text-sm font-semibold text-gray-900">' + inviterName + ' เชิญคุณร่วมดูแล "' + petName + '"</p>'
                + '<p class="text-xs text-gray-500">' + UI.formatDate(inv.created_at) + '</p>'
                + '</div>'
                + '<div class="flex items-center gap-2">'
                + '<button onclick="Reminders.acceptInvitation(' + inv.invitation_id + ')" class="btn btn-sm btn-primary"><i class="fa-solid fa-check mr-1"></i>ตอบรับ</button>'
                + '<button onclick="Reminders.declineInvitation(' + inv.invitation_id + ')" class="btn btn-sm btn-secondary"><i class="fa-solid fa-xmark mr-1"></i>ปฏิเสธ</button>'
                + '</div></div>';
        }).join('');
    }

    function acceptInvitation(invitationId) {
        Api.rpc('accept_pet_invitation', { p_invitation_id: invitationId })
        .then(function() { return loadInvitations(); })
        .catch(function(err) { alert('ไม่สามารถตอบรับคำเชิญได้: ' + (err.message || err)); });
    }

    function declineInvitation(invitationId) {
        if (!confirm('ต้องการปฏิเสธคำเชิญนี้หรือไม่?')) return;
        Api.rpc('decline_pet_invitation', { p_invitation_id: invitationId })
        .then(function() { return loadInvitations(); })
        .catch(function(err) { alert('ไม่สามารถปฏิเสธคำเชิญได้: ' + (err.message || err)); });
    }

    function populateForm() {
        var petSel = document.getElementById('formPet');
        // ตั้งการแจ้งเตือนได้เฉพาะสัตว์เลี้ยงที่ตัวเองเป็น Owner (RLS reminders_insert)
        var ownPets = _pets.filter(function(p) { return isOwnerOf(p.pet_id); });
        ownPets.forEach(function(p) { var o = document.createElement('option'); o.value = p.pet_id; o.textContent = p.name; petSel.appendChild(o); });
        var addBtn = document.getElementById('addReminderBtn');
        if (addBtn && !ownPets.length) {
            addBtn.disabled = true;
            addBtn.title = 'ตั้งการแจ้งเตือนได้เฉพาะสัตว์เลี้ยงที่คุณเป็นเจ้าของ (Owner)';
        }
        var catSel = document.getElementById('formCategory');
        _categories.forEach(function(c) { var o = document.createElement('option'); o.value = c.category_id; o.textContent = c.category_name; catSel.appendChild(o); });
        document.getElementById('formDue').value = new Date().toISOString().split('T')[0];
    }

    function load() {
        var base = 'task_id,pet_id,frequency,next_due_date,is_completed,pets(name),categories(category_name)';
        var order = '&order=next_due_date.asc&limit=50';
        // notify_days_before มาจาก migration 20261013100100 — ถ้าฐานข้อมูลยังไม่ได้รัน
        // ให้ถอยไปดึงแบบไม่มีคอลัมน์นี้ (ถือว่าแจ้งล่วงหน้า 7 วันเหมือนเดิม)
        Api.query('reminders', 'select=' + base + ',notify_days_before' + order)
        .catch(function(err) {
            console.warn('reminders query with notify_days_before failed, falling back (migration not applied yet?):', err);
            return Api.query('reminders', 'select=' + base + order);
        })
        .then(function(data) { _reminders = data || []; render(); })
        .catch(function(err) {
            console.error('Load reminders error:', err);
            var list = document.getElementById('reminderList');
            if (list) list.innerHTML = '<div class="text-center py-12 text-red-400">โหลดข้อมูลไม่สำเร็จ: ' + (err.message || err) + '</div>';
        });
    }

    function notifyDaysOf(r) {
        var n = Number(r.notify_days_before);
        return isNaN(n) || r.notify_days_before == null ? DEFAULT_NOTIFY_DAYS : n;
    }

    function notifyLabel(days) {
        return days === 0 ? 'เตือนวันครบกำหนด' : 'เตือนล่วงหน้า ' + days + ' วัน';
    }

    function render() {
        var list = document.getElementById('reminderList');
        if (!_reminders.length) {
            list.innerHTML = '<div class="text-center py-12 text-gray-400"><i class="fa-solid fa-bell-slash text-4xl mb-3 block"></i>ไม่มีการแจ้งเตือน</div>';
            return;
        }
        var today = new Date().toISOString().split('T')[0];
        list.innerHTML = _reminders.map(function(r) {
            var isDue = r.next_due_date <= today && !r.is_completed;
            var isDone = r.is_completed;
            var cat = r.categories ? r.categories.category_name : '';
            var canManage = isOwnerOf(r.pet_id);
            return '<div class="bg-white rounded-xl shadow-sm p-4 flex items-center gap-4 border-l-4 ' + (isDone ? 'border-gray-300' : isDue ? 'border-red-500' : 'border-pet') + ' transition hover:shadow-md">'
                + '<div class="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ' + (isDone ? 'bg-gray-100 text-gray-400' : isDue ? 'bg-red-100 text-red-500' : 'bg-pet text-white') + '"><i class="fa-solid ' + (isDone ? 'fa-check' : 'fa-bell') + '"></i></div>'
                + '<div class="flex-1 min-w-0">'
                + '<p class="text-sm font-semibold ' + (isDone ? 'text-gray-400 line-through' : 'text-gray-900') + '">' + cat + '</p>'
                + '<p class="text-xs text-gray-500">' + (r.pets ? r.pets.name : '') + ' • ' + r.frequency + ' • ครบกำหนด ' + UI.formatDate(r.next_due_date) + ' • ' + notifyLabel(notifyDaysOf(r)) + '</p>'
                + '</div>'
                + '<div class="flex items-center gap-2">'
                + (canManage
                    ? (isDone ? '' : '<button onclick="Reminders.complete(' + r.task_id + ')" class="btn btn-sm btn-success" title="ทำเสร็จแล้ว ระบบจะตั้งรอบถัดไปให้"><i class="fa-solid fa-check mr-1"></i>เสร็จแล้ว</button>')
                      + '<button onclick="Reminders.remove(' + r.task_id + ')" class="btn btn-sm btn-danger" title="ลบ"><i class="fa-solid fa-trash"></i></button>'
                    : '<span class="text-xs text-gray-400">เฉพาะเจ้าของจัดการได้</span>')
                + '</div></div>';
        }).join('');
    }

    function openModal() { document.getElementById('reminderModal').classList.remove('hidden'); }
    function closeModal() { document.getElementById('reminderModal').classList.add('hidden'); }

    function save() {
        var notifyInput = document.getElementById('formNotifyDays');
        var notifyDays = notifyInput ? Number(notifyInput.value) : DEFAULT_NOTIFY_DAYS;
        var data = {
            pet_id: Number(document.getElementById('formPet').value),
            category_id: Number(document.getElementById('formCategory').value),
            frequency: document.getElementById('formFreq').value,
            next_due_date: document.getElementById('formDue').value,
            is_completed: false
        };
        if (!data.pet_id || !data.category_id) { alert('กรุณาเลือกสัตว์เลี้ยงและหมวดหมู่'); return; }
        if (!data.next_due_date) { alert('กรุณาเลือกวันที่'); return; }
        if (isNaN(notifyDays) || notifyDays < 0 || notifyDays > 60 || Math.floor(notifyDays) !== notifyDays) {
            alert('จำนวนวันแจ้งเตือนล่วงหน้าต้องเป็นจำนวนเต็ม 0–60 วัน');
            return;
        }
        data.notify_days_before = notifyDays;
        Api.insert('reminders', data)
        .catch(function(err) {
            // ฐานข้อมูลยังไม่มีคอลัมน์ notify_days_before → บันทึกแบบเดิม (แจ้งล่วงหน้า 7 วัน)
            if (/notify_days_before/.test(err.message || '')) {
                delete data.notify_days_before;
                return Api.insert('reminders', data);
            }
            throw err;
        })
        .then(function() { closeModal(); load(); })
        .catch(function(err) { alert('บันทึกการแจ้งเตือนไม่สำเร็จ: ' + (err.message || err)); });
    }

    // complete_reminder(): เลื่อนวันครบกำหนดไปรอบถัดไปที่ยังไม่ผ่าน (+1 เดือน / +1 ปี)
    // แล้วกลับมาเป็นรายการที่รอเตือน (migration 20260922000200 / 20261013100100)
    function complete(taskId) {
        Api.rpc('complete_reminder', { p_task_id: taskId })
        .then(function(rows) {
            var row = Array.isArray(rows) ? rows[0] : rows;
            load();
            if (row && row.next_due_date) {
                showNotice('บันทึกแล้ว รอบถัดไปครบกำหนด ' + UI.formatDate(row.next_due_date));
            }
        })
        .catch(function(err) { alert('บันทึกไม่สำเร็จ: ' + (err.message || err)); });
    }

    function remove(taskId) {
        if (!confirm('ต้องการลบการแจ้งเตือนนี้จริงหรือไม่?')) return;
        Api.remove('reminders', 'task_id=eq.' + taskId)
        .then(function() { load(); })
        .catch(function(err) { alert('ลบไม่สำเร็จ: ' + (err.message || err)); });
    }

    function showNotice(text) {
        var el = document.getElementById('reminderNotice');
        if (!el) return;
        el.textContent = text;
        el.classList.remove('hidden');
        clearTimeout(showNotice._t);
        showNotice._t = setTimeout(function() { el.classList.add('hidden'); }, 6000);
    }

    return {
        init: init, openModal: openModal, closeModal: closeModal, save: save, complete: complete, remove: remove,
        acceptInvitation: acceptInvitation, declineInvitation: declineInvitation
    };
})();
