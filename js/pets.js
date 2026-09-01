/**
 * Pets Module
 * จัดการสัตว์เลี้ยง (CRUD)
 */
var Pets = (function() {

    var _pets = [];

    function init() {
        load();
    }

    function load() {
        var grid = document.getElementById('petsGrid');
        if (grid) {
            grid.innerHTML = '<div class="col-span-full text-center py-12 text-gray-400"><i class="fa-solid fa-spinner fa-spin mr-2"></i>กำลังโหลดสัตว์เลี้ยง...</div>';
        }

        var user = Auth.getUser();
        if (!user || !user.user_id) {
            // Fallback ถ้ายังไม่มี user_id ให้ลองโหลดสัตว์เลี้ยงทั้งหมดตรงๆ
            return Api.query('pets', 'select=pet_id,name,type_breed,age')
            .then(function(pets) {
                _pets = (pets || []).map(function(p) {
                    return { pet_id: p.pet_id, name: p.name, type_breed: p.type_breed, age: p.age, access_role: 'Owner' };
                });
                render();
            }).catch(function(err) {
                console.error('Error loading pets:', err);
                _pets = [];
                render();
            });
        }

        // Query pet_access first, then pets separately to avoid embedded resource RLS 403
        return Api.query('pet_access', 'select=pet_id,access_role&user_id=eq.' + user.user_id)
        .then(function(access) {
            if (!access || !access.length) {
                // ถ้ายังไม่มี pet_access ลองเช็คว่ามีสัตว์เลี้ยงในระบบไหม
                return Api.query('pets', 'select=pet_id,name,type_breed,age')
                .then(function(pets) {
                    _pets = (pets || []).map(function(p) {
                        return { pet_id: p.pet_id, name: p.name, type_breed: p.type_breed, age: p.age, access_role: 'Owner' };
                    });
                    render();
                }).catch(function() {
                    _pets = [];
                    render();
                });
            }
            var petIds = access.map(function(a) { return a.pet_id; }).filter(Boolean);
            if (!petIds.length) {
                _pets = [];
                render();
                return;
            }
            var accessMap = {};
            access.forEach(function(a) { accessMap[a.pet_id] = a.access_role; });
            return Api.query('pets', 'select=pet_id,name,type_breed,age&pet_id=in.(' + petIds.join(',') + ')')
            .then(function(pets) {
                _pets = (pets || []).map(function(p) {
                    return { pet_id: p.pet_id, name: p.name, type_breed: p.type_breed, age: p.age, access_role: accessMap[p.pet_id] || 'Owner' };
                });
                render();
            });
        }).catch(function(err) {
            console.error('Error loading pet_access:', err);
            return Api.query('pets', 'select=pet_id,name,type_breed,age').then(function(pets) {
                _pets = (pets || []).map(function(p) {
                    return { pet_id: p.pet_id, name: p.name, type_breed: p.type_breed, age: p.age, access_role: 'Owner' };
                });
                render();
            });
        });
    }

    function render() {
        var grid = document.getElementById('petsGrid');
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
                    });
                }
                return created;
            });
        }

        promise.then(function() {
            closeModal();
            load();
        }).catch(function(e) {
            alert('เกิดข้อผิดพลาด: ' + e.message);
        });
    }

    function remove(petId) {
        if (!confirm('ต้องการลบสัตว์เลี้ยงตัวนี้จริงหรือไม่?')) return;
        Api.remove('pets', 'pet_id=eq.' + petId)
            .then(function() { load(); })
            .catch(function(err) { alert('ไม่สามารถลบสัตว์เลี้ยงได้: ' + err.message); });
    }

    return { init: init, openModal: openModal, closeModal: closeModal, edit: edit, save: save, remove: remove };
})();
