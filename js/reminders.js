/**
 * Reminders Module
 */
var Reminders = (function() {

    var _pets = [], _categories = [], _reminders = [], _invitations = [];

    function init() {
        Promise.all([
            queryActivePetsResilient(),
            Api.query('categories', 'select=category_id,category_name'),
            loadInvitations()
        ]).then(function(r) {
            _pets = r[0] || [];
            _categories = r[1] || [];
            populateForm();
            load();
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
        return Api.query('pet_invitations',
            'select=invitation_id,created_at,pets(name),inviter:users!invited_by(name)'
            + '&invited_user_id=eq.' + user.user_id + '&status=eq.pending&order=created_at.desc'
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
        _pets.forEach(function(p) { var o = document.createElement('option'); o.value = p.pet_id; o.textContent = p.name; petSel.appendChild(o); });
        var catSel = document.getElementById('formCategory');
        _categories.forEach(function(c) { var o = document.createElement('option'); o.value = c.category_id; o.textContent = c.category_name; catSel.appendChild(o); });
        document.getElementById('formDue').value = new Date().toISOString().split('T')[0];
    }

    function load() {
        Api.query('reminders', 'select=task_id,frequency,next_due_date,is_completed,pets(name),categories(category_name)&order=next_due_date.asc&limit=50')
        .then(function(data) { _reminders = data || []; render(); });
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
            return '<div class="bg-white rounded-xl shadow-sm p-4 flex items-center gap-4 border-l-4 ' + (isDone ? 'border-gray-300' : isDue ? 'border-red-500' : 'border-pet') + ' transition hover:shadow-md">'
                + '<div class="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ' + (isDone ? 'bg-gray-100 text-gray-400' : isDue ? 'bg-red-100 text-red-500' : 'bg-pet text-white') + '"><i class="fa-solid ' + (isDone ? 'fa-check' : 'fa-bell') + '"></i></div>'
                + '<div class="flex-1 min-w-0">'
                + '<p class="text-sm font-semibold ' + (isDone ? 'text-gray-400 line-through' : 'text-gray-900') + '">' + cat + '</p>'
                + '<p class="text-xs text-gray-500">' + (r.pets ? r.pets.name : '') + ' • ' + r.frequency + ' • ครบกำหนด ' + UI.formatDate(r.next_due_date) + '</p>'
                + '</div>'
                + '<div class="flex items-center gap-2">'
                + (isDone ? '' : '<button onclick="Reminders.complete(' + r.task_id + ')" class="btn btn-sm btn-success"><i class="fa-solid fa-check mr-1"></i>เสร็จแล้ว</button>')
                + '<button onclick="Reminders.remove(' + r.task_id + ')" class="btn btn-sm btn-danger"><i class="fa-solid fa-trash"></i></button>'
                + '</div></div>';
        }).join('');
    }

    function openModal() { document.getElementById('reminderModal').classList.remove('hidden'); }
    function closeModal() { document.getElementById('reminderModal').classList.add('hidden'); }

    function save() {
        var data = {
            pet_id: Number(document.getElementById('formPet').value),
            category_id: Number(document.getElementById('formCategory').value),
            frequency: document.getElementById('formFreq').value,
            next_due_date: document.getElementById('formDue').value,
            is_completed: false
        };
        if (!data.next_due_date) { alert('กรุณาเลือกวันที่'); return; }
        Api.insert('reminders', data).then(function() { closeModal(); load(); });
    }

    function complete(taskId) {
        Api.update('reminders', 'task_id=eq.' + taskId, { is_completed: true }).then(function() { load(); });
    }

    function remove(taskId) {
        if (!confirm('ต้องการลบการแจ้งเตือนนี้จริงหรือไม่?')) return;
        Api.remove('reminders', 'task_id=eq.' + taskId).then(function() { load(); });
    }

    return {
        init: init, openModal: openModal, closeModal: closeModal, save: save, complete: complete, remove: remove,
        acceptInvitation: acceptInvitation, declineInvitation: declineInvitation
    };
})();
