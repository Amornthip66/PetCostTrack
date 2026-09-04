/**
 * Reminders Module
 */
var Reminders = (function() {

    var _pets = [], _categories = [], _reminders = [];

    function init() {
        Promise.all([
            Api.query('pets', 'select=pet_id,name'),
            Api.query('categories', 'select=category_id,category_name')
        ]).then(function(r) {
            _pets = r[0] || [];
            _categories = r[1] || [];
            populateForm();
            load();
        });
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
            return '<div class="bg-white rounded-xl shadow-sm p-4 flex items-center gap-4 border-l-4 ' + (isDone ? 'border-gray-300' : isDue ? 'border-red-500' : 'border-pet-DEFAULT') + ' transition hover:shadow-md">'
                + '<div class="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ' + (isDone ? 'bg-gray-100 text-gray-400' : isDue ? 'bg-red-100 text-red-500' : 'bg-pet-DEFAULT text-white') + '"><i class="fa-solid ' + (isDone ? 'fa-check' : 'fa-bell') + '"></i></div>'
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

    return { init: init, openModal: openModal, closeModal: closeModal, save: save, complete: complete, remove: remove };
})();
