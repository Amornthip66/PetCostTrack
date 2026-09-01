/**
 * Expense History Module
 */
var History = (function() {

    var _pets = [], _categories = [], _expenses = [];

    function init() {
        Promise.all([
            Api.query('pets', 'select=pet_id,name'),
            Api.query('categories', 'select=category_id,category_name')
        ]).then(function(r) {
            _pets = r[0] || [];
            _categories = r[1] || [];
            populateFilters();
            load();
        });
    }

    function populateFilters() {
        var petSel = document.getElementById('filterPet');
        if (petSel) {
            petSel.innerHTML = '<option value="">ทุกสัตว์เลี้ยง</option>';
            _pets.forEach(function(p) {
                var opt = document.createElement('option');
                opt.value = p.pet_id;
                opt.textContent = p.name;
                petSel.appendChild(opt);
            });
        }
        var catSel = document.getElementById('filterCategory');
        if (catSel) {
            catSel.innerHTML = '<option value="">ทุกหมวดหมู่</option>';
            _categories.forEach(function(c) {
                var opt = document.createElement('option');
                opt.value = c.category_id;
                opt.textContent = c.category_name;
                catSel.appendChild(opt);
            });
        }
        // Form pet dropdown
        var formPet = document.getElementById('formPet');
        if (formPet) {
            formPet.innerHTML = '';
            if (!_pets.length) {
                formPet.innerHTML = '<option value="">ไม่พบสัตว์เลี้ยง (กรุณาเพิ่มสัตว์เลี้ยงก่อน)</option>';
            } else {
                _pets.forEach(function(p) {
                    var opt = document.createElement('option');
                    opt.value = p.pet_id;
                    opt.textContent = p.name;
                    formPet.appendChild(opt);
                });
            }
        }
        // Set today's date
        var dateInput = document.getElementById('formDate');
        if (dateInput) {
            dateInput.value = new Date().toISOString().split('T')[0];
        }
    }

    function load() {
        var tbody = document.getElementById('historyTable');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-12 text-center text-gray-400"><i class="fa-solid fa-spinner fa-spin mr-2"></i>กำลังโหลด...</td></tr>';
        }

        var params = 'select=transaction_id,amount,expense_date,expense_type,expense_note,pet_id,user_id,category_id,pets(pet_id,name),users(name),categories(category_id,category_name)&order=expense_date.desc&limit=100';
        var typeEl = document.getElementById('filterType');
        var petEl = document.getElementById('filterPet');
        var catEl = document.getElementById('filterCategory');

        var type = typeEl ? typeEl.value : '';
        var pet = petEl ? petEl.value : '';
        var cat = catEl ? catEl.value : '';

        if (type) params += '&expense_type=eq.' + encodeURIComponent(type);
        if (pet) params += '&pet_id=eq.' + encodeURIComponent(pet);
        if (cat) params += '&category_id=eq.' + encodeURIComponent(cat);

        Api.query('expenses', params).then(function(data) {
            _expenses = data || [];
            render();
        }).catch(function(err) {
            console.error('Error loading expenses:', err);
            if (tbody) {
                tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-12 text-center text-red-500"><i class="fa-solid fa-triangle-exclamation mr-2"></i>เกิดข้อผิดพลาดในการโหลดรายการ (' + err.message + ')</td></tr>';
            }
        });
    }

    function render() {
        var tbody = document.getElementById('historyTable');
        if (!tbody) return;
        var total = _expenses.reduce(function(s, e) { return s + Number(e.amount || 0); }, 0);
        var totalEl = document.getElementById('totalFiltered');
        if (totalEl) totalEl.textContent = '฿ ' + UI.fmt(total);

        if (!_expenses.length) {
            tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-12 text-center text-gray-400">ไม่มีรายการ</td></tr>';
            return;
        }
        tbody.innerHTML = _expenses.map(function(e) {
            var cat = (e.categories && e.categories.category_name) ? e.categories.category_name : '';
            var icon = UI.getIcon(cat);
            var hidden = e.expense_type === 'แฝง';
            var petName = (e.pets && e.pets.name) ? e.pets.name : (e.pet_id ? 'สัตว์เลี้ยง #' + e.pet_id : '—');
            return '<tr class="hover:bg-gray-50 transition">'
                + '<td class="px-4 py-3 text-gray-600 whitespace-nowrap">' + UI.formatDate(e.expense_date) + '</td>'
                + '<td class="px-4 py-3"><span class="font-medium text-gray-900">' + (e.expense_note || cat || '—') + '</span></td>'
                + '<td class="px-4 py-3 text-gray-600">' + petName + '</td>'
                + '<td class="px-4 py-3"><span class="inline-flex items-center gap-1"><i class="fa-solid ' + icon.i + ' text-xs ' + icon.cl + '"></i> ' + (cat || '—') + '</span></td>'
                + '<td class="px-4 py-3"><span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ' + (hidden ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600') + '">' + (hidden ? 'แฝง' : 'ปกติ') + '</span></td>'
                + '<td class="px-4 py-3 text-right font-bold ' + (hidden ? 'text-red-600' : 'text-gray-900') + '">฿ ' + UI.fmt(e.amount) + '</td>'
                + '</tr>';
        }).join('');
    }

    function openModal() { document.getElementById('expenseModal').classList.remove('hidden'); }
    function closeModal() { document.getElementById('expenseModal').classList.add('hidden'); }

    function submit() {
        var user = Auth.getUser();
        var catId = document.getElementById('formCategory').value;
        var note = document.getElementById('formNote').value;
        var amount = document.getElementById('formAmount').value;
        var date = document.getElementById('formDate').value;
        var petId = document.getElementById('formPet').value;

        if (!petId) { alert('กรุณาเลือกสัตว์เลี้ยง'); return; }
        if (!amount || Number(amount) <= 0) { alert('กรุณากรอกจำนวนเงิน'); return; }
        if (!date) { alert('กรุณาเลือกวันที่'); return; }

        var userId = (user && user.user_id) ? user.user_id : 1;
        var hidden = [4,5,6].indexOf(Number(catId)) >= 0;

        Api.insert('expenses', {
            amount: Number(amount),
            expense_date: date,
            expense_type: hidden ? 'แฝง' : 'หลัก',
            pet_id: Number(petId),
            user_id: userId,
            category_id: Number(catId),
            expense_note: note || null
        }).then(function() {
            closeModal();
            load();
        }).catch(function(err) {
            alert('บันทึกไม่สำเร็จ: ' + err.message);
        });
    }

    return { init: init, load: load, openModal: openModal, closeModal: closeModal, submit: submit };
})();