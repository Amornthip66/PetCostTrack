/**
 * Dashboard Module
 * โหลดข้อมูล KPI, รายการค่าใช้จ่าย, กราฟ
 */
var Dashboard = (function() {

    // === Helpers ===
    function fmt(n) { return new Intl.NumberFormat('th-TH').format(n); }

    var THAI_MONTHS = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
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

    // === KPI Cards ===
    function loadKPIs() {
        var now = new Date(), month = now.getMonth()+1, year = now.getFullYear();
        var mm = String(month).padStart(2,'0');
        var mmN = String(month+1>12?1:month+1).padStart(2,'0');
        var yN = month+1>12 ? year+1 : year;

        return Promise.all([
            Api.query('budgets','select=budget_limit&budget_month=eq.'+month+'&budget_year=eq.'+year),
            Api.query('expenses','select=amount,expense_type&expense_date=gte.'+year+'-'+mm+'-01&expense_date=lt.'+yN+'-'+mmN+'-01'),
            Api.count('pets')
        ]).then(function(r) {
            var budgets=r[0]||[], expenses=r[1]||[], petCount=r[2]||0;
            var totalBudget = budgets.reduce(function(s,b){return s+Number(b.budget_limit);},0);
            var totalSpent = expenses.reduce(function(s,e){return s+Number(e.amount);},0);
            var hiddenCost = expenses.filter(function(e){return e.expense_type==='แฝง';}).reduce(function(s,e){return s+Number(e.amount);},0);
            var percent = totalBudget>0 ? Math.round((totalSpent/totalBudget)*100) : 0;

            document.getElementById('totalSpent').textContent = fmt(totalSpent);
            document.getElementById('hiddenCost').textContent = fmt(hiddenCost);
            document.getElementById('budgetPercent').textContent = percent;
            document.getElementById('budgetTotal').textContent = fmt(totalBudget);
            document.getElementById('petCount').textContent = petCount;
            document.getElementById('budgetBar').style.width = percent + '%';
        });
    }

    // === Expense List ===
    function loadExpenseList() {
        return Api.query('expenses',
            'select=transaction_id,amount,expense_date,expense_type,expense_note,pets(name),users(name),categories(category_name)&order=expense_date.desc&limit=20')
        .then(function(data) {
            var list = document.getElementById('expenseList');
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
        });
    }

    // === Chart ===
    function loadChart() {
        return Api.query('expenses','select=amount,expense_type,categories(category_name)')
        .then(function(data) {
            if (!data||!data.length) return;
            var g = {};
            data.forEach(function(e){
                var c=e.categories&&e.categories.category_name||'อื่นๆ';
                g[c]=(g[c]||0)+Number(e.amount);
            });
            var labels=Object.keys(g), values=Object.values(g);
            var colors=['#60a5fa','#f87171','#4ade80','#fb923c','#a78bfa','#f472b6','#facc15','#34d399'];

            var ctx = document.getElementById('expenseChart');
            if (!ctx) return;
            new Chart(ctx.getContext('2d'),{
                type:'doughnut',
                data:{labels:labels,datasets:[{data:values,backgroundColor:colors.slice(0,labels.length),borderWidth:0,hoverOffset:4}]},
                options:{responsive:true,maintainAspectRatio:false,cutout:'70%',plugins:{legend:{display:false},tooltip:{callbacks:{label:function(c){return c.label+': '+new Intl.NumberFormat('th-TH',{style:'currency',currency:'THB'}).format(c.parsed);}}}}}
            });

            var legend = document.getElementById('chartLegend');
            if (legend) {
                legend.innerHTML=labels.map(function(l,i){
                    return '<div class="flex items-center"><span class="w-3 h-3 rounded-full mr-2" style="background:'+colors[i%colors.length]+'"></span> '+l+'</div>';
                }).join('');
            }
        });
    }

    // === Pets Dropdown ===
    function loadPets() {
        return Api.query('pets', 'select=pet_id,name').then(function(pets) {
            var sel = document.getElementById('formPet');
            if (!sel) return;
            if (!pets || !pets.length) { sel.innerHTML = '<option value="">ไม่พบสัตว์เลี้ยง</option>'; return; }
            sel.innerHTML = pets.map(function(p) {
                return '<option value="' + p.pet_id + '">' + p.name + '</option>';
            }).join('');
        });
    }

    // === Submit Expense ===
    function submitExpense() {
        var user = Auth.getUser();
        var catId = document.getElementById('formCategory').value;
        var note = document.getElementById('formNote').value;
        var amount = document.getElementById('formAmount').value;
        var date = document.getElementById('formDate').value;
        var petId = document.getElementById('formPet').value;

        if (!amount||!date||!petId) {
            alert('กรุณากรอกข้อมูลให้ครบทุกช่อง');
            return;
        }

        var hidden = [4,5,6].indexOf(Number(catId))>=0;
        return Api.insert('expenses',{
            amount: Number(amount),
            expense_date: date,
            expense_type: hidden ? 'แฝง' : 'หลัก',
            pet_id: Number(petId),
            user_id: user.user_id,
            category_id: Number(catId),
            expense_note: note || null
        }).then(function() {
            closeModal();
            return Promise.all([loadKPIs(), loadExpenseList(), loadChart()]);
        });
    }

    // === Modal ===
    function openModal() { document.getElementById('expenseModal').classList.remove('hidden'); }
    function closeModal() { document.getElementById('expenseModal').classList.add('hidden'); }

    // === Init ===
    function init() {
        return Promise.all([loadKPIs(), loadExpenseList(), loadChart(), loadPets()]);
    }

    return {
        init: init,
        loadKPIs: loadKPIs,
        loadExpenseList: loadExpenseList,
        loadChart: loadChart,
        loadPets: loadPets,
        submitExpense: submitExpense,
        openModal: openModal,
        closeModal: closeModal
    };
})();
