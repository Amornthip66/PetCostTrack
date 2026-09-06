/**
 * Expense History Module
 */
var History = (function() {

    var _pets = [], _categories = [], _expenses = [];
    var _petRoleMap = {}, _myUserId = null;
    var _editWindowDays = 30;
    // _editingReceipts: array ของใบเสร็จทั้งหมดที่ผูกกับรายจ่ายที่กำลังแก้ไขอยู่
    // (BR-04 อนุญาตแนบได้มากกว่า 1 ไฟล์/รายการ จึงเก็บเป็น array แทนที่จะเป็น path เดียว)
    var _editingTransactionId = null, _editingReceipts = [];
    // ข้อ 3.5: ใบเสร็จ/สัตว์เลี้ยงที่ถูก "แบ่ง" ร่วมกับรายจ่ายที่กำลังแก้ไขอยู่ (ข้อมูลเสริม)
    var _editingShares = [];
    // BR-04: ไฟล์ใบเสร็จรองรับ .jpg/.jpeg/.png/.pdf ขนาดไม่เกิน 50MB
    // (ตรงกับ chk_receipts_filetype และขนาด storage bucket ในฐานข้อมูล)
    var RECEIPT_FILE_REGEX = /\.(jpe?g|png|pdf)$/i;
    var RECEIPT_MAX_BYTES = 50 * 1024 * 1024;

    // หนี HTML entity ก่อนแทรกข้อความที่ผู้ใช้ควบคุมได้ (เช่น ชื่อสัตว์เลี้ยง) ลงใน
    // innerHTML/attribute โดยตรง — ผู้ใช้ตั้งชื่อสัตว์เลี้ยงเป็นอะไรก็ได้ ถ้าไม่หนีไว้อาจ
    // มีเครื่องหมายคำพูด/แท็กหลุดออกจาก attribute หรือแทรก element แปลกปลอมเข้ามาได้
    function escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

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
        // ข้อ 3.5: expense_pet_shares (20260913000000) เป็นตารางเสริมใหม่ — ถ้าฐานข้อมูล
        // จริงยังไม่ได้รัน migration นี้ ให้ถอยไปดึงแบบไม่มี join นี้แทน (ชั้น fallback
        // แยกต่างหากจากคอลัมน์ recorded_by_role/created_at ด้านบน กันพังซ้อนกัน)
        var fieldsWithShares = fieldsFull + ',expense_pet_shares(share_id,pet_id,share_amount,pets(name))';
        var filterParams = '&order=expense_date.desc&limit=100';

        if (type) filterParams += '&expense_type=eq.' + encodeURIComponent(type);
        if (pet) filterParams += '&pets.pet_id=eq.' + pet;
        if (cat) filterParams += '&categories.category_id=eq.' + cat;

        var tbody = document.getElementById('historyTable');
        if (tbody) tbody.innerHTML = '<tr><td colspan="9" class="px-4 py-12 text-center text-gray-400"><i class="fa-solid fa-spinner fa-spin mr-2"></i>กำลังโหลด...</td></tr>';

        Api.query('expenses', 'select=' + fieldsWithShares + filterParams)
        .catch(function(err) {
            console.warn('expenses query with expense_pet_shares failed, falling back (migration not applied yet?):', err);
            return Api.query('expenses', 'select=' + fieldsFull + filterParams)
            .catch(function(err2) {
                console.warn('expenses query with recorded_by_role/created_at failed, falling back (migration not applied yet?):', err2);
                return Api.query('expenses', 'select=' + commonFields + filterParams);
            });
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
            var receiptCount = e.receipts ? e.receipts.length : 0;
            // ข้อ 3.5: ข้อมูลเสริมแสดงว่ารายจ่ายนี้ถูก "แบ่ง" ให้สัตว์เลี้ยงตัวอื่นด้วย
            // (นอกเหนือจากสัตว์เลี้ยงหลักในคอลัมน์นี้) แค่แสดงผล ไม่กระทบยอดรวมใดๆ
            var shares = e.expense_pet_shares || [];
            var shareNames = shares.map(function(s) {
                var n = s.pets ? s.pets.name : '';
                return n ? n + ' (฿' + UI.fmt(s.share_amount) + ')' : '';
            }).filter(Boolean).join(', ');
            var shareBadge = shares.length
                ? ' <span class="text-xs text-pet" title="แบ่งกับ ' + escapeHtml(shareNames) + '"><i class="fa-solid fa-link"></i> +' + shares.length + '</span>'
                : '';
            var canEdit = canModify(e);
            return '<tr class="hover:bg-gray-50 transition">'
                + '<td class="px-4 py-3 text-gray-600 whitespace-nowrap">' + UI.formatDate(e.expense_date) + '</td>'
                + '<td class="px-4 py-3"><span class="font-medium">' + (e.expense_note || cat) + '</span></td>'
                + '<td class="px-4 py-3 text-gray-600">' + (e.pets ? e.pets.name : '—') + shareBadge + '</td>'
                + '<td class="px-4 py-3">' + UI.recorderBadge(recorderName, e.recorded_by_role) + '</td>'
                + '<td class="px-4 py-3"><span class="inline-flex items-center gap-1"><i class="fa-solid ' + icon.i + ' text-xs ' + icon.cl + '"></i> ' + cat + '</span></td>'
                + '<td class="px-4 py-3"><span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ' + (hidden ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600') + '">' + (hidden ? 'แฝง' : 'ปกติ') + '</span></td>'
                + '<td class="px-4 py-3 text-right font-bold ' + (hidden ? 'text-red-600' : 'text-gray-900') + '">฿ ' + UI.fmt(e.amount) + '</td>'
                + '<td class="px-4 py-3 text-center">'
                    + (receiptCount ? '<button onclick="History.viewReceiptList(' + e.transaction_id + ')" class="text-gray-400 hover:text-pet" title="ดูใบเสร็จ (' + receiptCount + ' ไฟล์)"><i class="fa-solid fa-receipt"></i>' + (receiptCount > 1 ? '<sup class="ml-0.5">' + receiptCount + '</sup>' : '') + '</button>' : '<span class="text-gray-300">—</span>')
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
        _editingReceipts = [];
        _editingShares = [];
        document.getElementById('formNote').value = '';
        document.getElementById('formAmount').value = '';
        document.getElementById('formPet').value = '';
        document.getElementById('formReceipt').value = '';
        document.getElementById('formDate').value = new Date().toISOString().split('T')[0];
        renderCategoryOptions(document.getElementById('formCategory'));
        renderCurrentReceiptsList();
        var shareToggle = document.getElementById('formShareToggle');
        if (shareToggle) shareToggle.checked = false;
        var shareSection = document.getElementById('shareSection');
        if (shareSection) shareSection.classList.add('hidden');
        var primaryShareInput = document.getElementById('formPrimaryShareAmount');
        if (primaryShareInput) primaryShareInput.value = '';
        var title = document.getElementById('expenseModalTitle');
        if (title) title.textContent = 'บันทึกรายจ่ายใหม่';
        updateShareSummary(); // เคลียร์ข้อความสรุป + คืนสถานะปุ่มบันทึกให้กดได้ตามปกติ
    }

    // ข้อ 3.5: แสดง checkbox รายชื่อสัตว์เลี้ยงตัวอื่น (ไม่รวมสัตว์เลี้ยงหลักที่เลือกไว้ใน
    // formPet และไม่รวมสัตว์เลี้ยงที่เก็บเข้าคลังแล้ว) พร้อมช่องกรอกจำนวนเงินที่แบ่งให้
    // แต่ละตัวโดยตรง (ผู้ใช้กำหนดเองได้ ไม่ใช่แค่หารเฉลี่ยอัตโนมัติเหมือนเวอร์ชันก่อนหน้า)
    // — ติ๊ก+เติมจำนวนเงินไว้แล้วถ้ามีข้อมูลแบ่งเดิมอยู่ (ตอนแก้ไขรายจ่ายที่เคยแบ่งไว้)
    function renderSharePetCheckboxes() {
        var wrap = document.getElementById('sharePetCheckboxes');
        if (!wrap) return;
        var primaryPetId = document.getElementById('formPet').value;
        var existingAmounts = {};
        _editingShares.forEach(function(s) { existingAmounts[s.pet_id] = s.share_amount; });
        var candidates = _pets.filter(function(p) {
            return !p.is_archived && String(p.pet_id) !== String(primaryPetId);
        });
        // ถ้าสัตว์เลี้ยงที่เคยถูกแบ่งไว้ถูกเก็บเข้าคลังไปแล้ว ต้องยังโชว์ตัวเลือกนั้นกลับมา
        // ชั่วคราว (เหมือน ensurePetOption() ที่ใช้กับ dropdown สัตว์เลี้ยงหลักตอนแก้ไข
        // รายจ่ายเก่า) ไม่งั้นช่องนี้จะไม่ถูก render เลย ทำให้ saveShares() ลบส่วนแบ่งของ
        // สัตว์เลี้ยงตัวนั้นทิ้งอย่างถาวรโดยไม่ตั้งใจตอนบันทึกครั้งถัดไป (เพราะ saveShares
        // ล้างของเดิมทั้งหมดแล้วเขียนใหม่ตามที่ติ๊กไว้ในฟอร์มเท่านั้น)
        var candidateIds = {};
        candidates.forEach(function(p) { candidateIds[p.pet_id] = true; });
        _editingShares.forEach(function(s) {
            if (candidateIds[s.pet_id] || String(s.pet_id) === String(primaryPetId)) return;
            var archivedPet = _pets.find(function(p) { return String(p.pet_id) === String(s.pet_id); });
            candidates.push({ pet_id: s.pet_id, name: (archivedPet ? archivedPet.name : 'สัตว์เลี้ยง') + ' (คลัง)' });
            candidateIds[s.pet_id] = true;
        });
        if (!candidates.length) {
            wrap.innerHTML = '<p class="text-xs text-gray-400">ไม่มีสัตว์เลี้ยงตัวอื่นให้เลือก</p>';
            updateShareSummary();
            return;
        }
        wrap.innerHTML = candidates.map(function(p) {
            var hasExisting = existingAmounts[p.pet_id] != null;
            var checked = hasExisting ? ' checked' : '';
            var amountVal = hasExisting ? existingAmounts[p.pet_id] : '';
            var disabledCls = hasExisting ? '' : ' bg-gray-100 text-gray-400';
            var disabledAttr = hasExisting ? '' : ' disabled';
            return '<label class="flex items-center gap-2 py-0.5">'
                + '<input type="checkbox" value="' + p.pet_id + '"' + checked + ' onchange="History.onSharePetToggle(this)" class="h-4 w-4 rounded border-gray-300 text-pet focus:ring-pet flex-shrink-0">'
                + '<span class="flex-1 truncate">' + escapeHtml(p.name) + '</span>'
                + '<input type="number" step="0.01" min="0" value="' + amountVal + '" oninput="History.updateShareSummary()" placeholder="0.00"'
                    + ' class="w-24 px-2 py-1 border border-gray-300 rounded text-right text-xs' + disabledCls + '"' + disabledAttr + '>'
                + '</label>';
        }).join('');
        updateShareSummary();
    }

    // เมื่อติ๊ก/เอาติ๊กสัตว์เลี้ยงตัวหนึ่งออก: เปิด/ปิดช่องกรอกจำนวนเงินของแถวนั้น พร้อมเติม
    // ค่าเริ่มต้นแบบหารเฉลี่ยไว้เป็นจุดตั้งต้น (ผู้ใช้แก้ไขเองภายหลังได้อิสระตามข้อกำหนดข้อ 2)
    function onSharePetToggle(checkbox) {
        var row = checkbox.closest('label');
        var amountInput = row ? row.querySelector('input[type=number]') : null;
        if (!amountInput) return;
        if (checkbox.checked) {
            amountInput.disabled = false;
            amountInput.classList.remove('bg-gray-100', 'text-gray-400');
            if (!amountInput.value) {
                var totalAmount = Number(document.getElementById('formAmount').value) || 0;
                var checkedCount = document.querySelectorAll('#sharePetCheckboxes input[type=checkbox]:checked').length;
                amountInput.value = checkedCount > 0 ? (Math.round((totalAmount / (checkedCount + 1)) * 100) / 100) : '';
            }
        } else {
            amountInput.disabled = true;
            amountInput.value = '';
            amountInput.classList.add('bg-gray-100', 'text-gray-400');
        }
        updateShareSummary();
    }

    // อ่านจำนวนเงินของสัตว์เลี้ยงที่ถูกแบ่งทุกตัวที่ติ๊กไว้ในฟอร์มตอนนี้ (ดิบๆ ยังไม่ validate)
    // ใช้ร่วมกันทั้งใน updateShareSummary() (live) และ submit() (ตอนบันทึกจริง)
    function readSharedAmountInputs() {
        return Array.prototype.slice.call(document.querySelectorAll('#sharePetCheckboxes input[type=checkbox]:checked'))
            .map(function(cb) {
                var row = cb.closest('label');
                var amountInput = row ? row.querySelector('input[type=number]') : null;
                return amountInput ? amountInput.value : '';
            });
    }

    // แสดงความสัมพันธ์ระหว่าง Total Net Amount, Primary Pet Amount และ Shared Pet Amount(s)
    // แบบ real-time (functional requirement ข้อ 1-2) กฎ: Total = Primary + Sum(Shared) เสมอ
    // ใช้ ExpenseAllocation (โมดูลกลางที่ history.js และ dashboard.js เรียกร่วมกัน) คำนวณ
    // เพื่อให้กฎการตรวจสอบเหมือนกันทุกที่ (requirement ข้อ 6) — เมื่อยังไม่เปิดโหมดแบ่ง
    // ค่าใช้จ่าย ปุ่มบันทึกใช้งานได้ตามปกติเสมอ (พฤติกรรมเดิมของรายจ่ายที่ไม่แบ่ง ไม่เปลี่ยนแปลง)
    function updateShareSummary() {
        var summary = document.getElementById('shareSummary');
        var saveBtn = document.getElementById('formSaveBtn');
        var toggle = document.getElementById('formShareToggle');
        if (!summary) return;

        if (!toggle || !toggle.checked) {
            summary.innerHTML = '';
            if (saveBtn) saveBtn.disabled = false;
            return;
        }

        var totalAmount = document.getElementById('formAmount').value;
        var primaryAmount = document.getElementById('formPrimaryShareAmount').value;
        var sharedAmounts = readSharedAmountInputs();
        // ช่องว่าง (required แต่ยังไม่กรอก) ต้องกันปุ่มบันทึกไว้เสมอ แม้ผลรวมตัวเลข (ที่นับ
        // ช่องว่างเป็น 0 ใน ExpenseAllocation.compute) จะบังเอิญเท่ากับยอดรวมพอดีก็ตาม —
        // requirement ข้อ 5: ต้องกันไม่ให้ยอดที่ required ว่างเปล่าหลุดผ่านไปได้
        var hasEmpty = primaryAmount === '' || sharedAmounts.some(function(v) { return v === ''; });
        var r = ExpenseAllocation.compute(totalAmount, primaryAmount, sharedAmounts);

        var statusText, statusCls, disableSave;
        if (hasEmpty) {
            statusText = 'กรุณากรอกจำนวนเงินให้ครบทุกช่อง';
            statusCls = 'text-amber-600 font-medium';
            disableSave = true;
        } else if (r.status === 'valid') {
            statusText = 'ถูกต้อง — จัดสรรครบพอดี';
            statusCls = 'text-green-600 font-medium';
            disableSave = false;
        } else if (r.status === 'under') {
            statusText = 'ยังไม่ครบ — คงเหลือ ฿' + r.remaining.toFixed(2);
            statusCls = 'text-amber-600 font-medium';
            disableSave = true;
        } else {
            statusText = 'เกินยอดรวม — เกินไป ฿' + Math.abs(r.remaining).toFixed(2);
            statusCls = 'text-red-600 font-medium';
            disableSave = true;
        }

        summary.innerHTML = 'ยอดรวม ฿' + r.total.toFixed(2)
            + ' — จัดสรรแล้ว ฿' + r.allocated.toFixed(2) + ' (หลัก ฿' + r.primary.toFixed(2) + ' + แบ่ง ฿' + r.sumShared.toFixed(2) + ')'
            + ' — <span class="' + statusCls + '">' + statusText + '</span>';

        // functional requirement ข้อ 3: ปุ่มบันทึกต้องกดไม่ได้จนกว่าจะจัดสรรครบพอดีและ
        // กรอกครบทุกช่อง
        if (saveBtn) saveBtn.disabled = disableSave;
    }

    function onShareToggle() {
        var toggle = document.getElementById('formShareToggle');
        var section = document.getElementById('shareSection');
        var primaryInput = document.getElementById('formPrimaryShareAmount');
        if (!toggle || !section) return;
        if (toggle.checked) {
            // ค่าเริ่มต้นของสัตว์เลี้ยงหลัก = ยอดรวมทั้งหมด (ยังไม่หักส่วนแบ่งใดๆ) ผู้ใช้
            // แก้ไขเองได้อิสระหลังจากนี้ (ไม่ auto-recalculate ทับค่าที่แก้ไขแล้ว)
            if (primaryInput && !primaryInput.value) {
                primaryInput.value = document.getElementById('formAmount').value || '';
            }
            renderSharePetCheckboxes();
            section.classList.remove('hidden');
        } else {
            section.classList.add('hidden');
        }
        updateShareSummary();
    }

    // อ่านรายการสัตว์เลี้ยง+จำนวนเงินที่ผู้ใช้เลือกแบ่งไว้จากฟอร์ม (ยังไม่ผ่าน validation)
    function collectShareSelections() {
        var toggle = document.getElementById('formShareToggle');
        if (!toggle || !toggle.checked) return [];
        var primaryPetId = document.getElementById('formPet').value;
        var checkedBoxes = Array.prototype.slice.call(document.querySelectorAll('#sharePetCheckboxes input[type=checkbox]:checked'));
        return checkedBoxes.map(function(cb) {
            var row = cb.closest('label');
            var amountInput = row ? row.querySelector('input[type=number]') : null;
            return {
                pet_id: Number(cb.value),
                amount: amountInput && amountInput.value !== '' ? Number(amountInput.value) : NaN
            };
        // กันไว้อีกชั้น ไม่ให้สัตว์เลี้ยงหลักถูกเพิ่มเป็น "ตัวที่ถูกแบ่ง" ซ้ำอีกที
        }).filter(function(s) { return String(s.pet_id) !== String(primaryPetId); });
    }

    // แสดงรายการใบเสร็จทั้งหมดที่ผูกกับรายจ่ายที่กำลังแก้ไข (BR-04: อาจมีมากกว่า 1 ไฟล์)
    // แต่ละแถวดูไฟล์นั้นหรือลบเฉพาะไฟล์นั้นได้แยกจากกัน
    function renderCurrentReceiptsList() {
        var wrap = document.getElementById('currentReceiptsList');
        if (!wrap) return;
        if (!_editingReceipts.length) {
            wrap.classList.add('hidden');
            wrap.innerHTML = '';
            return;
        }
        wrap.classList.remove('hidden');
        wrap.innerHTML = _editingReceipts.map(function(r, idx) {
            return '<div class="flex items-center justify-between gap-2 text-sm bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1.5">'
                + '<button type="button" onclick="History.viewReceipt(\'' + r.image_path + '\')" class="text-pet underline text-left flex-1 truncate">'
                    + '<i class="fa-solid fa-receipt mr-1"></i>ใบเสร็จที่ ' + (idx + 1)
                + '</button>'
                + '<button type="button" onclick="History.removeReceipt(' + r.receipt_id + ')" class="text-red-500 hover:text-red-600 flex-shrink-0" title="ลบใบเสร็จนี้"><i class="fa-solid fa-trash"></i></button>'
                + '</div>';
        }).join('');
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
        _editingReceipts = e.receipts ? e.receipts.slice() : [];
        _editingShares = e.expense_pet_shares ? e.expense_pet_shares.slice() : [];

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

        renderCurrentReceiptsList();

        var shareToggle = document.getElementById('formShareToggle');
        var shareSection = document.getElementById('shareSection');
        var primaryShareInput = document.getElementById('formPrimaryShareAmount');
        if (shareToggle) shareToggle.checked = _editingShares.length > 0;
        if (shareSection) shareSection.classList.toggle('hidden', _editingShares.length === 0);
        if (primaryShareInput) {
            // สัตว์เลี้ยงหลักได้ส่วนที่เหลือหลังหักส่วนแบ่งเดิมออกจากยอดรวม (ถ้ามีแบ่งไว้)
            var existingSumShared = _editingShares.reduce(function(s, x) { return s + Number(x.share_amount || 0); }, 0);
            primaryShareInput.value = _editingShares.length ? ExpenseAllocation.round2(e.amount - existingSumShared) : '';
        }
        renderSharePetCheckboxes();
        updateShareSummary();

        document.getElementById('expenseModalTitle').textContent = 'แก้ไขรายจ่าย';
        document.getElementById('expenseModal').classList.remove('hidden');
    }

    // ลบรายจ่าย — receipts row ที่ผูกอยู่ถูกลบตามไปด้วยอัตโนมัติ (ON DELETE CASCADE)
    // ส่วนไฟล์ใน Storage ต้องลบเองต่างหาก (Postgres FK cascade ไม่ครอบคลุมไฟล์ storage)
    // BR-04 อนุญาตแนบได้หลายไฟล์/รายการ จึงต้องวนลบไฟล์ทุกใบที่ผูกกับรายจ่ายนี้ ไม่ใช่แค่ใบแรก
    function remove(transactionId) {
        var e = _expenses.find(function(x) { return x.transaction_id === transactionId; });
        if (!confirm('ต้องการลบรายการนี้หรือไม่? การลบไม่สามารถกู้คืนได้')) return;
        var receipts = (e && e.receipts) || [];

        Api.remove('expenses', 'transaction_id=eq.' + transactionId)
        .then(function() {
            return Promise.all(receipts.map(function(r) {
                return Api.removeFile('receipts', r.image_path).catch(function(err) {
                    console.warn('Could not remove receipt file (non-critical):', err);
                });
            }));
        })
        .then(function() { load(); })
        .catch(function(err) {
            console.error('Remove expense error:', err);
            alert('ไม่สามารถลบรายการได้: ' + (err.message || err));
        });
    }

    // ลบใบเสร็จ "เฉพาะไฟล์เดียว" (ระบุด้วย receipt_id) ของรายจ่ายที่กำลังแก้ไข
    // (ลบทั้งแถวใน DB และไฟล์ใน storage) — ใบเสร็จอื่นๆ ที่แนบอยู่ในรายการเดียวกัน
    // ไม่ถูกกระทบ ใช้ตอนแนบใบเสร็จผิดใบและอยากลบทิ้งโดยไม่ต้องลบใบอื่นไปด้วย
    function removeReceipt(receiptId) {
        if (!confirm('ต้องการลบใบเสร็จนี้หรือไม่? การลบไม่สามารถกู้คืนได้')) return;
        var rec = _editingReceipts.find(function(r) { return r.receipt_id === receiptId; });
        if (!rec) return;
        var path = rec.image_path;

        Api.remove('receipts', 'receipt_id=eq.' + receiptId)
        .then(function() {
            return Api.removeFile('receipts', path).catch(function(err) {
                console.warn('Could not remove receipt file (non-critical):', err);
            });
        })
        .then(function() {
            _editingReceipts = _editingReceipts.filter(function(r) { return r.receipt_id !== receiptId; });
            renderCurrentReceiptsList();
            load();
        })
        .catch(function(err) {
            console.error('Remove receipt error:', err);
            alert('ไม่สามารถลบใบเสร็จได้: ' + (err.message || err));
        });
    }

    // เปิด modal ดูใบเสร็จจากตารางประวัติ — รายจ่ายหนึ่งรายการอาจมีใบเสร็จมากกว่า 1 ไฟล์
    // (BR-04) ถ้ามีไฟล์เดียวเปิดดูตรงๆ เหมือนเดิม ถ้ามีหลายไฟล์แสดงรายการให้เลือกดูทีละใบ
    function viewReceiptList(transactionId) {
        var e = _expenses.find(function(x) { return x.transaction_id === transactionId; });
        var receipts = (e && e.receipts) || [];
        if (!receipts.length) return;
        var listWrap = document.getElementById('receiptListWrap');
        if (receipts.length === 1) {
            if (listWrap) { listWrap.classList.add('hidden'); listWrap.innerHTML = ''; }
            viewReceipt(receipts[0].image_path);
            return;
        }
        if (listWrap) {
            listWrap.classList.remove('hidden');
            listWrap.innerHTML = receipts.map(function(r, idx) {
                return '<button type="button" onclick="History.viewReceipt(\'' + r.image_path + '\')" '
                    + 'class="px-3 py-1 rounded-full text-xs font-medium bg-pet-light text-pet hover:bg-pet hover:text-white transition">'
                    + 'ใบเสร็จ ' + (idx + 1) + '</button>';
            }).join('');
        }
        viewReceipt(receipts[0].image_path);
    }

    function viewReceipt(path) {
        var modal = document.getElementById('receiptModal');
        var img = document.getElementById('receiptImage');
        var pdf = document.getElementById('receiptPdf');
        var msg = document.getElementById('receiptModalMsg');
        if (!modal || !img) return;
        img.classList.add('hidden');
        if (pdf) pdf.classList.add('hidden');
        if (msg) { msg.textContent = 'กำลังโหลด...'; msg.classList.remove('hidden'); }
        modal.classList.remove('hidden');
        var isPdf = /\.pdf$/i.test(path);
        Api.downloadFileAsBlobUrl('receipts', path).then(function(url) {
            if (isPdf && pdf) {
                pdf.src = url;
                pdf.classList.remove('hidden');
            } else {
                img.src = url;
                img.classList.remove('hidden');
            }
            if (msg) msg.classList.add('hidden');
        }).catch(function(err) {
            console.error('View receipt error:', err);
            if (msg) { msg.textContent = 'ไม่สามารถโหลดใบเสร็จได้: ' + (err.message || err); }
        });
    }

    function closeReceiptModal() {
        var modal = document.getElementById('receiptModal');
        var img = document.getElementById('receiptImage');
        var pdf = document.getElementById('receiptPdf');
        var listWrap = document.getElementById('receiptListWrap');
        if (img && img.src && img.src.indexOf('blob:') === 0) URL.revokeObjectURL(img.src);
        if (pdf && pdf.src && pdf.src.indexOf('blob:') === 0) URL.revokeObjectURL(pdf.src);
        if (img) { img.src = ''; img.classList.add('hidden'); }
        if (pdf) { pdf.src = ''; pdf.classList.add('hidden'); }
        if (listWrap) { listWrap.classList.add('hidden'); listWrap.innerHTML = ''; }
        if (modal) modal.classList.add('hidden');
    }

    // ข้อ 3.5: บันทึก "การแบ่งค่าใช้จ่าย" ให้สัตว์เลี้ยงตัวอื่นนอกเหนือจากสัตว์เลี้ยงหลัก
    // ไม่กระทบ expenses.amount/pet_id เดิมเลย (สัตว์เลี้ยงหลักยังคงมี pet_id เดี่ยวเหมือน
    // เดิมทุกประการ) แต่ยอดที่แสดงบน Dashboard ของสัตว์เลี้ยงที่ถูกแบ่งให้ (เมื่อกรองดู
    // เฉพาะตัวนั้น) จะรวมส่วนแบ่งนี้ด้วย ตาม js/dashboard.js: queryExpensesForFilter()
    // จำนวนเงินแต่ละแถวมาจากที่ผู้ใช้กรอกเองในฟอร์ม (ไม่ใช่หารเฉลี่ยอัตโนมัติเหมือนเดิม
    // อีกต่อไป) ผ่านการ validate ในขั้นตอน submit() มาแล้วก่อนถึงจุดนี้
    // กลยุทธ์: ล้างของเดิมทั้งหมดแล้วเขียนใหม่ทุกครั้งที่บันทึก (ง่ายกว่าการ diff ทีละแถว
    // และปลอดภัยเพราะเป็นข้อมูลเสริมที่ไม่มีไฟล์แนบผูกอยู่ต่างจากใบเสร็จ)
    function saveShares(transactionId) {
        var shareSelections = collectShareSelections();

        // ลบของเดิมก่อนเฉพาะกรณีที่เคยมีอยู่จริง (Api.remove() ของโปรเจกต์นี้ throw error
        // ถ้าลบแล้วไม่มีแถวไหนถูกลบเลย ซึ่งเป็นพฤติกรรมปกติของฟังก์ชันกลางที่ใช้ทั่วทั้งแอป
        // จึงต้องเลี่ยงเรียกตอนไม่มีอะไรให้ลบ แทนที่จะไปแก้ Api.remove() ซึ่งกระทบฟีเจอร์อื่น)
        var clearPromise = _editingShares.length
            ? Api.remove('expense_pet_shares', 'transaction_id=eq.' + transactionId).catch(function(err) {
                console.warn('Could not clear old expense_pet_shares (non-critical):', err);
            })
            : Promise.resolve();

        return clearPromise.then(function() {
            if (!shareSelections.length) return;
            return Promise.all(shareSelections.map(function(s) {
                return Api.insert('expense_pet_shares', {
                    transaction_id: transactionId, pet_id: s.pet_id, share_amount: s.amount
                });
            }));
        });
    }

    function submit() {
        var catId = document.getElementById('formCategory').value;
        var note = document.getElementById('formNote').value;
        var amount = document.getElementById('formAmount').value;
        var date = document.getElementById('formDate').value;
        var petId = document.getElementById('formPet').value;
        // BR-04 (อัปเดตตามผลสำรวจ 82.6%): แนบใบเสร็จได้มากกว่า 1 ไฟล์/รายการ — ไฟล์ที่เลือก
        // ในฟอร์มนี้จะถูก "เพิ่มเข้าไปเสริม" จากใบเสร็จเดิมที่แนบไว้แล้ว ไม่ใช่แทนที่ทั้งหมด
        // (ลบใบเสร็จเดิมทีละไฟล์แยกต่างหากผ่านปุ่มลบในรายการ "ใบเสร็จปัจจุบัน")
        var receiptFiles = Array.prototype.slice.call(document.getElementById('formReceipt').files || []);
        if (!amount || !date || !petId || !catId || catId === '__new__') { alert('กรุณากรอกข้อมูลให้ครบทุกช่อง'); return; }
        // BR-04: ไฟล์ใบเสร็จต้องเป็น .jpg/.jpeg/.png/.pdf เท่านั้น (ตรงกับ chk_receipts_filetype
        // ในฐานข้อมูล) และขนาดต้องไม่เกิน 50MB ต่อไฟล์ (ตรงกับ storage bucket limit) เช็คฝั่ง
        // client ก่อนเพื่อแจ้ง error ที่เข้าใจง่ายกว่าปล่อยให้ DB/storage ปฏิเสธ — เช็คให้ครบ
        // ทุกไฟล์ก่อนอัปโหลดไฟล์ไหนเลย กันกรณีอัปโหลดสำเร็จไปครึ่งหนึ่งแล้วมาเจอไฟล์ที่ผิด
        for (var fi = 0; fi < receiptFiles.length; fi++) {
            if (!RECEIPT_FILE_REGEX.test(receiptFiles[fi].name)) {
                alert('ไฟล์ใบเสร็จต้องเป็นไฟล์ .jpg, .jpeg, .png หรือ .pdf เท่านั้น');
                return;
            }
            if (receiptFiles[fi].size > RECEIPT_MAX_BYTES) {
                alert('ไฟล์ใบเสร็จแต่ละไฟล์ต้องมีขนาดไม่เกิน 50MB');
                return;
            }
        }
        // ข้อ 3.5 (requirement ข้อ 3 — Save Protection): ตรวจสอบส่วนแบ่งค่าใช้จ่ายซ้ำอีกครั้ง
        // ตอนบันทึกจริง ไม่พึ่งพา live validation ฝั่ง UI เพียงอย่างเดียว (เผื่อ DOM ถูกแก้ไข
        // ทางอ้อม หรือปุ่มถูกกดผ่าน console) ใช้กฎเดียวกับ ExpenseAllocation ที่ live validation
        // ใช้ (requirement ข้อ 6: ต้องเป็นกฎเดียวกันทุกที่) ค่าที่กรอกไว้ในฟอร์มจะไม่ถูกล้าง
        // ถ้า validation ไม่ผ่าน (แค่ return ออกไปเฉยๆ ผู้ใช้แก้ไขต่อได้ทันที)
        var toggle = document.getElementById('formShareToggle');
        var shareSelections = collectShareSelections();
        if (toggle && toggle.checked) {
            var sharePetIdsSeen = {};
            for (var si = 0; si < shareSelections.length; si++) {
                var s = shareSelections[si];
                var vs = ExpenseAllocation.validateAmount(isNaN(s.amount) ? '' : s.amount);
                if (vs !== 'ok') {
                    alert('กรุณากรอกจำนวนเงินที่แบ่งให้สัตว์เลี้ยงแต่ละตัวให้ถูกต้อง (ต้องเป็นตัวเลขไม่ติดลบ ทศนิยมไม่เกิน 2 ตำแหน่ง)');
                    return;
                }
                if (sharePetIdsSeen[s.pet_id]) {
                    alert('เลือกสัตว์เลี้ยงตัวเดียวกันซ้ำในการแบ่งค่าใช้จ่าย กรุณาตรวจสอบอีกครั้ง');
                    return;
                }
                sharePetIdsSeen[s.pet_id] = true;
            }
            var primaryAmountRaw = document.getElementById('formPrimaryShareAmount').value;
            var vp = ExpenseAllocation.validateAmount(primaryAmountRaw);
            if (vp !== 'ok') {
                alert('กรุณากรอกจำนวนเงินสำหรับสัตว์เลี้ยงหลักให้ถูกต้อง (ต้องเป็นตัวเลขไม่ติดลบ ทศนิยมไม่เกิน 2 ตำแหน่ง)');
                return;
            }
            var allocResult = ExpenseAllocation.compute(amount, primaryAmountRaw, shareSelections.map(function(s) { return s.amount; }));
            if (allocResult.status !== 'valid') {
                alert('ยอดจัดสรรไม่ตรงกับยอดรวมทั้งหมด — ยอดรวม ฿' + allocResult.total.toFixed(2)
                    + ' จัดสรรแล้ว ฿' + allocResult.allocated.toFixed(2)
                    + (allocResult.status === 'under' ? ' (ยังไม่ครบ ฿' + allocResult.remaining.toFixed(2) + ')' : ' (เกิน ฿' + Math.abs(allocResult.remaining).toFixed(2) + ')'));
                return;
            }
        }
        var cat = _categories.find(function(c) { return String(c.category_id) === String(catId); });
        var hidden = cat ? cat.category_type === 'แฝง' : false;
        var isEdit = !!_editingTransactionId;

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
                var receiptUploadFailed = false;
                var receiptPromise = (!receiptFiles.length ? Promise.resolve() : receiptFiles.reduce(function(chain, file, idx) {
                    // อัปโหลดทีละไฟล์ตามลำดับ (ไม่ขนาน) เพื่อให้ path แต่ละไฟล์ไม่ชนกันและ
                    // จัดการ error ได้ตรงไปตรงมา — แต่ละไฟล์ path ไม่ซ้ำกันด้วย timestamp+index
                    // ต่อท้าย (ต่างจากเดิมที่ใช้ petId/transactionId.ext เพราะตอนนี้ 1 รายการ
                    // มีได้หลายไฟล์ ใช้ path เดิมจะเขียนทับกันเอง)
                    return chain.then(function() {
                        var ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
                        var path = petId + '/' + transactionId + '/' + Date.now() + '_' + idx + '.' + ext;
                        return Api.uploadFile('receipts', path, file).then(function() {
                            return Api.insert('receipts', { transaction_id: transactionId, image_path: path, receipt_date: date });
                        });
                    });
                }, Promise.resolve()))
                // รายจ่าย (transactionId นี้) ถูกบันทึกลง DB ไปแล้วก่อนถึงจุดนี้เสมอ (ไม่ว่า
                // isEdit หรือสร้างใหม่) ถ้าไฟล์แนบไฟล์ใดไฟล์หนึ่งอัปโหลดไม่สำเร็จ (เช่น
                // เน็ตหลุดกลางทาง) ต้องไม่ปล่อยให้ error หลุดไปโผล่เป็น "บันทึกรายจ่าย
                // ไม่สำเร็จ" เหมือนไม่มีอะไรถูกบันทึกเลย เพราะถ้าผู้ใช้เข้าใจผิดแล้วกด
                // "บันทึก" ซ้ำ จะกลายเป็นสร้างรายจ่ายซ้ำอีกรายการ (Api.insert ใหม่อีกรอบ)
                .catch(function(err) {
                    console.error('Receipt upload failed (expense already saved, transaction_id=' + transactionId + '):', err);
                    receiptUploadFailed = true;
                });

                // ข้อ 3.5: บันทึกข้อมูล "แบ่งค่าใช้จ่าย" เป็นขั้นตอนเสริม — ห่อด้วย .catch()
                // แยกต่างหาก เพื่อไม่ให้การบันทึกรายจ่ายหลัก/ใบเสร็จ (ซึ่งสำคัญกว่า) ล้มเหลว
                // ไปด้วย ถ้าตาราง expense_pet_shares ยังไม่มี (migration ยังไม่ได้รัน)
                return receiptPromise.then(function() {
                    return saveShares(transactionId).catch(function(err) {
                        console.warn('Save expense_pet_shares failed (non-critical - อาจยังไม่ได้รัน migration 20260913000000):', err);
                    });
                }).then(function() {
                    return receiptUploadFailed;
                });
            });
        }).then(function(receiptUploadFailed) {
            closeModal();
            load();
            if (receiptUploadFailed) {
                alert('บันทึกรายจ่ายสำเร็จแล้ว แต่แนบไฟล์ใบเสร็จบางไฟล์ไม่สำเร็จ กรุณาเปิดแก้ไขรายการนี้แล้วลองแนบใหม่อีกครั้ง');
            }
        }).catch(function(err) {
            console.error('Submit expense error:', err);
            alert('บันทึกรายจ่ายไม่สำเร็จ: ' + (err.message || err));
        });
    }

    return {
        init: init, load: load, openModal: openModal, closeModal: closeModal, submit: submit,
        edit: edit, remove: remove, viewReceipt: viewReceipt, viewReceiptList: viewReceiptList,
        removeReceipt: removeReceipt,
        closeReceiptModal: closeReceiptModal,
        loadCategories: loadCategories, onCategoryChange: onCategoryChange,
        addCategory: addCategory, cancelAddCategory: cancelAddCategory,
        onShareToggle: onShareToggle, onSharePetToggle: onSharePetToggle, updateShareSummary: updateShareSummary
    };
})();
