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
        _pets.forEach(function(p) {
            var opt = document.createElement('option');
            opt.value = p.pet_id; opt.textContent = p.name;
            petSel.appendChild(opt);
        });
        var catSel = document.getElementById('filterCategory');
        _categories.forEach(function(c) {
            var opt = document.createElement('option');
            opt.value = c.category_id; opt.textContent = c.category_name;
            catSel.appendChild(opt);
        });
        // Form pet dropdown
        var formPet = document.getElementById('formPet');
        _pets.forEach(function(p) {
            var opt = document.createElement('option');
            opt.value = p.pet_id; opt.textContent = p.name;
            formPet.appendChild(opt);
        });
        // Set today's date
        document.getElementById('formDate').value = new Date().toISOString().split('T')[0];
    }

    function load() {
        var type = document.getElementById('filterType').value;
        var pet = document.getElementById('filterPet').value;
        var cat = document.getElementById('filterCategory').value;

        // เดิม select เรียก pets(...) ซ้ำ 2 ครั้ง (pets(name) และ pets(pet_id) แยกกัน)
        // ซึ่ง PostgREST ไม่รองรับ join ตารางเดียวกันซ้ำในคำสั่งเดียว ทำให้ query error
        // (แต่ไม่มี .catch() เลยหน้าค้างที่ "กำลังโหลด..." ตลอดไปแบบเงียบๆ)
        // รวมเป็น pets(pet_id,name) ที่เดียว และใช้ !inner ตอนกรองเพื่อให้กรองแถวหลักได้จริง
        var petsJoin = pet ? 'pets!inner(pet_id,name)' : 'pets(pet_id,name)';
        var catJoin = cat ? 'categories!inner(category_name,category_id)' : 'categories(category_name,category_id)';
        var params = 'select=transaction_id,amount,expense_date,expense_type,expense_note,'
            + petsJoin + ',users(name),' + catJoin + '&order=expense_date.desc&limit=100';

        if (type) params += '&expense_type=eq.' + encodeURIComponent(type);
        if (pet) params += '&pets.pet_id=eq.' + pet;
        if (cat) params += '&categories.category_id=eq.' + cat;

        var tbody = document.getElementById('historyTable');
        if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-12 text-center text-gray-400"><i class="fa-solid fa-spinner fa-spin mr-2"></i>กำลังโหลด...</td></tr>';

        Api.query('expenses', params).then(function(data) {
            _expenses = data || [];
            render();
        }).catch(function(err) {
            console.error('Load history error:', err);
            if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-12 text-center text-red-400">โหลดข้อมูลไม่สำเร็จ: ' + (err.message || err) + '</td></tr>';
        });
    }

    function render() {
        var tbody = document.getElementById('historyTable');
        var total = _expenses.reduce(function(s, e) { return s + Number(e.amount); }, 0);
        document.getElementById('totalFiltered').textContent = '฿ ' + UI.fmt(total);

        if (!_expenses.length) {
            tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-12 text-center text-gray-400">ไม่มีรายการ</td></tr>';
            return;
        }
        tbody.innerHTML = _expenses.map(function(e) {
            var cat = e.categories ? e.categories.category_name : '';
            var icon = UI.getIcon(cat);
            var hidden = e.expense_type === 'แฝง';
            return '<tr class="hover:bg-gray-50 transition">'
                + '<td class="px-4 py-3 text-gray-600 whitespace-nowrap">' + UI.formatDate(e.expense_date) + '</td>'
                + '<td class="px-4 py-3"><span class="font-medium">' + (e.expense_note || cat) + '</span></td>'
                + '<td class="px-4 py-3 text-gray-600">' + (e.pets ? e.pets.name : '—') + '</td>'
                + '<td class="px-4 py-3"><span class="inline-flex items-center gap-1"><i class="fa-solid ' + icon.i + ' text-xs ' + icon.cl + '"></i> ' + cat + '</span></td>'
                + '<td class="px-4 py-3"><span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ' + (hidden ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600') + '">' + (hidden ? 'แฝง' : 'ปกติ') + '</span></td>'
                + '<td class="px-4 py-3 text-right font-bold ' + (hidden ? 'text-red-600' : 'text-gray-900') + '">฿ ' + UI.fmt(e.amount) + '</td>'
                + '</tr>';
        }).join('');
    }

    function openModal() { document.getElementById('expenseModal').classList.remove('hidden'); }
    function closeModal() { document.getElementById('expenseModal').classList.add('hidden'); }

    function submit() {
        var catId = document.getElementById('formCategory').value;
        var note = document.getElementById('formNote').value;
        var amount = document.getElementById('formAmount').value;
        var date = document.getElementById('formDate').value;
        var petId = document.getElementById('formPet').value;
        if (!amount || !date || !petId) { alert('กรุณากรอกข้อมูลให้ครบทุกช่อง'); return; }
        var hidden = [4,5,6].indexOf(Number(catId)) >= 0;

        // โปรไฟล์ผู้ใช้ (Auth.getUser()) อาจยังโหลดไม่เสร็จถ้ากดบันทึกเร็วมาก
        // (เพราะ dropdown สัตว์เลี้ยงพร้อมใช้งานได้ก่อนโปรไฟล์จะโหลดเสร็จ) จึงต้อง
        // รอ loadProfile() ซ้ำถ้ายังไม่มี user แทนที่จะพังเงียบๆ ตอนอ่าน user.user_id
        var userPromise = Auth.getUser() ? Promise.resolve(Auth.getUser()) : Auth.loadProfile();

        userPromise.then(function(user) {
            return Api.insert('expenses', {
                amount: Number(amount), expense_date: date,
                expense_type: hidden ? 'แฝง' : 'หลัก',
                pet_id: Number(petId), user_id: user.user_id,
                category_id: Number(catId), expense_note: note || null
            });
        }).then(function() {
            closeModal();
            load();
        }).catch(function(err) {
            console.error('Submit expense error:', err);
            alert('บันทึกรายจ่ายไม่สำเร็จ: ' + (err.message || err));
        });
    }

    return { init: init, load: load, openModal: openModal, closeModal: closeModal, submit: submit };
})();
