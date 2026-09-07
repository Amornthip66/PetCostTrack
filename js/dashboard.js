/**
 * Dashboard Module
 * โหลดข้อมูล KPI, รายการค่าใช้จ่าย, กราฟ
 * รองรับการเลือกดูเฉพาะสัตว์เลี้ยงตัวใดตัวหนึ่ง และเลือกเดือน/ปีที่ต้องการดูได้
 */
var Dashboard = (function() {

    var _pets = [];
    var _categories = [];
    var _chartInstance = null;

    // หนี HTML entity ก่อนแทรกข้อความที่ผู้ใช้ควบคุมได้ (เช่น ชื่อสัตว์เลี้ยง) ลงใน
    // innerHTML/attribute โดยตรง — เหมือนกับ escapeHtml() ใน js/history.js ทุกประการ
    function escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

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

    // === ข้อ 3.5 (ส่วนขยาย): ดึงรายจ่ายสำหรับตัวกรองปัจจุบัน รวมรายจ่ายที่ "แบ่ง" มาให้
    // สัตว์เลี้ยงที่กำลังดูอยู่ด้วย (functional requirement ข้อ 4 — Display on
    // Pet-Specific Dashboards) ===
    // เมื่อไม่ได้กรองสัตว์เลี้ยง ("ทุกสัตว์เลี้ยง", petId ว่าง): query เดิมทุกประการ ไม่แตะ
    // เลย เพื่อไม่ให้ยอดรวมทั้งหมดเปลี่ยนแปลง (กันนับซ้ำ — ยอดเต็มของรายจ่ายถูกนับไปแล้ว
    // ครั้งเดียวผ่านสัตว์เลี้ยงหลักอยู่แล้วในมุมมองนี้)
    //
    // เมื่อกรองสัตว์เลี้ยงตัวใดตัวหนึ่งโดยเฉพาะ: ดึง 2 ชุดแล้วรวมกัน
    //   1. รายจ่ายที่สัตว์เลี้ยงตัวนี้เป็น "สัตว์เลี้ยงหลัก" (pet_id ตรงๆ เหมือนเดิม)
    //   2. รายจ่ายที่ถูก "แบ่ง" มาให้สัตว์เลี้ยงตัวนี้ (ผ่าน expense_pet_shares) — ใช้
    //      share_amount (ยอดเฉพาะของสัตว์เลี้ยงตัวนี้) แทน amount เต็มจำนวน
    // ถ้า query expense_pet_shares ล้มเหลว (เช่น migration 20260913000000/20260914000000
    // ยังไม่ได้รันในฐานข้อมูลจริง) ให้ถือว่าไม่มีรายจ่ายที่ถูกแบ่งมาเลย ไม่ error ทั้งหน้า
    function queryExpensesForFilter(select, range, petId, opts) {
        opts = opts || {};
        var dateFilter = '&expense_date=gte.' + range.start + '&expense_date=lt.' + range.end;

        // sort/limit ใช้แบบ client-side เสมอ (ทั้งสองสาขา if/else ด้านล่าง) แทนการต่อ
        // &order/&limit เข้ากับ query ตรงๆ แบบเดิม เพราะตอนกรองสัตว์เลี้ยงตัวใดตัวหนึ่ง
        // ข้อมูลมาจาก 2 query (รายจ่ายหลัก + ส่วนแบ่ง) ที่ต้องรวมกันก่อนแล้วค่อยเรียง/ตัด
        // จำนวนทีเดียว จึงทำให้เหมือนกันทั้งสองสาขาเพื่อไม่ให้พฤติกรรมต่างกันโดยไม่ตั้งใจ
        function finalize(rows) {
            if (opts.sortDateDesc) rows.sort(function(a, b) { return new Date(b.expense_date) - new Date(a.expense_date); });
            if (opts.limit) rows = rows.slice(0, opts.limit);
            return rows;
        }

        if (!petId) {
            // "ทุกสัตว์เลี้ยง": migration 20260914000000 ขยาย RLS "expenses_select" ให้เห็น
            // รายจ่ายที่ถูกแบ่งมาได้ แม้ไม่มีสิทธิ์เข้าถึงสัตว์เลี้ยงหลักของรายจ่ายนั้นก็ตาม
            // (เคสจริง: ครอบครัวที่แต่ละคนดูแลคนละตัว) ถ้า query แบบเดิมตรงๆ ไม่กรองอะไรเลย
            // มุมมองนี้จะได้รายจ่ายของสัตว์เลี้ยง "หลัก" ที่ตัวเองไม่มีสิทธิ์เข้าถึงมาเต็มจำนวน
            // ปนเข้ามาด้วย (เห็นได้แค่เพราะมีส่วนแบ่งให้สัตว์เลี้ยงของตัวเอง) ทำให้ยอดรวม/กราฟ
            // พองเกินจริงและเห็นเงินของคนอื่นเต็มจำนวนโดยไม่ตั้งใจ
            //
            // จึงต้องเช็คว่า pet_id (สัตว์เลี้ยงหลัก) ของแต่ละแถวเป็นสัตว์เลี้ยงที่ตัวเองมี
            // สิทธิ์เข้าถึงจริงหรือไม่ (_pets โหลดผ่าน pets_select RLS ซึ่งกรองมาแล้วว่าเห็น
            // เฉพาะสัตว์เลี้ยงที่ตัวเองมีสิทธิ์) ถ้าใช่ → แสดงยอดเต็มเหมือนเดิมทุกประการ
            // (เป็นรายจ่ายของตัวเอง) ถ้าไม่ใช่ (เห็นแค่ผ่านส่วนแบ่ง) → แสดงเฉพาะผลรวมส่วนแบ่ง
            // ของสัตว์เลี้ยงที่ตัวเองมีสิทธิ์เท่านั้น กันเห็น/นับเงินก้อนเต็มของคนอื่น
            var selectWithIds = select.indexOf('pet_id') >= 0 ? select : 'pet_id,' + select;
            selectWithIds = selectWithIds.indexOf('transaction_id') >= 0 ? selectWithIds : 'transaction_id,' + selectWithIds;
            var myPetIds = {};
            _pets.forEach(function(p) { myPetIds[p.pet_id] = true; });

            return Api.query('expenses', 'select=' + selectWithIds + ',expense_pet_shares(pet_id,share_amount)' + dateFilter)
                .then(function(rows) {
                    return finalize((rows || []).map(function(e) {
                        var isMyPrimary = !!myPetIds[e.pet_id];
                        var shares = e.expense_pet_shares || [];
                        var result;
                        if (isMyPrimary) {
                            result = Object.assign({}, e);
                        } else {
                            var myShareSum = shares
                                .filter(function(s) { return myPetIds[s.pet_id]; })
                                .reduce(function(s, r) { return s + Number(r.share_amount || 0); }, 0);
                            result = Object.assign({}, e, { amount: ExpenseAllocation.round2(myShareSum), _shared: true });
                        }
                        delete result.expense_pet_shares;
                        return result;
                    }));
                })
                .catch(function(err) {
                    console.warn('expenses query with expense_pet_shares (all-pets view) failed, falling back to plain query (migration not applied yet?):', err);
                    return Api.query('expenses', 'select=' + select + dateFilter).then(function(data) {
                        return finalize(data || []);
                    });
                });
        }

        var selectWithId = select.indexOf('transaction_id') >= 0 ? select : 'transaction_id,' + select;

        // functional requirement ข้อ 7 (Data Display After Saving): ถ้ารายจ่ายนี้ถูก "แบ่ง"
        // ให้สัตว์เลี้ยงตัวอื่นด้วย ยอดที่แสดงบน Dashboard ของสัตว์เลี้ยงหลักต้องเป็น
        // "Primary Pet Amount" (= amount เต็ม หักส่วนแบ่งที่ให้ตัวอื่นไปแล้ว) ไม่ใช่ยอดเต็ม
        // ตรงๆ เพื่อไม่ให้เงินก้อนเดียวกันถูกนับซ้ำข้ามสัตว์เลี้ยงหลายตัว (primary + shared
        // ต้องรวมกันได้เท่ากับ Total Net Amount พอดีเสมอ ตาม ExpenseAllocation)
        var primaryPromise = Api.query('expenses', 'select=' + selectWithId + ',expense_pet_shares(share_amount)' + dateFilter + '&pet_id=eq.' + petId)
            .then(function(rows) {
                return (rows || []).map(function(e) {
                    var shares = e.expense_pet_shares || [];
                    var sumShared = shares.reduce(function(s, r) { return s + Number(r.share_amount || 0); }, 0);
                    var result = sumShared > 0 ? Object.assign({}, e, { amount: ExpenseAllocation.round2(Number(e.amount) - sumShared) }) : e;
                    delete result.expense_pet_shares;
                    return result;
                });
            })
            .catch(function(err) {
                console.warn('Load expense_pet_shares for primary amount adjustment failed, falling back to full amount (migration not applied yet?):', err);
                return Api.query('expenses', 'select=' + selectWithId + dateFilter + '&pet_id=eq.' + petId);
            });

        var sharedDateFilter = '&expenses.expense_date=gte.' + range.start + '&expenses.expense_date=lt.' + range.end;
        var sharedPromise = Api.query('expense_pet_shares', 'select=share_amount,expenses!inner(' + selectWithId + ')' + sharedDateFilter + '&pet_id=eq.' + petId)
            .catch(function(err) {
                console.warn('Load expense_pet_shares for dashboard failed (non-critical - อาจยังไม่ได้รัน migration 20260913000000/20260914000000):', err);
                return [];
            });

        return Promise.all([primaryPromise, sharedPromise]).then(function(results) {
            var primary = results[0] || [];
            var sharedRows = results[1] || [];
            var seenIds = {};
            primary.forEach(function(e) { if (e.transaction_id != null) seenIds[e.transaction_id] = true; });

            var shared = sharedRows
                .filter(function(r) { return r.expenses; })
                .map(function(r) { return Object.assign({}, r.expenses, { amount: r.share_amount, _shared: true }); })
                // กันไว้อีกชั้น ไม่ให้รายจ่ายเดียวกันถูกนับซ้ำถ้าหลุดมาปรากฏในทั้งสองชุด
                .filter(function(e) { return e.transaction_id == null || !seenIds[e.transaction_id]; });

            return finalize(primary.concat(shared));
        });
    }

    // === KPI Cards ===
    function loadKPIs() {
        var f = getFilters();
        var range = monthRange(f.year, f.month);
        var petFilter = f.petId ? '&pet_id=eq.' + f.petId : '';
        updatePeriodLabel(f.year, f.month);

        return Promise.all([
            Api.query('budgets', 'select=budget_limit&budget_month=eq.' + f.month + '&budget_year=eq.' + f.year + petFilter),
            queryExpensesForFilter('amount,expense_type', range, f.petId),
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
        var list = document.getElementById('expenseList');

        // recorded_by_role เป็นคอลัมน์ใหม่ (migration 20260912000000) เก็บสิทธิ์ของ
        // ผู้บันทึก ณ ตอนสร้างรายการไว้ถาวร ใช้ระบายสีชื่อผู้บันทึก — ถ้าฐานข้อมูลจริง
        // ยังไม่ได้รัน migration นี้ ให้ถอยไปดึงแบบไม่มีคอลัมน์นี้แทน กันหน้าพังทั้งหน้า
        var commonFields = 'transaction_id,amount,expense_date,expense_type,expense_note,pets(name),users(name),categories(category_name)';
        var fullFields = 'transaction_id,amount,expense_date,expense_type,expense_note,recorded_by_role,pets(name),users(name),categories(category_name)';
        // ต้อง sort/limit เอง (client-side) แทนที่จะส่ง &order/&limit ไปกับ query ตรงๆ เพราะ
        // ตอนกรองสัตว์เลี้ยงตัวใดตัวหนึ่ง ข้อมูลมาจาก 2 query (รายจ่ายหลัก + ส่วนแบ่ง) ที่ต้อง
        // รวมกันก่อนแล้วค่อยเรียง/ตัดจำนวนทีเดียว ไม่งั้นได้ผลลัพธ์ผิด (ดู queryExpensesForFilter)
        var queryOpts = { sortDateDesc: true, limit: 20 };

        queryExpensesForFilter(fullFields, range, f.petId, queryOpts)
        .catch(function(err) {
            console.warn('expenses query with recorded_by_role failed, falling back (migration not applied yet?):', err);
            return queryExpensesForFilter(commonFields, range, f.petId, queryOpts);
        })
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
                var userName = e.users && e.users.name || '';
                var pet = e.pets && e.pets.name || '';
                return '<li class="py-4 hover:bg-gray-50 transition-colors rounded-lg px-2 -mx-2 flex justify-between items-center cursor-pointer">'
                +'<div class="flex items-center gap-4">'
                +'<div class="flex-shrink-0 w-12 h-12 '+icon.bg+' '+icon.cl+' rounded-full flex items-center justify-center text-xl"><i class="fa-solid '+icon.i+'"></i></div>'
                +'<div><p class="text-sm font-semibold text-gray-900 flex items-center gap-2">'+note
                +(hidden?' <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-pet-hidden">ค่าใช้จ่ายแฝง</span>':' <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">ปกติ</span>')
                // ข้อ 3.5 (ส่วนขยาย): บอกให้ชัดว่ายอดนี้เป็น "ส่วนแบ่ง" ของสัตว์เลี้ยงที่กำลังดูอยู่
                // ไม่ใช่ยอดเต็มของรายจ่าย กันผู้ใช้เข้าใจผิดว่าเป็นยอดเต็ม
                +(e._shared?' <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-pet-light text-pet"><i class="fa-solid fa-link mr-1"></i>ส่วนแบ่ง</span>':'')
                +'</p><p class="text-xs text-gray-500 flex items-center gap-1 flex-wrap">'+formatDate(e.expense_date)+' • '+UI.recorderBadge(userName || '—', e.recorded_by_role)+' • '+pet+'</p></div></div>'
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
        var legend = document.getElementById('chartLegend');

        return queryExpensesForFilter('amount,expense_type,categories(category_name)', range, f.petId)
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

    // === Pets Dropdown (ตัวกรองบนหน้า เห็นสัตว์เลี้ยงทุกตัวรวมที่เก็บเข้าคลังแล้ว
    // เพื่อยังกรองดูประวัติค่าใช้จ่ายเก่าได้ / dropdown ในฟอร์มเพิ่มรายจ่าย ไม่รวมตัวที่
    // เก็บเข้าคลังแล้ว เพราะไม่ควรบันทึกรายจ่ายใหม่ให้สัตว์เลี้ยงที่ไม่ได้ดูแลแล้ว) ===
    function loadPets() {
        return Api.query('pets', 'select=pet_id,name,is_archived')
        .catch(function(err) {
            // เผื่อฐานข้อมูลจริงยังไม่ได้รัน migration ที่เพิ่มคอลัมน์ is_archived
            console.warn('pets query with is_archived failed, falling back:', err);
            return Api.query('pets', 'select=pet_id,name').then(function(pets) {
                return (pets || []).map(function(p) { p.is_archived = false; return p; });
            });
        })
        .then(function(pets) {
            _pets = pets || [];
            var activePets = _pets.filter(function(p) { return !p.is_archived; });

            var filterSel = document.getElementById('filterPet');
            if (filterSel) {
                filterSel.innerHTML = '<option value="">ทุกสัตว์เลี้ยง</option>'
                    + _pets.map(function(p) { return '<option value="' + p.pet_id + '">' + p.name + (p.is_archived ? ' (คลัง)' : '') + '</option>'; }).join('');
            }

            var formSel = document.getElementById('formPet');
            if (formSel) {
                formSel.innerHTML = activePets.length
                    ? activePets.map(function(p) { return '<option value="' + p.pet_id + '">' + p.name + '</option>'; }).join('')
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
        var rangeA = monthRange(f.year, f.month);
        var rangeB = monthRange(compare.year, compare.month);

        return Promise.all([
            queryExpensesForFilter('amount,expense_type', rangeA, f.petId),
            queryExpensesForFilter('amount,expense_type', rangeB, f.petId)
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
    // === ข้อ 3.5 (requirement ข้อ 6 — Dashboard Support): ฟอร์มเพิ่มรายจ่ายบนแดชบอร์ด
    // ต้องมีพฤติกรรมแบ่งค่าใช้จ่าย + live validation แบบเดียวกับหน้าประวัติรายจ่ายทุก
    // ประการ ใช้ ExpenseAllocation โมดูลเดียวกันคำนวณกฎการจัดสรร (ไม่ให้ตรรกะเพี้ยนไป
    // คนละแบบระหว่าง 2 หน้า) ส่วน DOM/element ผูกกับฟอร์มของหน้านี้เองแยกต่างหาก เพราะ
    // เป็นคนละหน้า/คนละโมดัลกับ history.js — ฟอร์มนี้ใช้สร้างรายจ่ายใหม่เท่านั้น (ไม่มี
    // โหมดแก้ไข) จึงไม่ต้องมี state ติดตามส่วนแบ่งเดิมเหมือน js/history.js ===
    function renderSharePetCheckboxes() {
        var wrap = document.getElementById('sharePetCheckboxes');
        if (!wrap) return;
        var primaryPetId = document.getElementById('formPet').value;
        var candidates = _pets.filter(function(p) {
            return !p.is_archived && String(p.pet_id) !== String(primaryPetId);
        });
        if (!candidates.length) {
            wrap.innerHTML = '<p class="text-xs text-gray-400">ไม่มีสัตว์เลี้ยงตัวอื่นให้เลือก</p>';
            updateShareSummary();
            return;
        }
        wrap.innerHTML = candidates.map(function(p) {
            return '<label class="flex items-center gap-2 py-0.5">'
                + '<input type="checkbox" value="' + p.pet_id + '" onchange="Dashboard.onSharePetToggle(this)" class="h-4 w-4 rounded border-gray-300 text-pet focus:ring-pet flex-shrink-0">'
                + '<span class="flex-1 truncate">' + escapeHtml(p.name) + '</span>'
                + '<input type="number" step="0.01" min="0" value="" oninput="Dashboard.updateShareSummary()" placeholder="0.00"'
                    + ' class="w-24 px-2 py-1 border border-gray-300 rounded text-right text-xs bg-gray-100 text-gray-400" disabled>'
                + '</label>';
        }).join('');
        updateShareSummary();
    }

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

    function readSharedAmountInputs() {
        return Array.prototype.slice.call(document.querySelectorAll('#sharePetCheckboxes input[type=checkbox]:checked'))
            .map(function(cb) {
                var row = cb.closest('label');
                var amountInput = row ? row.querySelector('input[type=number]') : null;
                return amountInput ? amountInput.value : '';
            });
    }

    // เหมือนกับ js/history.js: updateShareSummary() ทุกประการ (ใช้ ExpenseAllocation
    // ตัวเดียวกัน) เพื่อยืนยันว่ากฎการตรวจสอบไม่เพี้ยนไปคนละแบบระหว่าง 2 หน้า
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
        // เหมือนกับ js/history.js ทุกประการ (requirement ข้อ 6: กฎเดียวกันทั้ง 2 หน้า)
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

        if (saveBtn) saveBtn.disabled = disableSave;
    }

    function onShareToggle() {
        var toggle = document.getElementById('formShareToggle');
        var section = document.getElementById('shareSection');
        var primaryInput = document.getElementById('formPrimaryShareAmount');
        if (!toggle || !section) return;
        if (toggle.checked) {
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
        }).filter(function(s) { return String(s.pet_id) !== String(primaryPetId); });
    }

    // ฟอร์มนี้สร้างรายจ่ายใหม่อย่างเดียว (ไม่มีโหมดแก้ไข) จึงแค่ insert ตรงๆ ไม่ต้องลบ
    // ของเดิมก่อนเหมือน js/history.js (ซึ่งต้องรองรับทั้งสร้างใหม่และแก้ไขรายการเดิม)
    function saveShares(transactionId) {
        var shareSelections = collectShareSelections();
        if (!shareSelections.length) return Promise.resolve();
        return Promise.all(shareSelections.map(function(s) {
            return Api.insert('expense_pet_shares', {
                transaction_id: transactionId, pet_id: s.pet_id, share_amount: s.amount
            });
        }));
    }

    // เคลียร์ช่องแบ่งค่าใช้จ่ายหลังบันทึกสำเร็จ กันไม่ให้ค่าที่กรอกไว้ค้างไปโผล่ตอนเพิ่ม
    // รายจ่ายรายการถัดไป (ฟอร์มนี้เดิมไม่ได้ reset formNote/formAmount/formPet/formDate
    // อยู่แล้วตามพฤติกรรมเดิมของแอป จึงไม่แตะช่องเหล่านั้น อยู่นอกขอบเขตของงานนี้)
    function resetShareFields() {
        var toggle = document.getElementById('formShareToggle');
        if (toggle) toggle.checked = false;
        var section = document.getElementById('shareSection');
        if (section) section.classList.add('hidden');
        var primaryInput = document.getElementById('formPrimaryShareAmount');
        if (primaryInput) primaryInput.value = '';
        var wrap = document.getElementById('sharePetCheckboxes');
        if (wrap) wrap.innerHTML = '';
        updateShareSummary();
    }

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
        // Proposal AC F-02 II: ระบบต้องตรวจสอบว่าจำนวนเงินไม่ติดลบและมากกว่า 0
        if (isNaN(amount) || Number(amount) <= 0) {
            alert('กรุณากรอกจำนวนเงินให้ถูกต้อง (ต้องเป็นตัวเลขมากกว่า 0)');
            return;
        }

        // ข้อ 3.5 (requirement ข้อ 3 — Save Protection / ข้อ 6 — Dashboard Support):
        // ตรวจสอบส่วนแบ่งค่าใช้จ่ายด้วยกฎเดียวกับ js/history.js (ผ่าน ExpenseAllocation)
        // ไม่พึ่งพา live validation ฝั่ง UI เพียงอย่างเดียว
        var shareToggle = document.getElementById('formShareToggle');
        var shareSelections = collectShareSelections();
        if (shareToggle && shareToggle.checked) {
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
        }).then(function(created) {
            var row = Array.isArray(created) ? created[0] : created;
            // บันทึกส่วนแบ่งเป็นขั้นตอนเสริม — ห่อด้วย .catch() แยกต่างหาก ไม่ให้การบันทึก
            // รายจ่ายหลัก (สำคัญกว่า) ล้มเหลวไปด้วย ถ้าตาราง expense_pet_shares ยังไม่มี
            return saveShares(row.transaction_id).catch(function(err) {
                console.warn('Save expense_pet_shares failed (non-critical - อาจยังไม่ได้รัน migration 20260913000000):', err);
            });
        }).then(function() {
            resetShareFields();
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
        closeModal: closeModal,
        onShareToggle: onShareToggle,
        onSharePetToggle: onSharePetToggle,
        updateShareSummary: updateShareSummary
    };
})();
