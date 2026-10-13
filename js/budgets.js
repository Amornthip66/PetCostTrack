/**
 * Budgets Module
 */
var Budgets = (function() {

    var _pets = [], _budgets = [];
    // pet_id → 'Owner' | 'Co-caretaker' ของผู้ใช้ปัจจุบัน: ตั้ง/แก้/ลบงบได้เฉพาะ Owner
    // (RLS budgets_insert/update/delete) จึงแสดงปุ่มเฉพาะ Owner การบังคับจริงอยู่ที่ RLS
    var _petRoleMap = {};
    var _editingBudgetId = null;

    function init() {
        var list = document.getElementById('budgetList');
        return Promise.all([queryPetsResilient(), loadPetRoleMap()]).then(function(r) {
            _pets = r[0] || [];
            populateForm();
            populateFilters();
            return load();
        }).catch(function(err) {
            console.error('Load pets error:', err);
            if (list) list.innerHTML = '<div class="text-center py-12 text-red-400">โหลดข้อมูลไม่สำเร็จ: ' + (err.message || err) + '</div>';
        });
    }

    // ดึงสัตว์เลี้ยงแบบกันพัง: เผื่อฐานข้อมูลจริงยังไม่ได้รัน migration
    // 20260908000000_pet_archive.sql (ที่เพิ่มคอลัมน์ is_archived)
    function queryPetsResilient() {
        return Api.query('pets', 'select=pet_id,name,is_archived')
        .catch(function(err) {
            console.warn('pets query with is_archived failed, falling back:', err);
            return Api.query('pets', 'select=pet_id,name').then(function(pets) {
                return (pets || []).map(function(p) { p.is_archived = false; return p; });
            });
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

    // Form dropdown (ตั้งงบใหม่): เฉพาะสัตว์เลี้ยงที่ตัวเองเป็น Owner และยังไม่เก็บเข้าคลัง
    function populateForm() {
        var petSel = document.getElementById('formPet');
        _pets.filter(function(p) { return !p.is_archived && isOwnerOf(p.pet_id); }).forEach(function(p) { var o = document.createElement('option'); o.value = p.pet_id; o.textContent = p.name; petSel.appendChild(o); });
        var monthSel = document.getElementById('formMonth');
        var months = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
        months.forEach(function(m, i) { var o = document.createElement('option'); o.value = i + 1; o.textContent = m; monthSel.appendChild(o); });
        var now = new Date();
        monthSel.value = now.getMonth() + 1;
        document.getElementById('formYear').value = now.getFullYear();
    }

    // === ตัวกรอง: เลือกสัตว์เลี้ยง / เดือน / ปี ที่ต้องการดูงบประมาณ (เห็นสัตว์เลี้ยงทุกตัว
    // รวมที่เก็บเข้าคลังแล้ว เพื่อยังกรองดูงบประมาณเก่าของสัตว์เลี้ยงที่เสียชีวิต/ย้ายไปแล้วได้) ===
    function populateFilters() {
        var petSel = document.getElementById('filterPet');
        if (petSel) {
            petSel.innerHTML = '<option value="">ทุกสัตว์เลี้ยง</option>'
                + _pets.map(function(p) { return '<option value="' + p.pet_id + '">' + p.name + (p.is_archived ? ' (คลัง)' : '') + '</option>'; }).join('');
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
        var params = 'select=budget_id,pet_id,budget_limit,budget_month,budget_year,pets(pet_id,name)&order=budget_year.desc,budget_month.desc&limit=100';
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

        loadSpentByBudget(_budgets).then(function(spentMap) {
            list.innerHTML = _budgets.map(function(b) {
                var spent = Number(spentMap[b.budget_id] || 0);
                var limit = Number(b.budget_limit);
                var percent = limit > 0 ? Math.min(Math.round((spent / limit) * 100), 100) : 0;
                var isOver = spent > limit;
                var barColor = isOver ? 'bg-red-500' : percent > 80 ? 'bg-yellow-500' : 'bg-pet';
                var TH = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
                var petId = (b.pets && b.pets.pet_id) || b.pet_id;
                var actions = isOwnerOf(petId)
                    ? '<div class="flex items-center justify-end gap-3 mt-3 text-sm">'
                        + '<button onclick="Budgets.edit(' + b.budget_id + ')" class="text-gray-400 hover:text-pet" title="แก้ไขงบ"><i class="fa-solid fa-pen mr-1"></i>แก้ไข</button>'
                        + '<button onclick="Budgets.remove(' + b.budget_id + ')" class="text-gray-400 hover:text-red-500" title="ลบงบ"><i class="fa-solid fa-trash mr-1"></i>ลบ</button>'
                        + '</div>'
                    : '';

                return '<div class="bg-white rounded-xl shadow-sm p-5 border border-gray-100 hover:shadow-md transition">'
                    + '<div class="flex items-center justify-between mb-3">'
                    + '<div><h3 class="font-bold text-gray-900">' + (b.pets ? b.pets.name : '—') + '</h3>'
                    + '<p class="text-sm text-gray-500">' + TH[b.budget_month - 1] + ' ' + (b.budget_year + 543) + '</p></div>'
                    + '<div class="text-right"><p class="text-lg font-bold ' + (isOver ? 'text-red-600' : 'text-gray-900') + '">฿ ' + UI.fmt(spent) + ' / ' + UI.fmt(limit) + '</p>'
                    + '<p class="text-xs ' + (isOver ? 'text-red-500' : 'text-gray-500') + '">' + percent + '% ใช้ไปแล้ว' + (isOver ? ' (เกินงบ!)' : '') + '</p></div>'
                    + '</div>'
                    + '<div class="w-full bg-gray-200 rounded-full h-2.5"><div class="' + barColor + ' h-2.5 rounded-full transition-all" style="width:' + percent + '%"></div></div>'
                    + actions
                    + '</div>';
            }).join('');
        }).catch(function(err) {
            console.error('Load budget spending error:', err);
            list.innerHTML = '<div class="text-center py-12 text-red-400">โหลดข้อมูลไม่สำเร็จ: ' + (err.message || err) + '</div>';
        });
    }

    // ยอดใช้จ่ายของแต่ละงบจาก budget_summary_view (security_invoker — เห็นเฉพาะงบที่มีสิทธิ์)
    // ยอด = รายจ่ายที่สัตว์ตัวนี้เป็นตัวหลัก (หักส่วนที่แบ่งให้ตัวอื่น) + ส่วนแบ่งที่ได้รับ
    // จากรายจ่ายของตัวอื่น ตรงกับที่แดชบอร์ดคิดเมื่อกรองสัตว์เลี้ยงตัวเดียว
    // ถ้าเรียก view ไม่ได้ ถอยไปคำนวณจากตาราง expenses แบบเดิม
    function loadSpentByBudget(budgets) {
        var ids = budgets.map(function(b) { return b.budget_id; });
        return Api.query('budget_summary_view', 'select=budget_id,total_spent&budget_id=in.(' + ids.join(',') + ')')
        .then(function(rows) {
            var map = {};
            (rows || []).forEach(function(r) { map[r.budget_id] = Number(r.total_spent) || 0; });
            return map;
        })
        .catch(function(err) {
            console.warn('budget_summary_view query failed, computing from expenses instead:', err);
            return legacySpentByBudget(budgets);
        });
    }

    function legacySpentByBudget(budgets) {
        // ดึงค่าใช้จ่ายจริงของแต่ละเดือน — ถ้ารายจ่ายนั้นถูก "แบ่ง" ให้สัตว์เลี้ยงตัวอื่นด้วย
        // (ตาราง expense_pet_shares) ต้องหักส่วนแบ่งนั้นออกก่อนนับเข้ายอดใช้จ่ายของสัตว์เลี้ยง
        // ตัวนี้ ไม่งั้นยอดใช้จ่ายเทียบงบจะไม่ตรงกับยอดที่แสดงบน Dashboard ของสัตว์เลี้ยงตัวนี้
        // (ซึ่งหักส่วนแบ่งออกไปแล้วตาม js/dashboard.js: queryExpensesForFilter) ทำให้รายจ่าย
        // เดียวกันถูกนับเป็นคนละยอดขึ้นอยู่กับว่าเปิดหน้าไหนดู — ถ้า query พร้อม join ล้มเหลว
        // (เช่น migration 20260913000000 ยังไม่ได้รัน) ให้ถอยไปดึงแบบเดิม (ไม่หักส่วนแบ่ง)
        var queries = budgets.map(function(b) {
            var petId = (b.pets && b.pets.pet_id) || b.pet_id;
            if (!petId) return Promise.resolve([]);
            var mm = String(b.budget_month).padStart(2, '0');
            var mmN = String(b.budget_month + 1 > 12 ? 1 : b.budget_month + 1).padStart(2, '0');
            var yN = b.budget_month + 1 > 12 ? b.budget_year + 1 : b.budget_year;
            var dateFilter = '&expense_date=gte.' + b.budget_year + '-' + mm + '-01&expense_date=lt.' + yN + '-' + mmN + '-01';
            return Api.query('expenses', 'select=amount,expense_pet_shares(share_amount)&pet_id=eq.' + petId + dateFilter)
                .catch(function(err) {
                    console.warn('expenses query with expense_pet_shares failed, falling back (migration not applied yet?):', err);
                    return Api.query('expenses', 'select=amount&pet_id=eq.' + petId + dateFilter);
                });
        });

        return Promise.all(queries).then(function(results) {
            var map = {};
            budgets.forEach(function(b, i) {
                map[b.budget_id] = (results[i] || []).reduce(function(s, e) {
                    var shares = e.expense_pet_shares || [];
                    var sumShared = shares.reduce(function(ss, r) { return ss + Number(r.share_amount || 0); }, 0);
                    return s + (Number(e.amount) - sumShared);
                }, 0);
            });
            return map;
        });
    }

    // เปิดฟอร์มตั้งงบใหม่ (ไม่ส่ง budget) หรือแก้ไขงบเดิม (แก้ได้เฉพาะวงเงิน
    // สัตว์เลี้ยง/เดือน/ปีของงบเดิมล็อกไว้ เพราะเป็นคีย์ UNIQUE ของงบ)
    function openModal(budget) {
        var editing = !!(budget && budget.budget_id);
        _editingBudgetId = editing ? budget.budget_id : null;
        var petSel = document.getElementById('formPet');
        var monthSel = document.getElementById('formMonth');
        var yearInput = document.getElementById('formYear');
        var title = document.getElementById('budgetModalTitle');
        if (title) title.textContent = editing ? 'แก้ไขงบประมาณ' : 'ตั้งงบประมาณรายเดือน';
        if (editing) {
            var petId = (budget.pets && budget.pets.pet_id) || budget.pet_id;
            if (!Array.prototype.some.call(petSel.options, function(o) { return String(o.value) === String(petId); })) {
                var o = document.createElement('option');
                o.value = petId; o.textContent = budget.pets ? budget.pets.name : 'สัตว์เลี้ยง';
                petSel.appendChild(o);
            }
            petSel.value = petId;
            monthSel.value = budget.budget_month;
            yearInput.value = budget.budget_year;
            document.getElementById('formLimit').value = budget.budget_limit;
        } else {
            var now = new Date();
            monthSel.value = now.getMonth() + 1;
            yearInput.value = now.getFullYear();
            document.getElementById('formLimit').value = '';
        }
        petSel.disabled = editing;
        monthSel.disabled = editing;
        yearInput.disabled = editing;
        if (!editing && !petSel.options.length) {
            alert('ตั้งงบได้เฉพาะสัตว์เลี้ยงที่คุณเป็นเจ้าของ (Owner) และยังไม่เก็บเข้าคลัง');
            return;
        }
        document.getElementById('budgetModal').classList.remove('hidden');
    }
    function closeModal() {
        _editingBudgetId = null;
        document.getElementById('budgetModal').classList.add('hidden');
    }

    function edit(budgetId) {
        var b = _budgets.filter(function(x) { return x.budget_id === budgetId; })[0];
        if (b) openModal(b);
    }

    // แปลง error จากฐานข้อมูลเป็นข้อความที่ผู้ใช้เข้าใจ
    function budgetErrorMessage(err) {
        var msg = (err && err.message) || String(err);
        if (/uq_budgets_period|duplicate key/i.test(msg)) return 'สัตว์เลี้ยงตัวนี้มีงบของเดือนนี้อยู่แล้ว กรุณากด "แก้ไข" ที่งบเดิมแทน';
        if (/chk_budgets_limit/i.test(msg)) return 'งบประมาณต้องมากกว่า 0 บาท';
        if (/chk_budgets_month|chk_budgets_year/i.test(msg)) return 'เดือนหรือปีไม่ถูกต้อง';
        if (/row-level security|permission denied/i.test(msg)) return 'ตั้งหรือแก้ไขงบได้เฉพาะเจ้าของสัตว์เลี้ยง (Owner)';
        return msg;
    }

    function save() {
        var limit = Number(document.getElementById('formLimit').value);
        if (!document.getElementById('formLimit').value || isNaN(limit) || limit <= 0) {
            alert('กรุณากรอกงบประมาณเป็นตัวเลขที่มากกว่า 0');
            return;
        }
        var request;
        if (_editingBudgetId) {
            request = Api.update('budgets', 'budget_id=eq.' + _editingBudgetId, { budget_limit: limit })
            .then(function(rows) {
                if (Array.isArray(rows) && rows.length === 0) throw new Error('row-level security');
                return rows;
            });
        } else {
            var data = {
                pet_id: Number(document.getElementById('formPet').value),
                budget_limit: limit,
                budget_month: Number(document.getElementById('formMonth').value),
                budget_year: Number(document.getElementById('formYear').value)
            };
            if (!data.pet_id) { alert('กรุณาเลือกสัตว์เลี้ยง'); return; }
            request = Api.insert('budgets', data);
        }
        request.then(function() {
            closeModal();
            load();
        }).catch(function(err) {
            console.error('Save budget error:', err);
            alert('บันทึกงบประมาณไม่สำเร็จ: ' + budgetErrorMessage(err));
        });
    }

    function remove(budgetId) {
        if (!confirm('ต้องการลบงบประมาณนี้หรือไม่? (รายจ่ายจะไม่ถูกลบ)')) return;
        Api.remove('budgets', 'budget_id=eq.' + budgetId)
        .then(function() { load(); })
        .catch(function(err) { alert('ลบงบประมาณไม่สำเร็จ: ' + budgetErrorMessage(err)); });
    }

    return { init: init, load: load, clearFilters: clearFilters, openModal: openModal, closeModal: closeModal, save: save, edit: edit, remove: remove };
})();
