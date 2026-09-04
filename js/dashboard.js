/**
 * Dashboard Module
 * โหลดข้อมูล KPI, รายการค่าใช้จ่าย, กราฟ
 * รองรับการเลือกดูเฉพาะสัตว์เลี้ยงตัวใดตัวหนึ่ง และเลือกเดือน/ปีที่ต้องการดูได้
 */
var Dashboard = (function() {

    var _pets = [];
    var _categories = [];
    var _chartInstance = null;

    // === Helpers ===
    function fmt(n) { return new Intl.NumberFormat('th-TH').format(n); }

    var THAI_MONTHS = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
    var THAI_MONTHS_FULL = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
    function formatDate(s) {
        var d = new Date(s);
        return d.getDate() + ' ' + THAI_MONTHS[d.getMonth()] + ' ' + (d.getFullYear() + 543);
    }

    function getIcon(c) {
        if (!c) return {i:'fa-receipt',bg:'bg-gray-100',cl:'text-gray-500'};
        var n = c.toLowerCase();
        if (n.indexOf('อาหาร')>=0) return {i:'fa-bowl-food',bg:'bg-blue-100',cl:'text-blue-500'};
        if (n.indexOf('วัคซีน')>=0||n.indexOf('ตรวจ')>=0) return {i:'fa-syringe',bg:'bg-green-100',cl:'text-green-500'};
        if (n.indexOf('รักษา')>=0||n.indexOf('ฉุกเฉิน')>=0) return {i:'fa-stethoscope',bg:'bg-red-100',cl:'text-pet-hidden'};
        if (n.indexOf('เสียหาย')>=0||n.indexOf('พัง')>=0) return {i:'fa-couch',bg:'bg-orange-100',cl:'text-orange-500'};
        if (n.indexOf('ฝากเลี้ยง')>=0) return {i:'fa-house-user',bg:'bg-purple-100',cl:'text-purple-500'};
        if (n.indexOf('ถ่ายพยาธิ')>=0) return {i:'fa-pills',bg:'bg-teal-100',cl:'text-teal-500'};
        return {i:'fa-receipt',bg:'bg-gray-100',cl:'text-gray-500'};
    }

    // === Filter state (อ่านจาก dropdown/input บนหน้าเว็บ) ===
    function getFilters() {
        var petSel = document.getElementById('filterPet');
        var monthInput = document.getElementById('filterMonth');
        var petId = petSel ? petSel.value : '';
        var now = new Date();
        var year = now.getFullYear(), month = now.getMonth() + 1;

        if (monthInput && monthInput.value) {
            var parts = monthInput.value.split('-'); // 'YYYY-MM'
            if (parts.length === 2 && Number(parts[0]) && Number(parts[1])) {
                year = Number(parts[0]);
                month = Number(parts[1]);
            }
        }
        return { petId: petId, year: year, month: month };
    }

    function monthRange(year, month) {
        var mm = String(month).padStart(2, '0');
        var mmN = String(month + 1 > 12 ? 1 : month + 1).padStart(2, '0');
        var yN = month + 1 > 12 ? year + 1 : year;
        return { start: year + '-' + mm + '-01', end: yN + '-' + mmN + '-01' };
    }

    function updatePeriodLabel(year, month) {
        var el = document.getElementById('currentPeriodLabel');
        if (el) el.textContent = THAI_MONTHS_FULL[month - 1] + ' ' + (year + 543);
    }

    // === ตัวกรองเปรียบเทียบ (เดือน/ปีที่ผ่านมาที่ต้องการเทียบกับช่วงที่เลือกอยู่) ===
    function isCompareActive() {
        var toggle = document.getElementById('compareToggle');
        return !!(toggle && toggle.checked);
    }

    // คืนค่า {year, month} ของช่วงที่จะเปรียบเทียบด้วย หรือ null ถ้ายังไม่ได้เปิด/ยังไม่ได้เลือก
    function getCompareFilters() {
        if (!isCompareActive()) return null;
        var input = document.getElementById('filterCompareMonth');
        if (!input || !input.value) return null;
        var parts = input.value.split('-'); // 'YYYY-MM'
        if (parts.length !== 2 || !Number(parts[0]) || !Number(parts[1])) return null;
        return { year: Number(parts[0]), month: Number(parts[1]) };
    }

    // === KPI Cards ===
    function loadKPIs() {
        var f = getFilters();
        var range = monthRange(f.year, f.month);
        var petFilter = f.petId ? '&pet_id=eq.' + f.petId : '';
        updatePeriodLabel(f.year, f.month);

        return Promise.all([
            Api.query('budgets', 'select=budget_limit&budget_month=eq.' + f.month + '&budget_year=eq.' + f.year + petFilter),
            Api.query('expenses', 'select=amount,expense_type&expense_date=gte.' + range.start + '&expense_date=lt.' + range.end + petFilter),
            Api.count('pets')
        ]).then(function(r) {
            var budgets = r[0] || [], expenses = r[1] || [], petCount = r[2] || 0;
            var totalBudget = budgets.reduce(function(s,b){return s+Number(b.budget_limit);},0);
            var totalSpent = expenses.reduce(function(s,e){return s+Number(e.amount);},0);
            var hiddenCost = expenses.filter(function(e){return e.expense_type==='แฝง';}).reduce(function(s,e){return s+Number(e.amount);},0);
            var percent = totalBudget>0 ? Math.round((totalSpent/totalBudget)*100) : 0;

            document.getElementById('totalSpent').textContent = fmt(totalSpent);
            document.getElementById('hiddenCost').textContent = fmt(hiddenCost);
            document.getElementById('budgetPercent').textContent = percent;
            document.getElementById('budgetTotal').textContent = fmt(totalBudget);
            document.getElementById('petCount').textContent = petCount;
            document.getElementById('budgetBar').style.width = Math.min(percent, 100) + '%';
        }).catch(function(err) {
            console.error('Load KPIs error:', err);
        });
    }

    // === Expense List ===
    function loadExpenseList() {
        var f = getFilters();
        var range = monthRange(f.year, f.month);
        var petFilter = f.petId ? '&pet_id=eq.' + f.petId : '';
        var list = document.getElementById('expenseList');

        return Api.query('expenses',
            'select=transaction_id,amount,expense_date,expense_type,expense_note,pets(name),users(name),categories(category_name)'
            + '&expense_date=gte.' + range.start + '&expense_date=lt.' + range.end + petFilter
            + '&order=expense_date.desc&limit=20')
        .then(function(data) {
            if (!data || !data.length) {
                list.innerHTML = '<li class="py-8 text-center text-gray-400 text-sm">ไม่มีรายการ</li>';
                return;
            }
            list.innerHTML = data.map(function(e) {
                var cat = e.categories && e.categories.category_name || '';
                var icon = getIcon(cat);
                var note = e.expense_note || cat;
                var hidden = e.expense_type === 'แฝง';
                var user = e.users && e.users.name || '—';
                var pet = e.pets && e.pets.name || '';
                return '<li class="py-4 hover:bg-gray-50 transition-colors rounded-lg px-2 -mx-2 flex justify-between items-center cursor-pointer">'
                +'<div class="flex items-center gap-4">'
                +'<div class="flex-shrink-0 w-12 h-12 '+icon.bg+' '+icon.cl+' rounded-full flex items-center justify-center text-xl"><i class="fa-solid '+icon.i+'"></i></div>'
                +'<div><p class="text-sm font-semibold text-gray-900 flex items-center gap-2">'+note
                +(hidden?' <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-pet-hidden">ค่าใช้จ่ายแฝง</span>':' <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">ปกติ</span>')
                +'</p><p class="text-xs text-gray-500">'+formatDate(e.expense_date)+' • '+user+' • '+pet+'</p></div></div>'
                +'<div class="text-right"><p class="text-sm font-bold text-gray-900">฿ '+fmt(e.amount)+'</p></div></li>';
            }).join('');
        }).catch(function(err) {
            console.error('Load expense list error:', err);
            if (list) list.innerHTML = '<li class="py-8 text-center text-red-400 text-sm">โหลดข้อมูลไม่สำเร็จ: ' + (err.message || err) + '</li>';
        });
    }

    // === Chart ===
    function loadChart() {
        var f = getFilters();
        var range = monthRange(f.year, f.month);
        var petFilter = f.petId ? '&pet_id=eq.' + f.petId : '';
        var legend = document.getElementById('chartLegend');

        return Api.query('expenses', 'select=amount,expense_type,categories(category_name)&expense_date=gte.' + range.start + '&expense_date=lt.' + range.end + petFilter)
        .then(function(data) {
            // ทำลายกราฟเดิมก่อนเสมอ ไม่งั้นเวลาเปลี่ยนตัวกรองจะเกิดกราฟซ้อนทับกันหลายอัน (รวน)
            if (_chartInstance) { _chartInstance.destroy(); _chartInstance = null; }

            var ctx = document.getElementById('expenseChart');
            if (!data || !data.length) {
                if (legend) legend.innerHTML = '<p class="text-gray-400 text-sm col-span-2 text-center">ไม่มีข้อมูลค่าใช้จ่ายในช่วงที่เลือก</p>';
                return;
            }

            var g = {};
            data.forEach(function(e){
                var c=e.categories&&e.categories.category_name||'อื่นๆ';
                g[c]=(g[c]||0)+Number(e.amount);
            });
            var labels=Object.keys(g), values=Object.values(g);
            var colors=['#60a5fa','#f87171','#4ade80','#fb923c','#a78bfa','#f472b6','#facc15','#34d399'];

            if (!ctx) return;
            _chartInstance = new Chart(ctx.getContext('2d'),{
                type:'doughnut',
                data:{labels:labels,datasets:[{data:values,backgroundColor:colors.slice(0,labels.length),borderWidth:0,hoverOffset:4}]},
                options:{responsive:true,maintainAspectRatio:false,cutout:'70%',plugins:{legend:{display:false},tooltip:{callbacks:{label:function(c){return c.label+': '+new Intl.NumberFormat('th-TH',{style:'currency',currency:'THB'}).format(c.parsed);}}}}}
            });

            if (legend) {
                legend.innerHTML=labels.map(function(l,i){
                    return '<div class="flex items-center"><span class="w-3 h-3 rounded-full mr-2" style="background:'+colors[i%colors.length]+'"></span> '+l+'</div>';
                }).join('');
            }
        }).catch(function(err) {
            console.error('Load chart error:', err);
            if (legend) legend.innerHTML = '<p class="text-red-400 text-sm col-span-2 text-center">โหลดกราฟไม่สำเร็จ</p>';
        });
    }

    // === Pets Dropdown (ทั้งตัวกรองบนหน้า และ dropdown ในฟอร์มเพิ่มรายจ่าย) ===
    function loadPets() {
        return Api.query('pets', 'select=pet_id,name').then(function(pets) {
            _pets = pets || [];

            var filterSel = document.getElementById('filterPet');
            if (filterSel) {
                filterSel.innerHTML = '<option value="">ทุกสัตว์เลี้ยง</option>'
                    + _pets.map(function(p) { return '<option value="' + p.pet_id + '">' + p.name + '</option>'; }).join('');
            }

            var formSel = document.getElementById('formPet');
            if (formSel) {
                formSel.innerHTML = _pets.length
                    ? _pets.map(function(p) { return '<option value="' + p.pet_id + '">' + p.name + '</option>'; }).join('')
                    : '<option value="">ไม่พบสัตว์เลี้ยง</option>';
            }
        }).catch(function(err) {
            console.error('Load pets error:', err);
        });
    }

    // === Categories Dropdown (ในฟอร์มเพิ่มรายจ่าย + รองรับสร้างหมวดหมู่เอง ตาม BR-07) ===
    // ดึงหมวดหมู่แบบกันพัง: ถ้าฐานข้อมูลจริงยังไม่ได้รัน migration
    // 20260906000000_custom_categories.sql (ที่เพิ่มคอลัมน์ category_type) query แรก
    // จะ error เพราะคอลัมน์ยังไม่มี — ให้ลองดึงแบบไม่มีคอลัมน์นี้แทน แล้วถือว่าทุกหมวดหมู่
    // เป็น "หลัก" ไปก่อน แทนที่จะปล่อยให้ dropdown ค้างที่ "กำลังโหลด..." เพราะ query พัง
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

    function loadCategories() {
        return queryCategoriesResilient()
        .then(function(cats) {
            _categories = cats || [];
            renderCategoryOptions(document.getElementById('formCategory'));
        }).catch(function(err) {
            console.error('Load categories error:', err);
            var sel = document.getElementById('formCategory');
            if (sel) sel.innerHTML = '<option value="">โหลดไม่สำเร็จ</option>';
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

    // เลือก "+ เพิ่มหมวดหมู่ใหม่..." ในดรอปดาวน์ -> เปิดฟอร์มย่อยให้กรอกชื่อ/ประเภท
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

    // === เปรียบเทียบภาพรวมค่าใช้จ่ายกับเดือน/ปีอื่น (ของสัตว์เลี้ยงตัวเดียวกับที่เลือกไว้) ===
    function summarizeExpenses(data) {
        var total = data.reduce(function(s, e) { return s + Number(e.amount); }, 0);
        var hidden = data.filter(function(e) { return e.expense_type === 'แฝง'; })
            .reduce(function(s, e) { return s + Number(e.amount); }, 0);
        return { total: total, hidden: hidden, count: data.length };
    }

    // เทียบ "from" (ช่วงเปรียบเทียบ) กับ "to" (ช่วงที่เลือกอยู่) เป็น % เปลี่ยนแปลง
    // คืนค่า null ถ้าเทียบไม่ได้ (ช่วงเปรียบเทียบเป็น 0 ทั้งคู่ หรือมีแค่ช่วงเดียวที่เป็น 0)
    function pctChange(from, to) {
        if (from === 0) return to === 0 ? 0 : null;
        return Math.round(((to - from) / from) * 100);
    }

    function changeBadge(from, to, higherIsBad) {
        var pct = pctChange(from, to);
        if (pct === null) return '<span class="text-xs text-gray-400">เทียบไม่ได้ (ช่วงเปรียบเทียบไม่มีข้อมูล)</span>';
        if (pct === 0) return '<span class="text-xs text-gray-500"><i class="fa-solid fa-minus mr-1"></i>เท่าเดิม</span>';
        var up = pct > 0;
        var bad = higherIsBad ? up : !up;
        var cls = bad ? 'text-red-600' : 'text-green-600';
        var icon = up ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down';
        return '<span class="text-xs font-medium ' + cls + '"><i class="fa-solid ' + icon + ' mr-1"></i>' + Math.abs(pct) + '% ' + (up ? 'เพิ่มขึ้น' : 'ลดลง') + '</span>';
    }

    function renderComparison(yearA, monthA, dataA, yearB, monthB, dataB) {
        var content = document.getElementById('compareContent');
        if (!content) return;

        var a = summarizeExpenses(dataA), b = summarizeExpenses(dataB);
        var labelA = THAI_MONTHS_FULL[monthA - 1] + ' ' + (yearA + 543);
        var labelB = THAI_MONTHS_FULL[monthB - 1] + ' ' + (yearB + 543);

        function periodCard(label, s, isSelected) {
            return '<div class="rounded-lg border ' + (isSelected ? 'border-pet bg-pet-light/40' : 'border-gray-200') + ' p-4">'
                + '<p class="text-xs font-medium text-gray-500 mb-1">' + (isSelected ? 'ช่วงที่เลือกดู' : 'ช่วงที่เปรียบเทียบ') + '</p>'
                + '<p class="text-sm font-semibold text-gray-800 mb-3">' + label + '</p>'
                + '<p class="text-2xl font-bold text-gray-900">฿ ' + fmt(s.total) + '</p>'
                + '<p class="text-xs text-gray-500 mt-1">ค่าใช้จ่ายแฝง ฿ ' + fmt(s.hidden) + ' • ' + s.count + ' รายการ</p>'
                + '</div>';
        }

        content.innerHTML = periodCard(labelA, a, true) + periodCard(labelB, b, false)
            + '<div class="sm:col-span-2 flex flex-wrap items-center gap-x-6 gap-y-2 pt-3 mt-1 border-t border-gray-100">'
            + '<div class="flex items-center gap-2"><span class="text-sm text-gray-500">ยอดรวม:</span>' + changeBadge(b.total, a.total, true) + '</div>'
            + '<div class="flex items-center gap-2"><span class="text-sm text-gray-500">ค่าใช้จ่ายแฝง:</span>' + changeBadge(b.hidden, a.hidden, true) + '</div>'
            + '</div>';
    }

    function loadComparison() {
        var section = document.getElementById('compareSection');
        var content = document.getElementById('compareContent');
        if (!section || !content) return Promise.resolve();

        var compare = getCompareFilters();
        if (!compare) {
            section.classList.add('hidden');
            return Promise.resolve();
        }

        section.classList.remove('hidden');
        content.innerHTML = '<div class="col-span-full text-center py-6 text-gray-400"><i class="fa-solid fa-spinner fa-spin mr-2"></i>กำลังโหลด...</div>';

        var f = getFilters();
        var petFilter = f.petId ? '&pet_id=eq.' + f.petId : '';
        var rangeA = monthRange(f.year, f.month);
        var rangeB = monthRange(compare.year, compare.month);

        return Promise.all([
            Api.query('expenses', 'select=amount,expense_type&expense_date=gte.' + rangeA.start + '&expense_date=lt.' + rangeA.end + petFilter),
            Api.query('expenses', 'select=amount,expense_type&expense_date=gte.' + rangeB.start + '&expense_date=lt.' + rangeB.end + petFilter)
        ]).then(function(r) {
            // เช็คซ้ำว่าตอนนี้ toggle/ช่วงเปรียบเทียบยังเป็นอันเดิมที่ query อยู่ไหม (กันกรณีผู้ใช้
            // เปลี่ยนตัวกรองเร็วมากระหว่างรอ request เก่ายังไม่เสร็จ ไม่ให้ผลลัพธ์เก่ามาทับของใหม่)
            var current = getCompareFilters();
            if (!current || current.year !== compare.year || current.month !== compare.month) return;
            renderComparison(f.year, f.month, r[0] || [], compare.year, compare.month, r[1] || []);
        }).catch(function(err) {
            console.error('Load comparison error:', err);
            content.innerHTML = '<div class="col-span-full text-center py-6 text-red-400">โหลดข้อมูลเปรียบเทียบไม่สำเร็จ: ' + (err.message || err) + '</div>';
        });
    }

    // เปิด/ปิดโหมดเปรียบเทียบ (เรียกตอนติ๊ก/เอาติ๊กออกจาก checkbox)
    function toggleCompare() {
        var wrap = document.getElementById('compareMonthWrap');
        var section = document.getElementById('compareSection');
        var compareInput = document.getElementById('filterCompareMonth');

        if (isCompareActive()) {
            if (wrap) wrap.classList.remove('hidden');
            // ถ้ายังไม่เคยเลือกช่วงเปรียบเทียบ ให้ตั้งค่าเริ่มต้นเป็น "เดือนก่อนหน้า" ของช่วงที่เลือกอยู่
            if (compareInput && !compareInput.value) {
                var f = getFilters();
                var prevMonth = f.month - 1, prevYear = f.year;
                if (prevMonth < 1) { prevMonth = 12; prevYear -= 1; }
                compareInput.value = prevYear + '-' + String(prevMonth).padStart(2, '0');
            }
        } else {
            if (wrap) wrap.classList.add('hidden');
            if (section) section.classList.add('hidden');
        }
        applyFilters();
    }

    // === Apply current filters (เรียกตอนเปลี่ยนสัตว์เลี้ยง/เดือนที่ต้องการดู/ตั้งค่าเปรียบเทียบ) ===
    function applyFilters() {
        return Promise.all([loadKPIs(), loadExpenseList(), loadChart(), loadComparison()]);
    }

    // === Submit Expense ===
    function submitExpense() {
        var catId = document.getElementById('formCategory').value;
        var note = document.getElementById('formNote').value;
        var amount = document.getElementById('formAmount').value;
        var date = document.getElementById('formDate').value;
        var petId = document.getElementById('formPet').value;

        if (!amount||!date||!petId||!catId||catId==='__new__') {
            alert('กรุณากรอกข้อมูลให้ครบทุกช่อง');
            return;
        }

        var cat = _categories.find(function(c) { return String(c.category_id) === String(catId); });
        var hidden = cat ? cat.category_type === 'แฝง' : false;

        // Auth.getUser() อาจยังโหลดไม่เสร็จถ้ากดบันทึกเร็วมาก ต้องรอ loadProfile()
        // ซ้ำถ้ายังไม่มี user แทนที่จะพังเงียบๆ ตอนอ่าน user.user_id
        var userPromise = Auth.getUser() ? Promise.resolve(Auth.getUser()) : Auth.loadProfile();

        return userPromise.then(function(user) {
            return Api.insert('expenses',{
                amount: Number(amount),
                expense_date: date,
                expense_type: hidden ? 'แฝง' : 'หลัก',
                pet_id: Number(petId),
                user_id: user.user_id,
                category_id: Number(catId),
                expense_note: note || null
            });
        }).then(function() {
            closeModal();
            return applyFilters();
        }).catch(function(err) {
            console.error('Submit expense error:', err);
            alert('บันทึกรายจ่ายไม่สำเร็จ: ' + (err.message || err));
        });
    }

    // === Modal ===
    function openModal() { document.getElementById('expenseModal').classList.remove('hidden'); }
    function closeModal() { document.getElementById('expenseModal').classList.add('hidden'); }

    // === Init ===
    function init() {
        var now = new Date();
        var currentYm = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');

        // ตั้งค่าตัวกรองเดือนเริ่มต้นเป็นเดือนปัจจุบัน (ถ้ายังไม่ได้เลือกอะไรไว้)
        var monthInput = document.getElementById('filterMonth');
        if (monthInput && !monthInput.value) monthInput.value = currentYm;

        // ช่วงเปรียบเทียบเลือกได้แค่ "เดือนที่ผ่านมาแล้ว" เท่านั้น (ไม่ให้เทียบกับอนาคต)
        var compareInput = document.getElementById('filterCompareMonth');
        if (compareInput) compareInput.max = currentYm;

        return Promise.all([loadPets(), loadCategories()]).then(function() {
            return applyFilters();
        });
    }

    return {
        init: init,
        loadKPIs: loadKPIs,
        loadExpenseList: loadExpenseList,
        loadChart: loadChart,
        loadPets: loadPets,
        loadCategories: loadCategories,
        onCategoryChange: onCategoryChange,
        addCategory: addCategory,
        cancelAddCategory: cancelAddCategory,
        applyFilters: applyFilters,
        toggleCompare: toggleCompare,
        submitExpense: submitExpense,
        openModal: openModal,
        closeModal: closeModal
    };
})();
