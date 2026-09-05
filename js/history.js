/**
 * Expense History Module
 */
var History = (function() {

    var _pets = [], _categories = [], _expenses = [];
    var _petRoleMap = {}, _myUserId = null;
    var _editWindowDays = 30;
    var _editingTransactionId = null, _editingReceiptPath = null;

    function init() {
        Promise.all([
            queryPetsResilient(),
            queryCategoriesResilient(),
            loadEditWindowDays(),
            loadPetAccessMap()
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
            if (tbody) tbody.innerHTML = '<tr><td colspan="9" class="px-4 py-12 text-center text-red-400">โหลดข้อมูลไม่สำเร็จ: ' + (err.message || err) + '</td></tr>';
            var formPet = document.getElementById('formPet');
            if (formPet) formPet.innerHTML = '<option value="">โหลดไม่สำเร็จ</option>';
            var formCat = document.getElementById('formCategory');
            if (formCat) formCat.innerHTML = '<option value="">โหลดไม่สำเร็จ</option>';
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

    // จำนวนวันที่แก้ไข/ลบรายจ่ายได้หลังบันทึก อ่านจาก DB ทุกครั้ง (migration
    // 20260913000000) เพื่อให้ตรงกับค่าที่ RLS ใช้จริงเสมอ ไม่ใช่เลขคงที่ฝัง JS
    // ที่อาจไม่ตรงกับฝั่งเซิร์ฟเวอร์ ถ้า RPC ยังไม่มี (migration ไม่ได้รัน) ใช้ 30 เป็นค่าเริ่มต้น
    function loadEditWindowDays() {
        return Api.rpc('expense_edit_window_days', {}).then(function(days) {
            if (typeof days === 'number' && days > 0) _editWindowDays = days;
        }).catch(function(err) {
            console.warn('expense_edit_window_days RPC failed (migration not applied yet?), using default 30:', err);
        });
    }

    // สิทธิ์ของผู้ใช้ปัจจุบันต่อสัตว์เลี้ยงแต่ละตัว ใช้ตัดสินใจฝั่ง UI ว่าจะโชว์ปุ่ม
    // แก้ไข/ลบไหม (การบังคับจริงยังอยู่ที่ RLS เสมอ อันนี้แค่ซ่อนปุ่มให้ UX ดีขึ้น)
    function loadPetAccessMap() {
        var userPromise = Auth.getUser() ? Promise.resolve(Auth.getUser()) : Auth.loadProfile();
        return userPromise.then(function(user) {
            _myUserId = user && user.user_id || null;
            if (!_myUserId) return;
            return Api.query('pet_access', 'select=pet_id,access_role&user_id=eq.' + _myUserId)
            .then(function(rows) {
                _petRoleMap = {};
                (rows || []).forEach(function(r) { _petRoleMap[r.pet_id] = r.access_role; });
            });
        }).catch(function(err) {
            console.warn('Load pet_access map failed:', err);
        });
    }

    function isOwnerOfPet(petId) {
        return _petRoleMap[petId] === 'Owner';
    }

    // เงื่อนไขเดียวกับ RLS (expenses_update/expenses_delete): Owner ของสัตว์เลี้ยงตัวนั้น
    // หรือเจ้าของรายการเอง และต้องยังอยู่ในช่วงเวลาที่แก้ไข/ลบได้เท่านั้น
    function canModify(e) {
        if (!_myUserId) return false;
        var petId = e.pet_id != null ? e.pet_id : (e.pets ? e.pets.pet_id : null);
        var isOwn = e.user_id != null && String(e.user_id) === String(_myUserId);
        if (!isOwnerOfPet(petId) && !isOwn) return false;
        if (!e.created_at) return true; // คอลัมน์ยังไม่มี (migration ไม่ได้รัน) ปล่อยผ่าน ให้ DB เช็คเองอีกชั้น
        var createdMs = new Date(e.created_at).getTime();
        if (isNaN(createdMs)) return true;
        return (Date.now() - createdMs) <= (_editWindowDays * 86400000);
    }

    function populateFilters() {
        // ตัวกรองบนหน้า: เห็นสัตว์เลี้ยงทุกตัวรวมที่เก็บเข้าคลังแล้ว เพื่อยังกรองดูประวัติ
        // ค่าใช้จ่ายเก่าของสัตว์เลี้ยงที่เสียชีวิต/ย้ายไปแล้วได้
        var petSel = document.getElementById('filterPet');
        _pets.forEach(function(p) {
            var opt = document.createElement('option');
            opt.value = p.pet_id; opt.textContent = p.name + (p.is_archived ? ' (คลัง)' : '');
            petSel.appendChild(opt);
        });
        var catSel = document.getElementById('filterCategory');
        _categories.forEach(function(c) {
            var opt = document.createElement('option');
            opt.value = c.category_id; opt.textContent = c.category_name;
            catSel.appendChild(opt);
        });
        // Form pet dropdown: ไม่รวมสัตว์เลี้ยงที่เก็บเข้าคลังแล้ว (ไม่ควรบันทึกรายจ่ายใหม่ให้)
        // — ตอนแก้ไขรายจ่ายเก่าของสัตว์เลี้ยงที่เก็บเข้าคลังไปแล้ว ensurePetOption() จะเติม
        // ตัวเลือกนั้นกลับเข้ามาชั่วคราวให้เอง
        var formPet = document.getElementById('formPet');
        _pets.filter(function(p) { return !p.is_archived; }).forEach(function(p) {
            var opt = document.createElement('option');
            opt.value = p.pet_id; opt.textContent = p.name;
            formPet.appendChild(opt);
        });
        // Set today's date
        document.getElementById('formDate').value = new Date().toISOString().split('T')[0];
    }

    function ensurePetOption(selectEl, petId, petName) {
        if (!selectEl || petId == null) return;
        var exists = Array.prototype.some.call(selectEl.options, function(o) { return String(o.value) === String(petId); });
        if (!exists) {
            var opt = document.createElement('option');
            opt.value = petId; opt.textContent = (petName || 'สัตว์เลี้ยง') + ' (คลัง)';
            selectEl.appendChild(opt);
        }
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
        // receipts(...) มีมาตั้งแต่ schema แรกเริ่ม ไม่ใช่คอลัมน์ใหม่ ปลอดภัยเสมอไม่ต้อง fallback
        var commonFields = 'transaction_id,pet_id,user_id,amount,expense_date,expense_type,expense_note,'
            + petsJoin + ',users(name),' + catJoin + ',receipts(receipt_id,image_path)';
        // recorded_by_role (20260912) และ created_at (20260913) เป็นคอลัมน์ใหม่ ใช้ระบายสี
        // ป้ายผู้บันทึก และเช็คช่วงเวลาแก้ไข/ลบตามลำดับ — ถ้าฐานข้อมูลจริงยังไม่ได้รัน
        // migration ให้ถอยไปดึงแบบไม่มีสองคอลัมน์นี้แทน กันหน้าพังทั้งหน้า
        var fieldsFull = commonFields + ',recorded_by_role,created_at';
        var filterParams = '&order=expense_date.desc&limit=100';

        if (type) filterParams += '&expense_type=eq.' + encodeURIComponent(type);
        if (pet) filterParams += '&pets.pet_id=eq.' + pet;
        if (cat) filterParams += '&categories.category_id=eq.' + cat;

        var tbody = document.getElementById('historyTable');
        if (tbody) tbody.innerHTML = '<tr><td colspan="9" class="px-4 py-12 text-center text-gray-400"><i class="fa-solid fa-spinner fa-spin mr-2"></i>กำลังโหลด...</td></tr>';

        Api.query('expenses', 'select=' + fieldsFull + filterParams)
        .catch(function(err) {
            console.warn('expenses query with recorded_by_role/created_at failed, falling back (migration not applied yet?):', err);
            return Api.query('expenses', 'select=' + commonFields + filterParams);
        })
        .then(function(data) {
            _expenses = data || [];
            render();
        }).catch(function(err) {
            console.error('Load history error:', err);
            if (tbody) tbody.innerHTML = '<tr><td colspan="9" class="px-4 py-12 text-center text-red-400">โหลดข้อมูลไม่สำเร็จ: ' + (err.message || err) + '</td></tr>';
        });
    }

    function render() {
        var tbody = document.getElementById('historyTable');
        var total = _expenses.reduce(function(s, e) { return s + Number(e.amount); }, 0);
        document.getElementById('totalFiltered').textContent = '฿ ' + UI.fmt(total);

        if (!_expenses.length) {
            tbody.innerHTML = '<tr><td colspan="9" class="px-4 py-12 text-center text-gray-400">ไม่มีรายการ</td></tr>';
            return;
        }
        tbody.innerHTML = _expenses.map(function(e) {
            var cat = e.categories ? e.categories.category_name : '';
            var icon = UI.getIcon(cat);
            var hidden = e.expense_type === 'แฝง';
            var recorderName = e.users ? e.users.name : '';
            var receipt = e.receipts && e.receipts.length ? e.receipts[0] : null;
            var canEdit = canModify(e);
            return '<tr class="hover:bg-gray-50 transition">'
                + '<td class="px-4 py-3 text-gray-600 whitespace-nowrap">' + UI.formatDate(e.expense_date) + '</td>'
                + '<td class="px-4 py-3"><span class="font-medium">' + (e.expense_note || cat) + '</span></td>'
                + '<td class="px-4 py-3 text-gray-600">' + (e.pets ? e.pets.name : '—') + '</td>'
                + '<td class="px-4 py-3">' + UI.recorderBadge(recorderName, e.recorded_by_role) + '</td>'
                + '<td class="px-4 py-3"><span class="inline-flex items-center gap-1"><i class="fa-solid ' + icon.i + ' text-xs ' + icon.cl + '"></i> ' + cat + '</span></td>'
                + '<td class="px-4 py-3"><span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ' + (hidden ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600') + '">' + (hidden ? 'แฝง' : 'ปกติ') + '</span></td>'
                + '<td class="px-4 py-3 text-right font-bold ' + (hidden ? 'text-red-600' : 'text-gray-900') + '">฿ ' + UI.fmt(e.amount) + '</td>'
                + '<td class="px-4 py-3 text-center">'
                    + (receipt ? '<button onclick="History.viewReceipt(\'' + receipt.image_path + '\')" class="text-gray-400 hover:text-pet" title="ดูใบเสร็จ"><i class="fa-solid fa-receipt"></i></button>' : '<span class="text-gray-300">—</span>')
                + '</td>'
                + '<td class="px-4 py-3 text-right whitespace-nowrap">'
                    + (canEdit
                        ? '<button onclick="History.edit(' + e.transaction_id + ')" class="text-gray-400 hover:text-pet mr-2" title="แก้ไข"><i class="fa-solid fa-pen"></i></button>'
                        + '<button onclick="History.remove(' + e.transaction_id + ')" class="text-gray-400 hover:text-red-500" title="ลบ"><i class="fa-solid fa-trash"></i></button>'
                        : '<span class="text-gray-300 text-xs">หมดเวลาแก้ไข</span>')
                + '</td>'
                + '</tr>';
        }).join('');
    }

    function resetModalFields() {
        _editingTransactionId = null;
        _editingReceiptPath = null;
        document.getElementById('formNote').value = '';
        document.getElementById('formAmount').value = '';
        document.getElementById('formPet').value = '';
        document.getElementById('formReceipt').value = '';
        document.getElementById('formDate').value = new Date().toISOString().split('T')[0];
        renderCategoryOptions(document.getElementById('formCategory'));
        var wrap = document.getElementById('currentReceiptWrap');
        if (wrap) wrap.classList.add('hidden');
        var title = document.getElementById('expenseModalTitle');
        if (title) title.textContent = 'บันทึกรายจ่ายใหม่';
    }

    function openModal() {
        resetModalFields();
        document.getElementById('expenseModal').classList.remove('hidden');
    }

    function closeModal() { document.getElementById('expenseModal').classList.add('hidden'); }

    // แก้ไขรายจ่ายเดิม — ต้องอยู่ในช่วงเวลาที่กำหนด (ดู canModify()) ปุ่มแก้ไขจะไม่โชว์
    // ให้กดอยู่แล้วถ้าเกินกำหนด แต่เช็คซ้ำตรงนี้อีกชั้นกันเรียกฟังก์ชันตรงๆ ผ่าน console
    function edit(transactionId) {
        var e = _expenses.find(function(x) { return x.transaction_id === transactionId; });
        if (!e || !canModify(e)) {
            alert('ไม่สามารถแก้ไขรายการนี้ได้ (เกินระยะเวลาที่แก้ไขได้ หรือไม่มีสิทธิ์)');
            return;
        }

        _editingTransactionId = transactionId;
        var receipt = e.receipts && e.receipts.length ? e.receipts[0] : null;
        _editingReceiptPath = receipt ? receipt.image_path : null;

        document.getElementById('formNote').value = e.expense_note || '';
        document.getElementById('formAmount').value = e.amount;
        document.getElementById('formDate').value = e.expense_date;
        document.getElementById('formReceipt').value = '';

        var petId = e.pet_id != null ? e.pet_id : (e.pets ? e.pets.pet_id : null);
        var petSel = document.getElementById('formPet');
        ensurePetOption(petSel, petId, e.pets ? e.pets.name : '');
        petSel.value = petId;

        var catId = e.categories ? e.categories.category_id : '';
        renderCategoryOptions(document.getElementById('formCategory'), catId);

        var wrap = document.getElementById('currentReceiptWrap');
        if (wrap) wrap.classList.toggle('hidden', !_editingReceiptPath);

        document.getElementById('expenseModalTitle').textContent = 'แก้ไขรายจ่าย';
        document.getElementById('expenseModal').classList.remove('hidden');
    }

    // ลบรายจ่าย — receipts row ที่ผูกอยู่ถูกลบตามไปด้วยอัตโนมัติ (ON DELETE CASCADE)
    // ส่วนไฟล์ใน Storage ต้องลบเองต่างหาก (Postgres FK cascade ไม่ครอบคลุมไฟล์ storage)
    function remove(transactionId) {
        var e = _expenses.find(function(x) { return x.transaction_id === transactionId; });
        if (!confirm('ต้องการลบรายการนี้หรือไม่? การลบไม่สามารถกู้คืนได้')) return;
        var receipt = e && e.receipts && e.receipts.length ? e.receipts[0] : null;

        Api.remove('expenses', 'transaction_id=eq.' + transactionId)
        .then(function() {
            if (receipt && receipt.image_path) {
                return Api.removeFile('receipts', receipt.image_path).catch(function(err) {
                    console.warn('Could not remove receipt file (non-critical):', err);
                });
            }
        })
        .then(function() { load(); })
        .catch(function(err) {
            console.error('Remove expense error:', err);
            alert('ไม่สามารถลบรายการได้: ' + (err.message || err));
        });
    }

    function viewCurrentReceipt() {
        if (_editingReceiptPath) viewReceipt(_editingReceiptPath);
    }

    function viewReceipt(path) {
        var modal = document.getElementById('receiptModal');
        var img = document.getElementById('receiptImage');
        var msg = document.getElementById('receiptModalMsg');
        if (!modal || !img) return;
        img.classList.add('hidden');
        if (msg) { msg.textContent = 'กำลังโหลด...'; msg.classList.remove('hidden'); }
        modal.classList.remove('hidden');
        Api.downloadFileAsBlobUrl('receipts', path).then(function(url) {
            img.src = url;
            img.classList.remove('hidden');
            if (msg) msg.classList.add('hidden');
        }).catch(function(err) {
            console.error('View receipt error:', err);
            if (msg) { msg.textContent = 'ไม่สามารถโหลดรูปใบเสร็จได้: ' + (err.message || err); }
        });
    }

    function closeReceiptModal() {
        var modal = document.getElementById('receiptModal');
        var img = document.getElementById('receiptImage');
        if (img && img.src && img.src.indexOf('blob:') === 0) URL.revokeObjectURL(img.src);
        if (img) { img.src = ''; img.classList.add('hidden'); }
        if (modal) modal.classList.add('hidden');
    }

    function submit() {
        var catId = document.getElementById('formCategory').value;
        var note = document.getElementById('formNote').value;
        var amount = document.getElementById('formAmount').value;
        var date = document.getElementById('formDate').value;
        var petId = document.getElementById('formPet').value;
        var receiptFile = document.getElementById('formReceipt').files[0] || null;
        if (!amount || !date || !petId || !catId || catId === '__new__') { alert('กรุณากรอกข้อมูลให้ครบทุกช่อง'); return; }
        // BR-04: ไฟล์ใบเสร็จต้องเป็น .jpg/.jpeg/.png เท่านั้น (ตรงกับ chk_receipts_filetype
        // ในฐานข้อมูล) เช็คฝั่ง client ก่อนเพื่อแจ้ง error ที่เข้าใจง่ายกว่าปล่อยให้ DB ปฏิเสธ
        if (receiptFile && !/\.(jpe?g|png)$/i.test(receiptFile.name)) {
            alert('ไฟล์ใบเสร็จต้องเป็นไฟล์ .jpg, .jpeg หรือ .png เท่านั้น');
            return;
        }
        var cat = _categories.find(function(c) { return String(c.category_id) === String(catId); });
        var hidden = cat ? cat.category_type === 'แฝง' : false;
        var isEdit = !!_editingTransactionId;
        var previousReceiptPath = _editingReceiptPath;

        // โปรไฟล์ผู้ใช้ (Auth.getUser()) อาจยังโหลดไม่เสร็จถ้ากดบันทึกเร็วมาก
        // (เพราะ dropdown สัตว์เลี้ยงพร้อมใช้งานได้ก่อนโปรไฟล์จะโหลดเสร็จ) จึงต้อง
        // รอ loadProfile() ซ้ำถ้ายังไม่มี user แทนที่จะพังเงียบๆ ตอนอ่าน user.user_id
        var userPromise = Auth.getUser() ? Promise.resolve(Auth.getUser()) : Auth.loadProfile();

        userPromise.then(function(user) {
            var expenseData = {
                amount: Number(amount), expense_date: date,
                expense_type: hidden ? 'แฝง' : 'หลัก',
                pet_id: Number(petId), category_id: Number(catId), expense_note: note || null
            };

            var savePromise;
            if (isEdit) {
                savePromise = Api.update('expenses', 'transaction_id=eq.' + _editingTransactionId, expenseData)
                    .then(function() { return _editingTransactionId; });
            } else {
                expenseData.user_id = user.user_id;
                savePromise = Api.insert('expenses', expenseData).then(function(created) {
                    var row = Array.isArray(created) ? created[0] : created;
                    return row.transaction_id;
                });
            }

            return savePromise.then(function(transactionId) {
                if (!receiptFile) return;
                var ext = (receiptFile.name.split('.').pop() || 'jpg').toLowerCase();
                var path = petId + '/' + transactionId + '.' + ext;
                return Api.uploadFile('receipts', path, receiptFile).then(function() {
                    var receiptData = { transaction_id: transactionId, image_path: path, receipt_date: date };
                    var savedReceiptPromise = previousReceiptPath
                        ? Api.update('receipts', 'transaction_id=eq.' + transactionId, receiptData)
                        : Api.insert('receipts', receiptData);
                    return savedReceiptPromise.then(function() {
                        // นามสกุลไฟล์เปลี่ยน (เช่น .png -> .jpg) ทำให้ path ใหม่ไม่ใช่อันเดิม
                        // ลบไฟล์เก่าทิ้งแบบ best-effort กันขยะค้างใน storage
                        if (previousReceiptPath && previousReceiptPath !== path) {
                            return Api.removeFile('receipts', previousReceiptPath).catch(function() {});
                        }
                    });
                });
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
        edit: edit, remove: remove, viewReceipt: viewReceipt, viewCurrentReceipt: viewCurrentReceipt,
        closeReceiptModal: closeReceiptModal,
        loadCategories: loadCategories, onCategoryChange: onCategoryChange,
        addCategory: addCategory, cancelAddCategory: cancelAddCategory
    };
})();
