/**
 * Pets Module
 * จัดการสัตว์เลี้ยง (CRUD)
 */
var Pets = (function() {

    var _pets = [];
    var _familyPetId = null;

    function init() {
        return load();
    }

    function load() {
        var grid = document.getElementById('petsGrid');
        if (grid) {
            grid.innerHTML = '<div class="col-span-full text-center py-12 text-gray-400"><i class="fa-solid fa-spinner fa-spin mr-2"></i>กำลังโหลดสัตว์เลี้ยง...</div>';
        }

        var user = Auth.getUser();
        var userId = (user && user.user_id) ? user.user_id : null;

        // ดึงข้อมูลสัตว์เลี้ยงทั้งหมดทันทีในคำขอเดียว (รวดเร็วมาก)
        var petsPromise = Api.query('pets', 'select=pet_id,name,type_breed,age&order=pet_id.asc');
        
        // ดึงสิทธิ์ pet_access คู่ขนานกันเฉพาะกรณีที่มี userId ป้องกัน user_id=eq.undefined
        var accessPromise = userId 
            ? Api.query('pet_access', 'select=pet_id,access_role&user_id=eq.' + userId).catch(function() { return []; }) 
            : Promise.resolve([]);

        return Promise.all([petsPromise, accessPromise])
        .then(function(results) {
            var pets = results[0] || [];
            var access = results[1] || [];
            var accessMap = {};
            access.forEach(function(a) { if (a && a.pet_id) accessMap[a.pet_id] = a.access_role; });

            _pets = pets.map(function(p) {
                return {
                    pet_id: p.pet_id,
                    name: p.name,
                    type_breed: p.type_breed,
                    age: p.age,
                    access_role: accessMap[p.pet_id] || (user && user.role ? user.role : 'Owner')
                };
            });
            render();
        }).catch(function(err) {
            console.error('Pets load error:', err);
            // Fallback: หาก query คู่ขนานมีปัญหา ให้ดึงเฉพาะ pets ตารางหลักตรงๆ
            return Api.query('pets', 'select=pet_id,name,type_breed,age&order=pet_id.asc')
            .then(function(pets) {
                _pets = (pets || []).map(function(p) {
                    return {
                        pet_id: p.pet_id,
                        name: p.name,
                        type_breed: p.type_breed,
                        age: p.age,
                        access_role: 'Owner'
                    };
                });
                render();
            }).catch(function(e) {
                console.error('Fatal load pets error:', e);
                _pets = [];
                render();
            });
        });
    }

    function render() {
        var grid = document.getElementById('petsGrid');
        if (!grid) return;

        if (!_pets.length) {
            grid.innerHTML = '<div class="col-span-full text-center py-12">'
                + '<i class="fa-solid fa-paw text-4xl text-gray-300 mb-3"></i>'
                + '<p class="text-gray-400">ยังไม่มีสัตว์เลี้ยง</p>'
                + '<p class="text-gray-400 text-sm mt-1">กดปุ่ม "เพิ่มสัตว์เลี้ยง" เพื่อเริ่มต้น</p></div>';
            return;
        }
        grid.innerHTML = _pets.map(function(p) {
            var isOwner = p.access_role === 'Owner';
            var emoji = (p.type_breed && p.type_breed.indexOf('แมว') >= 0) ? '🐱' : '🐶';
            return '<div class="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden hover:shadow-md transition">'
                + '<div class="h-32 bg-gradient-to-br from-pet-light to-blue-100 flex items-center justify-center text-6xl">' + emoji + '</div>'
                + '<div class="p-5">'
                + '<div class="flex items-center justify-between mb-2">'
                + '<h3 class="text-lg font-bold text-gray-900">' + p.name + '</h3>'
                + '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ' + (isOwner ? 'bg-pet-light text-pet-DEFAULT' : 'bg-green-100 text-green-700') + '">' + p.access_role + '</span>'
                + '</div>'
                + '<p class="text-sm text-gray-500">' + (p.type_breed || 'ไม่ระบุพันธุ์') + '</p>'
                + '<p class="text-sm text-gray-500">' + (p.age ? p.age + ' ปี' : 'ไม่ระบุอายุ') + '</p>'
                + (isOwner ? '<div class="mt-4 flex gap-2">'
                    + '<button onclick="Pets.edit(' + p.pet_id + ')" class="flex-1 px-3 py-1.5 text-sm text-pet-DEFAULT border border-pet-DEFAULT rounded-lg hover:bg-pet-light transition"><i class="fa-solid fa-pen mr-1"></i>แก้ไข</button>'
                    + '<button onclick="Pets.manageFamily(' + p.pet_id + ')" class="px-3 py-1.5 text-sm text-green-600 border border-green-300 rounded-lg hover:bg-green-50 transition" title="จัดการครอบครัว"><i class="fa-solid fa-users"></i></button>'
                    + '<button onclick="Pets.remove(' + p.pet_id + ')" class="px-3 py-1.5 text-sm text-red-500 border border-red-300 rounded-lg hover:bg-red-50 transition"><i class="fa-solid fa-trash"></i></button>'
                    + '</div>' : '')
                + '</div></div>';
        }).join('');
    }

    function openModal(pet) {
        document.getElementById('formPetId').value = pet ? pet.pet_id : '';
        document.getElementById('formPetName').value = pet ? pet.name : '';
        document.getElementById('formPetBreed').value = pet ? (pet.type_breed || '') : '';
        document.getElementById('formPetAge').value = pet ? (pet.age || '') : '';
        document.getElementById('petModalTitle').textContent = pet ? 'แก้ไขสัตว์เลี้ยง' : 'เพิ่มสัตว์เลี้ยงใหม่';
        document.getElementById('petModal').classList.remove('hidden');
    }

    function closeModal() { document.getElementById('petModal').classList.add('hidden'); }

    function edit(petId) {
        var pet = _pets.find(function(p) { return p.pet_id === petId; });
        if (pet) openModal(pet);
    }

    function save() {
        var id = document.getElementById('formPetId').value;
        var data = {
            name: document.getElementById('formPetName').value.trim(),
            type_breed: document.getElementById('formPetBreed').value.trim() || null,
            age: document.getElementById('formPetAge').value ? Number(document.getElementById('formPetAge').value) : null
        };
        if (!data.name) { alert('กรุณากรอกชื่อสัตว์เลี้ยง'); return; }

        var promise;
        if (id) {
            promise = Api.update('pets', 'pet_id=eq.' + id, data);
        } else {
            promise = Api.insert('pets', data).then(function(newPet) {
                var created = Array.isArray(newPet) ? newPet[0] : newPet;
                var user = Auth.getUser();
                if (user && user.user_id && created && created.pet_id) {
                    return Api.insert('pet_access', {
                        pet_id: created.pet_id,
                        user_id: user.user_id,
                        access_role: user.role || 'Owner'
                    }).catch(function(err) {
                        console.warn('Could not insert pet_access record:', err);
                    }).then(function() {
                        return created;
                    });
                }
                return created;
            });
        }

        promise.then(function() {
            closeModal();
            load();
        }).catch(function(e) {
            console.error('Save pet error:', e);
            alert('เกิดข้อผิดพลาด: ' + (e.message || e));
        });
    }

    function remove(petId) {
        if (!confirm('ต้องการลบสัตว์เลี้ยงตัวนี้จริงหรือไม่?')) return;
        Api.remove('pets', 'pet_id=eq.' + petId)
            .then(function() { load(); })
            .catch(function(err) { alert('ไม่สามารถลบสัตว์เลี้ยงได้: ' + (err.message || err)); });
    }

    // === จัดการครอบครัว (Family Management) ===
    function manageFamily(petId) {
        _familyPetId = petId;
        var pet = _pets.find(function(p) { return p.pet_id === petId; });
        document.getElementById('familyModalPetName').textContent = pet ? pet.name : '';
        document.getElementById('familyAddEmail').value = '';
        document.getElementById('familyAddMsg').classList.add('hidden');
        document.getElementById('familyModal').classList.remove('hidden');
        loadFamilyMembers();
    }

    function closeFamilyModal() {
        document.getElementById('familyModal').classList.add('hidden');
        _familyPetId = null;
    }

    function loadFamilyMembers() {
        var list = document.getElementById('familyMembersList');
        list.innerHTML = '<div class="text-center py-4 text-gray-400"><i class="fa-solid fa-spinner fa-spin mr-2"></i>กำลังโหลด...</div>';

        Api.query('pet_access', 'select=user_id,access_role&pet_id=eq.' + _familyPetId)
        .then(function(access) {
            access = access || [];
            var userIds = access.map(function(a) { return a.user_id; });
            if (!userIds.length) { list.innerHTML = ''; return; }
            return Api.query('users', 'select=user_id,name,email&user_id=in.(' + userIds.join(',') + ')')
            .then(function(users) {
                var userMap = {};
                (users || []).forEach(function(u) { userMap[u.user_id] = u; });

                list.innerHTML = access.map(function(a) {
                    var u = userMap[a.user_id] || { name: 'ไม่ทราบชื่อ', email: '' };
                    var isRoleOwner = a.access_role === 'Owner';
                    return '<div class="flex items-center gap-3 py-3 border-b border-gray-100 last:border-0">'
                        + '<img class="h-9 w-9 rounded-full object-cover" src="https://ui-avatars.com/api/?name=' + encodeURIComponent(u.name) + '&background=e0f2fe&color=0369a1" alt="">'
                        + '<div class="flex-1 min-w-0"><p class="text-sm font-medium text-gray-900 truncate">' + u.name + '</p><p class="text-xs text-gray-500 truncate">' + u.email + '</p></div>'
                        + '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ' + (isRoleOwner ? 'bg-pet-light text-pet-DEFAULT' : 'bg-green-100 text-green-700') + '">' + a.access_role + '</span>'
                        + (isRoleOwner ? '' : '<button onclick="Pets.removeFamilyMember(' + a.user_id + ')" class="ml-1 px-2 py-1 text-red-500 hover:bg-red-50 rounded-lg transition" title="นำออก"><i class="fa-solid fa-user-xmark"></i></button>')
                        + '</div>';
                }).join('');
            });
        })
        .catch(function(err) {
            console.error('Load family members error:', err);
            list.innerHTML = '<p class="text-red-500 text-sm">ไม่สามารถโหลดรายชื่อสมาชิกได้</p>';
        });
    }

    function addFamilyMember() {
        var emailInput = document.getElementById('familyAddEmail');
        var msg = document.getElementById('familyAddMsg');
        var email = emailInput.value.trim();
        msg.classList.add('hidden');

        if (!email) { alert('กรุณากรอกอีเมลของสมาชิกที่ต้องการเชิญ'); return; }
        if (!_familyPetId) return;

        Api.rpc('find_user_by_email', { p_email: email })
        .then(function(result) {
            var found = Array.isArray(result) ? result[0] : result;
            if (!found || !found.user_id) {
                throw new Error('ไม่พบผู้ใช้ที่ใช้อีเมลนี้ในระบบ กรุณาให้สมาชิกลงทะเบียนก่อน แล้วลองอีกครั้ง');
            }
            return Api.insert('pet_access', {
                pet_id: _familyPetId,
                user_id: found.user_id,
                access_role: 'Co-caretaker'
            });
        })
        .then(function() {
            emailInput.value = '';
            loadFamilyMembers();
        })
        .catch(function(err) {
            var text = (err && err.message) || String(err);
            if (text.indexOf('duplicate') >= 0 || text.indexOf('pet_access_pkey') >= 0) {
                text = 'สมาชิกคนนี้อยู่ในรายชื่อผู้ดูแลของสัตว์เลี้ยงตัวนี้อยู่แล้ว';
            }
            msg.textContent = text;
            msg.classList.remove('hidden');
        });
    }

    function removeFamilyMember(userId) {
        if (!_familyPetId) return;
        if (!confirm('ต้องการนำสมาชิกคนนี้ออกจากผู้ร่วมดูแลสัตว์เลี้ยงตัวนี้หรือไม่?')) return;
        Api.remove('pet_access', 'pet_id=eq.' + _familyPetId + '&user_id=eq.' + userId)
        .then(function() { loadFamilyMembers(); })
        .catch(function(err) { alert('ไม่สามารถนำสมาชิกออกได้: ' + (err.message || err)); });
    }

    return {
        init: init, load: load, openModal: openModal, closeModal: closeModal, edit: edit, save: save, remove: remove,
        manageFamily: manageFamily, closeFamilyModal: closeFamilyModal, addFamilyMember: addFamilyMember, removeFamilyMember: removeFamilyMember
    };
})();
