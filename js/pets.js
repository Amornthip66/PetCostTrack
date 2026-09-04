/**
 * Pets Module
 * จัดการสัตว์เลี้ยง (CRUD) พร้อมรูปภาพและรายละเอียด
 */
var Pets = (function() {

    var _pets = [];
    var MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5MB

    var TYPE_EMOJI = {
        'สุนัข': '🐶',
        'แมว': '🐱',
        'นก': '🐦',
        'กระต่าย': '🐰',
        'ปลา': '🐠',
        'สัตว์เลื้อยคลาน': '🦎',
        'หนู/สัตว์ฟันแทะ': '🐹'
    };
    function typeEmoji(t) { return TYPE_EMOJI[t] || '🐾'; }

    var THAI_MONTHS = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
    function formatDate(s) {
        if (!s) return '';
        var d = new Date(s);
        if (isNaN(d.getTime())) return '';
        return d.getDate() + ' ' + THAI_MONTHS[d.getMonth()] + ' ' + (d.getFullYear() + 543);
    }

    function uuid() {
        if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
        // Fallback สำหรับเบราว์เซอร์เก่าที่ไม่มี crypto.randomUUID
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

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
        var selectFields = 'pet_id,name,photo_url,pet_type,breed,gender,age,weight_kg,birth_date,adoption_date,microchip_id';

        // ดึงข้อมูลสัตว์เลี้ยงทั้งหมดทันทีในคำขอเดียว (รวดเร็วมาก)
        var petsPromise = Api.query('pets', 'select=' + selectFields + '&order=pet_id.asc');

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
                p.access_role = accessMap[p.pet_id] || (user && user.role ? user.role : 'Owner');
                return p;
            });
            render();
        }).catch(function(err) {
            console.error('Pets load error:', err);
            // Fallback: หาก query คู่ขนานมีปัญหา ให้ดึงเฉพาะ pets ตารางหลักตรงๆ
            return Api.query('pets', 'select=' + selectFields + '&order=pet_id.asc')
            .then(function(pets) {
                _pets = (pets || []).map(function(p) {
                    p.access_role = 'Owner';
                    return p;
                });
                render();
            }).catch(function(e) {
                console.error('Fatal load pets error:', e);
                if (grid) grid.innerHTML = '<div class="col-span-full text-center py-12 text-red-400">โหลดข้อมูลสัตว์เลี้ยงไม่สำเร็จ: ' + (e.message || e) + '</div>';
            });
        });
    }

    function genderLabel(g) {
        if (g === 'Male') return 'ผู้';
        if (g === 'Female') return 'เมีย';
        return '';
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
            var photo = p.photo_url
                ? '<img src="' + p.photo_url + '" alt="' + p.name + '" class="h-32 w-full object-cover">'
                : '<div class="h-32 bg-gradient-to-br from-pet-light to-purple-100 flex items-center justify-center text-6xl">' + typeEmoji(p.pet_type) + '</div>';

            var metaLine1 = [p.pet_type, p.breed].filter(Boolean).join(' • ') || 'ไม่ระบุประเภท/สายพันธุ์';
            var genderTxt = genderLabel(p.gender);

            var metaLine2Parts = [];
            metaLine2Parts.push(p.age ? p.age + ' ปี' : 'ไม่ระบุอายุ');
            if (p.weight_kg) metaLine2Parts.push(Number(p.weight_kg) + ' กก.');
            var metaLine2 = metaLine2Parts.join(' • ');

            var extraLines = '';
            if (p.birth_date || p.adoption_date) {
                var parts = [];
                if (p.birth_date) parts.push('เกิด ' + formatDate(p.birth_date));
                if (p.adoption_date) parts.push('รับเลี้ยง ' + formatDate(p.adoption_date));
                extraLines += '<p class="text-xs text-gray-400 mt-1">' + parts.join(' • ') + '</p>';
            }
            if (p.microchip_id) {
                extraLines += '<p class="text-xs text-gray-400 mt-1">ไมโครชิป: ' + p.microchip_id + '</p>';
            }

            return '<div class="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden hover:shadow-md transition">'
                + photo
                + '<div class="p-5">'
                + '<div class="flex items-center justify-between mb-2">'
                + '<h3 class="text-lg font-bold text-gray-900 flex items-center gap-2">' + p.name
                + (genderTxt ? '<span class="text-xs font-normal text-gray-400"><i class="fa-solid ' + (p.gender === 'Male' ? 'fa-mars' : 'fa-venus') + '"></i> ' + genderTxt + '</span>' : '')
                + '</h3>'
                + '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ' + (isOwner ? 'bg-pet-light text-pet-DEFAULT' : 'bg-green-100 text-green-700') + '">' + p.access_role + '</span>'
                + '</div>'
                + '<p class="text-sm text-gray-500">' + metaLine1 + '</p>'
                + '<p class="text-sm text-gray-500">' + metaLine2 + '</p>'
                + extraLines
                + (isOwner ? '<div class="mt-4 flex gap-2">'
                    + '<button onclick="Pets.edit(' + p.pet_id + ')" class="flex-1 px-3 py-1.5 text-sm text-pet-DEFAULT border border-pet-DEFAULT rounded-lg hover:bg-pet-light transition"><i class="fa-solid fa-pen mr-1"></i>แก้ไข</button>'
                    + '<button onclick="Pets.remove(' + p.pet_id + ')" class="px-3 py-1.5 text-sm text-red-500 border border-red-300 rounded-lg hover:bg-red-50 transition"><i class="fa-solid fa-trash"></i></button>'
                    + '</div>' : '')
                + '</div></div>';
        }).join('');
    }

    function resetPhotoInput() {
        var fileInput = document.getElementById('formPetPhoto');
        var preview = document.getElementById('formPetPhotoPreview');
        var placeholder = document.getElementById('formPetPhotoPlaceholder');
        if (fileInput) fileInput.value = '';
        if (preview) { preview.src = ''; preview.classList.add('hidden'); }
        if (placeholder) placeholder.classList.remove('hidden');
    }

    // แสดงตัวอย่างรูปที่เลือก + ตรวจชนิด/ขนาดไฟล์ทันทีตอนเลือก (ไม่ต้องรอกดบันทึกถึงจะรู้ว่าไฟล์ใช้ไม่ได้)
    function previewPhoto(input) {
        var file = input.files && input.files[0];
        if (!file) return;

        if (!/^image\//.test(file.type)) {
            alert('กรุณาเลือกไฟล์รูปภาพเท่านั้น');
            input.value = '';
            return;
        }
        if (file.size > MAX_PHOTO_BYTES) {
            alert('ไฟล์รูปภาพต้องมีขนาดไม่เกิน 5MB');
            input.value = '';
            return;
        }

        var preview = document.getElementById('formPetPhotoPreview');
        var placeholder = document.getElementById('formPetPhotoPlaceholder');
        if (preview) {
            preview.src = URL.createObjectURL(file);
            preview.classList.remove('hidden');
        }
        if (placeholder) placeholder.classList.add('hidden');
    }

    function openModal(pet) {
        document.getElementById('formPetId').value = pet ? pet.pet_id : '';
        document.getElementById('formPetExistingPhoto').value = pet ? (pet.photo_url || '') : '';
        document.getElementById('formPetName').value = pet ? pet.name : '';
        document.getElementById('formPetType').value = pet ? (pet.pet_type || '') : '';
        document.getElementById('formPetGender').value = pet ? (pet.gender || '') : '';
        document.getElementById('formPetBreed').value = pet ? (pet.breed || '') : '';
        document.getElementById('formPetAge').value = pet ? (pet.age || '') : '';
        document.getElementById('formPetWeight').value = pet ? (pet.weight_kg || '') : '';
        document.getElementById('formPetBirthDate').value = pet ? (pet.birth_date || '') : '';
        document.getElementById('formPetAdoptionDate').value = pet ? (pet.adoption_date || '') : '';
        document.getElementById('formPetMicrochip').value = pet ? (pet.microchip_id || '') : '';

        resetPhotoInput();
        var preview = document.getElementById('formPetPhotoPreview');
        var placeholder = document.getElementById('formPetPhotoPlaceholder');
        if (pet && pet.photo_url && preview && placeholder) {
            preview.src = pet.photo_url;
            preview.classList.remove('hidden');
            placeholder.classList.add('hidden');
        }

        document.getElementById('petModalTitle').textContent = pet ? 'แก้ไขสัตว์เลี้ยง' : 'เพิ่มสัตว์เลี้ยงใหม่';
        document.getElementById('petModal').classList.remove('hidden');
    }

    function closeModal() { document.getElementById('petModal').classList.add('hidden'); }

    function edit(petId) {
        var pet = _pets.find(function(p) { return p.pet_id === petId; });
        if (pet) openModal(pet);
    }

    function setSaving(saving) {
        var btn = document.getElementById('petSaveBtn');
        if (!btn) return;
        btn.disabled = saving;
        btn.innerHTML = saving ? '<i class="fa-solid fa-spinner fa-spin mr-1"></i>กำลังบันทึก...' : 'บันทึก';
    }

    function uploadPetPhoto(file) {
        var ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
        var path = uuid() + '.' + ext;
        return Api.uploadFile('pet-photos', path, file);
    }

    function save() {
        var id = document.getElementById('formPetId').value;
        var name = document.getElementById('formPetName').value.trim();
        var petType = document.getElementById('formPetType').value;
        var gender = document.getElementById('formPetGender').value;
        var breed = document.getElementById('formPetBreed').value.trim();
        var age = document.getElementById('formPetAge').value;
        var weight = document.getElementById('formPetWeight').value;
        var birthDate = document.getElementById('formPetBirthDate').value;
        var adoptionDate = document.getElementById('formPetAdoptionDate').value;
        var microchip = document.getElementById('formPetMicrochip').value.trim();
        var existingPhoto = document.getElementById('formPetExistingPhoto').value;
        var fileInput = document.getElementById('formPetPhoto');
        var file = fileInput && fileInput.files && fileInput.files[0];

        if (!name) { alert('กรุณากรอกชื่อสัตว์เลี้ยง'); return; }
        if (!petType) { alert('กรุณาเลือกประเภทของสัตว์เลี้ยง'); return; }
        if (!gender) { alert('กรุณาเลือกเพศ'); return; }
        // เช็คไฟล์ซ้ำอีกรอบตอนบันทึก เผื่อ event onchange ตอนเลือกไฟล์ไม่ได้ทำงาน
        if (file && (!/^image\//.test(file.type) || file.size > MAX_PHOTO_BYTES)) {
            alert('ไฟล์รูปภาพไม่ถูกต้อง (ต้องเป็นรูปภาพและขนาดไม่เกิน 5MB)');
            return;
        }

        var data = {
            name: name,
            pet_type: petType,
            gender: gender,
            breed: breed || null,
            age: age ? Number(age) : null,
            weight_kg: weight ? Number(weight) : null,
            birth_date: birthDate || null,
            adoption_date: adoptionDate || null,
            microchip_id: microchip || null
        };

        setSaving(true);

        var uploadPromise = file ? uploadPetPhoto(file) : Promise.resolve(null);

        uploadPromise.then(function(uploadedUrl) {
            data.photo_url = uploadedUrl || existingPhoto || null;

            if (id) {
                return Api.update('pets', 'pet_id=eq.' + id, data);
            }
            return Api.insert('pets', data).then(function(newPet) {
                var created = Array.isArray(newPet) ? newPet[0] : newPet;
                var user = Auth.getUser();
                if (user && user.user_id && created && created.pet_id) {
                    // ผู้สร้างสัตว์เลี้ยงตัวนี้ต้องเป็น Owner ของสัตว์เลี้ยงตัวนี้เสมอ
                    // (ไม่ใช่ role ระดับบัญชีของ user ซึ่งอาจเป็น 'Co-caretaker' ก็ได้)
                    // มิฉะนั้น pets_delete/pets_update policy (user_is_pet_owner) จะบล็อกไม่ให้แก้ไข/ลบสัตว์เลี้ยงตัวเองในภายหลัง
                    return Api.insert('pet_access', {
                        pet_id: created.pet_id,
                        user_id: user.user_id,
                        access_role: 'Owner'
                    }).catch(function(err) {
                        console.warn('Could not insert pet_access record:', err);
                    }).then(function() {
                        return created;
                    });
                }
                return created;
            });
        }).then(function() {
            setSaving(false);
            closeModal();
            load();
        }).catch(function(e) {
            console.error('Save pet error:', e);
            setSaving(false);
            alert('เกิดข้อผิดพลาด: ' + (e.message || e));
        });
    }

    function remove(petId) {
        if (!confirm('ต้องการลบสัตว์เลี้ยงตัวนี้จริงหรือไม่?')) return;
        Api.remove('pets', 'pet_id=eq.' + petId)
            .then(function() { load(); })
            .catch(function(err) { alert('ไม่สามารถลบสัตว์เลี้ยงได้: ' + (err.message || err)); });
    }

    return { init: init, load: load, openModal: openModal, closeModal: closeModal, edit: edit, save: save, remove: remove, previewPhoto: previewPhoto };
})();
