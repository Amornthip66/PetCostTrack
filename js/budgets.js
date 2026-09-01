/**
 * Budgets Module
 */
var Budgets = (function() {

    var _pets = [], _budgets = [];

    function init() {
        Api.query('pets', 'select=pet_id,name').then(function(pets) {
            _pets = pets || [];
            populateForm();
            load();
        });
    }

    function populateForm() {
        var petSel = document.getElementById('formPet');
        if (petSel) {
            petSel.innerHTML = '';
            if (!_pets.length) {
                petSel.innerHTML = '<option value="">ไม่พบสัตว์เลี้ยง (กรุณาเพิ่มสัตว์เลี้ยงก่อน)</option>';
            } else {
                _pets.forEach(function(p) {
                    var o = document.createElement('option');
                    o.value = p.pet_id;
                    o.textContent = p.name;
                    petSel.appendChild(o);
                });
            }
        }
        var monthSel = document.getElementById('formMonth');
        if (monthSel) {
            monthSel.innerHTML = '';
            var months = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
            months.forEach(function(m, i) {
                var o = document.createElement('option');
                o.value = i + 1;
                o.textContent = m;
                monthSel.appendChild(o);
            });
            var now = new Date();
            monthSel.value = now.getMonth() + 1;
        }
        var yearInput = document.getElementById('formYear');
        if (yearInput) {
            yearInput.value = new Date().getFullYear();
        }
    }

    function load() {
        var list = document.getElementById('budgetList');
        if (list) {
            list.innerHTML = '<div class="text-center py-12 text-gray-400"><i class="fa-solid fa-spinner fa-spin mr-2"></i>กำลังโหลด...</div>';
        }
        Api.query('budgets', 'select=budget_id,budget_limit,budget_month,budget_year,pet_id,pets(pet_id,name)&order=budget_year.desc,budget_month.desc&limit=50')
        .then(function(data) {
            _budgets = data || [];
            render();
        }).catch(function(err) {
            console.error('Error loading budgets:', err);
            if (list) {
                list.innerHTML = '<div class="text-center py-12 text-red-500"><i class="fa-solid fa-triangle-exclamation mr-2"></i>เกิดข้อผิดพลาดในการโหลดงบประมาณ (' + err.message + ')</div>';
            }
        });
    }

    function render() {
        var list = document.getElementById('budgetList');
        if (!list) return;
        if (!_budgets.length) {
            list.innerHTML = '<div class="text-center py-12 text-gray-400"><i class="fa-solid fa-coins text-4xl mb-3 block"></i>ยังไม่มีงบประมาณ</div>';
            return;
        }

        // ดึงค่าใช้จ่ายจริงของแต่ละเดือน
        var queries = _budgets.map(function(b) {
            var targetPetId = (b.pets && b.pets.pet_id) ? b.pets.pet_id : b.pet_id;
            var mm = String(b.budget_month).padStart(2, '0');
            var nextMonth = b.budget_month + 1 > 12 ? 1 : b.budget_month + 1;
            var mmN = String(nextMonth).padStart(2, '0');
            var yN = b.budget_month + 1 > 12 ? b.budget_year + 1 : b.budget_year;
            return Api.query('expenses', 'select=amount&pet_id=eq.' + targetPetId + '&expense_date=gte.' + b.budget_year + '-' + mm + '-01&expense_date=lt.' + yN + '-' + mmN + '-01')
                .catch(function() { return []; });
        });

        Promise.all(queries).then(function(results) {
            list.innerHTML = _budgets.map(function(b, i) {
                var spent = (results[i] || []).reduce(function(s, e) { return s + Number(e.amount || 0); }, 0);
                var limit = Number(b.budget_limit || 0);
                var percent = limit > 0 ? Math.min(Math.round((spent / limit) * 100), 100) : 0;
                var isOver = spent > limit;
                var barColor = isOver ? 'bg-red-500' : percent > 80 ? 'bg-yellow-500' : 'bg-pet-DEFAULT';
                var TH = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
                var petName = (b.pets && b.pets.name) ? b.pets.name : 'สัตว์เลี้ยง #' + b.pet_id;

                return '<div class="bg-white rounded-xl shadow-sm p-5 border border-gray-100 hover:shadow-md transition">'
                    + '<div class="flex items-center justify-between mb-3">'
                    + '<div><h3 class="font-bold text-gray-900">' + petName + '</h3>'
                    + '<p class="text-sm text-gray-500">' + (TH[b.budget_month - 1] || b.budget_month) + ' ' + (b.budget_year + 543) + '</p></div>'
                    + '<div class="text-right"><p class="text-lg font-bold ' + (isOver ? 'text-red-600' : 'text-gray-900') + '">฿ ' + UI.fmt(spent) + ' / ' + UI.fmt(limit) + '</p>'
                    + '<p class="text-xs ' + (isOver ? 'text-red-500' : 'text-gray-500') + '">' + percent + '% ใช้ไปแล้ว' + (isOver ? ' (เกินงบ!)' : '') + '</p></div>'
                    + '</div>'
                    + '<div class="w-full bg-gray-200 rounded-full h-2.5"><div class="' + barColor + ' h-2.5 rounded-full transition-all" style="width:' + percent + '%"></div></div>'
                    + '</div>';
            }).join('');
        });
    }

    function openModal() { document.getElementById('budgetModal').classList.remove('hidden'); }
    function closeModal() { document.getElementById('budgetModal').classList.add('hidden'); }

    function save() {
        var petIdVal = document.getElementById('formPet').value;
        var limitVal = document.getElementById('formLimit').value;
        var monthVal = document.getElementById('formMonth').value;
        var yearVal = document.getElementById('formYear').value;

        if (!petIdVal) { alert('กรุณาเลือกสัตว์เลี้ยง'); return; }
        if (!limitVal || Number(limitVal) <= 0) { alert('กรุณากรอกงบประมาณที่มากกว่า 0'); return; }

        var data = {
            pet_id: Number(petIdVal),
            budget_limit: Number(limitVal),
            budget_month: Number(monthVal),
            budget_year: Number(yearVal)
        };

        Api.insert('budgets', data)
            .then(function() {
                closeModal();
                load();
            })
            .catch(function(err) {
                alert('บันทึกไม่สำเร็จ: ' + err.message);
            });
    }

    return { init: init, openModal: openModal, closeModal: closeModal, save: save };
})();
