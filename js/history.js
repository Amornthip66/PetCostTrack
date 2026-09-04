/**
 * Expense History Module
 */
var History = (function() {

    var _pets = [], _categories = [], _expenses = [];

    function init() {
        Promise.all([
            Api.query('pets', 'select=pet_id,name'),
            queryCategoriesResilient()
        ]).then(function(r) {
            _pets = r[0] || [];
            _categories = r[1] || [];
            populateFilters();
            renderCategoryOptions(document.getElementById('formCategory'));
            load();
        }).catch(function(err) {
            // ถ้า query พังทั้งคู่ (เช่น network error) ต้องไม่ปล่อยให้หน้าค้างที่
            // "กำลังโหลด..." เงียบๆ ตลอดไป ต้องแจ้ง error ให้เห็นชัดเจน
            console.error('History init error:', err);
            var tbody = document.getElementById('historyTable');
            if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-12 text-center text-red-400">โหลดข้อมูลไม่สำเร็จ: ' + (err.message || err) + '</td></tr>';
            var formPet = document.getElementById('formPet');
            if (formPet) formPet.innerHTML = '<option value="">โหลดไม่สำเร็จ</option>';
            var formCat = document.getElementById('formCategory');
            if (formCat) formCat.innerHTML = '<option value="">โหลดไม่สำเร็จ</option>';
        });
    }

    // ดึงหมวดหมู่แบบกันพัง: ถ้าฐานข้อมูลจริงยังไม่ได้รัน migration
    // 20260906000000_custom_categories.sql (ที่เพิ่มคอลัมน์ category_type) query แรก
    // จะ error เพราะคอลัมน์ยังไม่มี — ให้ลองดึงแบบไม่มีคอลัมน์นี้แทน แล้วถือว่าทุกหมวดหมู่
    // เป็น "หลัก" ไปก่อน แทนที่จะปล่อยให้ทั้งหน้าค้างเพราะ query เดียวพัง
    function queryCategoriesResilient() {
        return Api.query('categories', 'select=category_id,category_name,category_type&order=category_name.asc')
        .catch(function(err) {
            console.warn('categories query with category_type failed, falling back (migration not applied yet?):', err);
            return Api.query('categories', 'select=category_id,category_name&order=category_name.asc')
            .then(function(cats) {
                return (cats || []).map(function(c) { c.category_type = c.category_type || 'หลัก'; return c; });
            });
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

    // === Categories Dropdown ในฟอร์มเพิ่มรายจ่าย + รองรับสร้างหมวดหมู่เอง (BR-07) ===
    function loadCategories() {
        return queryCategoriesResilient()
        .then(function(cats) {
            _categories = cats || [];
            renderCategoryOptions(document.getElementById('formCategory'));
            // sync ตัวกรองหมวดหมู่บนหน้าด้วยเผื่อมีหมวดหมู่ใหม่เพิ่มเข้ามา
            var catSel = document.getElementById('filterCategory');
            if (catSel) {
                var current = catSel.value;
                catSel.innerHTML = '<option value="">ทุกหมวดหมู่</option>'
                    + _categories.map(function(c) { return '<option value="' + c.category_id + '">' + c.category_name + '</option>'; }).join('');
                catSel.value = current;
            }
        }).catch(function(err) {
            console.error('Load categories error:', err);
        });
    }

    function renderCategoryOptions(selectEl, selectedId) {
        if (!selectEl) return;
        var main = _categories.filter(function(c) { return c.category_type !== 'แฝง'; });
        var hidden = _categories.filter(function(c) { return c.category_type === 'แฝง'; });
        function opts(list) {
            return list.map(function(c) {
                var sel = selectedId && String(c.category_id) === String(selectedId) ? ' selected' : '';
                return '<option value="' + c.category_id + '"' + sel + '>' + c.category_name + '</option>';
            }).join('');
        }
        selectEl.innerHTML = (main.length ? '<optgroup label="รายจ่ายปกติ">' + opts(main) + '</optgroup>' : '')
            + (hidden.length ? '<optgroup label="ค่าใช้จ่ายแฝง">' + opts(hidden) + '</optgroup>' : '')
            + '<option value="__new__">+ เพิ่มหมวดหมู่ใหม่...</option>';
    }

    function onCategoryChange() {
        var sel = document.getElementById('formCategory');
        var form = document.getElementById('newCategoryForm');
        if (!sel || !form) return;
        if (sel.value === '__new__') {
            form.classList.remove('hidden');
            var nameInput = document.getElementById('newCategoryName');
            if (nameInput) nameInput.focus();
        } else {
            form.classList.add('hidden');
        }
    }

    function cancelAddCategory() {
        var form = document.getElementById('newCategoryForm');
        var nameInput = document.getElementById('newCategoryName');
        var msg = document.getElementById('newCategoryMsg');
        if (form) form.classList.add('hidden');
        if (nameInput) nameInput.value = '';
        if (msg) msg.classList.add('hidden');
        var sel = document.getElementById('formCategory');
        if (sel && sel.value === '__new__' && sel.options.length > 1) sel.selectedIndex = 0;
    }

    function addCategory() {
        var nameInput = document.getElementById('newCategoryName');
        var msg = document.getElementById('newCategoryMsg');
        var typeInput = document.querySelector('input[name="newCategoryType"]:checked');
        var name = nameInput ? nameInput.value.trim() : '';
        var type = typeInput ? typeInput.value : 'หลัก';
        if (msg) msg.classList.add('hidden');
        if (!name) { alert('กรุณากรอกชื่อหมวดหมู่'); return; }

        Api.insert('categories', { category_name: name, category_type: type })
        .then(function(created) {
            var cat = Array.isArray(created) ? created[0] : created;
            return loadCategories().then(function() {
                var sel = document.getElementById('formCategory');
                if (sel && cat) { renderCategoryOptions(sel, cat.category_id); }
                cancelAddCategory();
            });
        })
        .catch(function(err) {
            var text = (err && err.message) || String(err);
            if (text.indexOf('duplicate') >= 0 || text.indexOf('uq_categories_name') >= 0) {
                text = 'มีหมวดหมู่ชื่อนี้อยู่แล้ว กรุณาเลือกจากรายการ หรือใช้ชื่ออื่น';
            }
            if (msg) { msg.textContent = text; msg.classList.remove('hidden'); }
        });
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
        if (!amount || !date || !petId || !catId || catId === '__new__') { alert('กรุณากรอกข้อมูลให้ครบทุกช่อง'); return; }
        var cat = _categories.find(function(c) { return String(c.category_id) === String(catId); });
        var hidden = cat ? cat.category_type === 'แฝง' : false;

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

    return {
        init: init, load: load, openModal: openModal, closeModal: closeModal, submit: submit,
        loadCategories: loadCategories, onCategoryChange: onCategoryChange,
        addCategory: addCategory, cancelAddCategory: cancelAddCategory
    };
})();
