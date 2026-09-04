/**
 * Budgets Module
 */
var Budgets = (function() {

    var _pets = [], _budgets = [];

    function init() {
        var list = document.getElementById('budgetList');
        return Api.query('pets', 'select=pet_id,name').then(function(pets) {
            _pets = pets || [];
            populateForm();
            populateFilters();
            return load();
        }).catch(function(err) {
            console.error('Load pets error:', err);
            if (list) list.innerHTML = '<div class="text-center py-12 text-red-400">โหลดข้อมูลไม่สำเร็จ: ' + (err.message || err) + '</div>';
        });
    }

    function populateForm() {
        var petSel = document.getElementById('formPet');
        _pets.forEach(function(p) { var o = document.createElement('option'); o.value = p.pet_id; o.textContent = p.name; petSel.appendChild(o); });
        var monthSel = document.getElementById('formMonth');
        var months = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
        months.forEach(function(m, i) { var o = document.createElement('option'); o.value = i + 1; o.textContent = m; monthSel.appendChild(o); });
        var now = new Date();
        monthSel.value = now.getMonth() + 1;
        document.getElementById('formYear').value = now.getFullYear();
    }

    // === ตัวกรอง: เลือกสัตว์เลี้ยง / เดือน / ปี ที่ต้องการดูงบประมาณ ===
    function populateFilters() {
        var petSel = document.getElementById('filterPet');
        if (petSel) {
            petSel.innerHTML = '<option value="">ทุกสัตว์เลี้ยง</option>'
                + _pets.map(function(p) { return '<option value="' + p.pet_id + '">' + p.name + '</option>'; }).join('');
        }

        var monthSel = document.getElementById('filterMonth');
        if (monthSel) {
            var months = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
            monthSel.innerHTML = '<option value="">ทุกเดือน</option>'
                + months.map(function(m, i) { return '<option value="' + (i + 1) + '">' + m + '</option>'; }).join('');
        }

        var yearSel = document.getElementById('filterYear');
        if (yearSel) {
            var thisYear = new Date().getFullYear();
            var years = [];
            for (var y = thisYear + 1; y >= thisYear - 3; y--) { years.push(y); }
            // แสดงเป็น พ.ศ. ให้ตรงกับที่อื่นในแอป แต่ค่าที่ส่งไป query ยังเป็น ค.ศ. ตามที่เก็บในฐานข้อมูล
            yearSel.innerHTML = '<option value="">ทุกปี</option>'
                + years.map(function(y) { return '<option value="' + y + '">' + (y + 543) + '</option>'; }).join('');
        }
    }

    function hasActiveFilters() {
        var petId = (document.getElementById('filterPet') || {}).value || '';
        var month = (document.getElementById('filterMonth') || {}).value || '';
        var year = (document.getElementById('filterYear') || {}).value || '';
        return !!(petId || month || year);
    }

    function clearFilters() {
        var petSel = document.getElementById('filterPet');
        var monthSel = document.getElementById('filterMonth');
        var yearSel = document.getElementById('filterYear');
        if (petSel) petSel.value = '';
        if (monthSel) monthSel.value = '';
        if (yearSel) yearSel.value = '';
        load();
    }

    function load() {
        var list = document.getElementById('budgetList');
        var petId = (document.getElementById('filterPet') || {}).value || '';
        var month = (document.getElementById('filterMonth') || {}).value || '';
        var year = (document.getElementById('filterYear') || {}).value || '';

        // เดิม select เรียก pets(...) ซ้ำ 2 ครั้ง (pets(name) และ pets(pet_id) แยกกัน)
        // ซึ่ง PostgREST ไม่รองรับ join ตารางเดียวกันซ้ำในคำสั่งเดียว ทำให้ query error
        // และเพราะไม่มี .catch() เลย หน้าค้างที่ "กำลังโหลด..." ตลอดไปแบบเงียบๆ
        var params = 'select=budget_id,budget_limit,budget_month,budget_year,pets(pet_id,name)&order=budget_year.desc,budget_month.desc&limit=100';
        if (petId) params += '&pet_id=eq.' + petId;
        if (month) params += '&budget_month=eq.' + month;
        if (year) params += '&budget_year=eq.' + year;

        if (list) list.innerHTML = '<div class="text-center py-12 text-gray-400"><i class="fa-solid fa-spinner fa-spin mr-2"></i>กำลังโหลด...</div>';

        return Api.query('budgets', params)
        .then(function(data) { _budgets = data || []; render(); })
        .catch(function(err) {
            console.error('Load budgets error:', err);
            if (list) list.innerHTML = '<div class="text-center py-12 text-red-400">โหลดข้อมูลไม่สำเร็จ: ' + (err.message || err) + '</div>';
        });
    }

    function render() {
        var list = document.getElementById('budgetList');
        if (!_budgets.length) {
            list.innerHTML = hasActiveFilters()
                ? '<div class="text-center py-12 text-gray-400"><i class="fa-solid fa-filter-circle-xmark text-4xl mb-3 block"></i>ไม่พบงบประมาณตามเงื่อนไขที่เลือก</div>'
                : '<div class="text-center py-12 text-gray-400"><i class="fa-solid fa-coins text-4xl mb-3 block"></i>ยังไม่มีงบประมาณ</div>';
            return;
        }

        // ดึงค่าใช้จ่ายจริงของแต่ละเดือน
        var queries = _budgets.map(function(b) {
            var mm = String(b.budget_month).padStart(2, '0');
            var mmN = String(b.budget_month + 1 > 12 ? 1 : b.budget_month + 1).padStart(2, '0');
            var yN = b.budget_month + 1 > 12 ? b.budget_year + 1 : b.budget_year;
            return Api.query('expenses', 'select=amount&pet_id=eq.' + b.pets.pet_id + '&expense_date=gte.' + b.budget_year + '-' + mm + '-01&expense_date=lt.' + yN + '-' + mmN + '-01');
        });

        Promise.all(queries).then(function(results) {
            list.innerHTML = _budgets.map(function(b, i) {
                var spent = (results[i] || []).reduce(function(s, e) { return s + Number(e.amount); }, 0);
                var limit = Number(b.budget_limit);
                var percent = limit > 0 ? Math.min(Math.round((spent / limit) * 100), 100) : 0;
                var isOver = spent > limit;
                var barColor = isOver ? 'bg-red-500' : percent > 80 ? 'bg-yellow-500' : 'bg-pet-DEFAULT';
                var TH = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];

                return '<div class="bg-white rounded-xl shadow-sm p-5 border border-gray-100 hover:shadow-md transition">'
                    + '<div class="flex items-center justify-between mb-3">'
                    + '<div><h3 class="font-bold text-gray-900">' + (b.pets ? b.pets.name : '—') + '</h3>'
                    + '<p class="text-sm text-gray-500">' + TH[b.budget_month - 1] + ' ' + (b.budget_year + 543) + '</p></div>'
                    + '<div class="text-right"><p class="text-lg font-bold ' + (isOver ? 'text-red-600' : 'text-gray-900') + '">฿ ' + UI.fmt(spent) + ' / ' + UI.fmt(limit) + '</p>'
                    + '<p class="text-xs ' + (isOver ? 'text-red-500' : 'text-gray-500') + '">' + percent + '% ใช้ไปแล้ว' + (isOver ? ' (เกินงบ!)' : '') + '</p></div>'
                    + '</div>'
                    + '<div class="w-full bg-gray-200 rounded-full h-2.5"><div class="' + barColor + ' h-2.5 rounded-full transition-all" style="width:' + percent + '%"></div></div>'
                    + '</div>';
            }).join('');
        }).catch(function(err) {
            console.error('Load budget spending error:', err);
            list.innerHTML = '<div class="text-center py-12 text-red-400">โหลดข้อมูลไม่สำเร็จ: ' + (err.message || err) + '</div>';
        });
    }

    function openModal() { document.getElementById('budgetModal').classList.remove('hidden'); }
    function closeModal() { document.getElementById('budgetModal').classList.add('hidden'); }

    function save() {
        var data = {
            pet_id: Number(document.getElementById('formPet').value),
            budget_limit: Number(document.getElementById('formLimit').value),
            budget_month: Number(document.getElementById('formMonth').value),
            budget_year: Number(document.getElementById('formYear').value)
        };
        if (!data.budget_limit) { alert('กรุณากรอกงบประมาณ'); return; }
        Api.insert('budgets', data).then(function() {
            closeModal();
            load();
        }).catch(function(err) {
            console.error('Save budget error:', err);
            alert('บันทึกงบประมาณไม่สำเร็จ: ' + (err.message || err));
        });
    }

    return { init: init, load: load, clearFilters: clearFilters, openModal: openModal, closeModal: closeModal, save: save };
})();
