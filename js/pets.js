/**
 * Pets Module
 * จัดการสัตว์เลี้ยง (CRUD)
 */
var Pets = (function() {

    var _pets = [];
    var _familyPetId = null;
    var _archivePetId = null;

    // รูปสัตว์เลี้ยง: bucket แบบ private (migration 20260930000000_pet_photos.sql)
    // pets.image_url เก็บ path ใน bucket รูปแบบ <pet_id>/<timestamp>.<ext>
    var PHOTO_BUCKET = 'pet-photos';
    var PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
    var PHOTO_MAX_BYTES = 5 * 1024 * 1024;
    var PHOTO_MAX_DIM = 1280;
    var _photoUrls = {};
    var _photoBlob = null;
    var _photoRemoved = false;
    var _editingImagePath = null;

    function init() {
        return load();
    }

    // ดึงสัตว์เลี้ยงที่ยังไม่ถูกเก็บเข้าคลังแบบกันพัง: ถ้าฐานข้อมูลจริงยังไม่ได้รัน
    // migration 20260908000000_pet_archive.sql (ที่เพิ่มคอลัมน์ is_archived) query แรก
    // จะ error เพราะคอลัมน์ยังไม่มี — ให้ลองดึงแบบไม่กรองคอลัมน์นี้แทน (เห็นสัตว์เลี้ยงครบ
    // ทุกตัวไปก่อน) แทนที่จะปล่อยให้หน้ารายชื่อสัตว์เลี้ยงพังทั้งหน้าเพราะ query เดียวพัง
    function queryActivePetsResilient(selectFields) {
        return Api.query('pets', selectFields + '&is_archived=eq.false&order=pet_id.asc')
        .catch(function(err) {
            console.warn('pets query with is_archived failed, falling back (migration not applied yet?):', err);
            return Api.query('pets', selectFields + '&order=pet_id.asc');
        });
    }

    // ดึงคอลัมน์ครบชุด (type/gender/breed/weight/birthdate/adoption_date/microchip)
    // เพื่อให้เปิดฟอร์มแก้ไขแล้วเห็นค่าที่กรอกไว้ครบ — ถ้าฐานข้อมูลจริงไม่มีคอลัมน์
    // เหล่านี้เลย ให้ถอยกลับไปดึงแค่ชุดคอลัมน์เดิมแทน กันหน้ารายชื่อสัตว์เลี้ยงพังทั้งหน้า
    // ส่วนชื่อคอลัมน์จริงในตาราง pets ไม่ตรงกับที่ mapPet()/openModal() ใช้กัน (ของจริง
    // ในฐานข้อมูลตั้งชื่อ pet_type/weight_kg/birth_date/microchip_id ไม่ใช่ type/weight/
    // birthdate/microchip ดูรายละเอียดที่ 20260910000000_fix_pet_schema_drift.sql) เลยใช้
    // PostgREST column alias (alias:column) แปลงชื่อกลับตอน query แทนที่จะไปแก้
    // mapPet()/openModal() ทุกจุด
    var PET_FIELDS_FULL = 'pet_id,name,type_breed,type:pet_type,gender,breed,age,weight:weight_kg,birthdate:birth_date,adoption_date,microchip:microchip_id';
    var PET_FIELDS_BASIC = 'pet_id,name,type_breed,age';

    function queryPetsWithFallback() {
        return queryActivePetsResilient('select=' + PET_FIELDS_FULL)
        .catch(function(err) {
            console.warn('pets query with extended fields failed, falling back to basic fields:', err);
            return queryActivePetsResilient('select=' + PET_FIELDS_BASIC);
        });
    }

    function mapPet(p, accessRole) {
        return {
            pet_id: p.pet_id,
            name: p.name,
            type_breed: p.type_breed,
            type: p.type,
            gender: p.gender,
            breed: p.breed,
            age: p.age,
            weight: p.weight,
            birthdate: p.birthdate,
            adoption_date: p.adoption_date,
            microchip: p.microchip,
            access_role: accessRole
        };
    }

    function load() {
        var grid = document.getElementById('petsGrid');
        if (grid) {
            grid.innerHTML = '<div class="col-span-full text-center py-12 text-gray-400"><i class="fa-solid fa-spinner fa-spin mr-2"></i>กำลังโหลดสัตว์เลี้ยง...</div>';
        }

        var user = Auth.getUser();
        var userId = (user && user.user_id) ? user.user_id : null;

        // ดึงข้อมูลสัตว์เลี้ยงทั้งหมดทันทีในคำขอเดียว (รวดเร็วมาก)
        // ไม่รวมตัวที่เก็บเข้าคลังแล้ว (is_archived=true) — ดูได้ที่หน้าโปรไฟล์แทน
        var petsPromise = queryPetsWithFallback();

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
                return mapPet(p, accessMap[p.pet_id] || (user && user.role ? user.role : 'Owner'));
            });
            render();
        }).catch(function(err) {
            console.error('Pets load error:', err);
            // Fallback: หาก query คู่ขนานมีปัญหา ให้ดึงเฉพาะ pets ตารางหลักตรงๆ
            return queryPetsWithFallback()
            .then(function(pets) {
                _pets = (pets || []).map(function(p) { return mapPet(p, 'Owner'); });
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
            var cachedPhoto = p.image_url && _photoUrls[p.image_url];
            return '<div class="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden hover:shadow-md transition">'
                + '<div id="petPhoto-' + p.pet_id + '" class="h-32 bg-gradient-to-br from-pet-light to-blue-100 flex items-center justify-center text-6xl overflow-hidden">'
                + (cachedPhoto ? photoImgHtml(cachedPhoto) : emoji) + '</div>'
                + '<div class="p-5">'
                + '<div class="flex items-center justify-between mb-2">'
                + '<h3 class="text-lg font-bold text-gray-900">' + p.name + '</h3>'
                + '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ' + (isOwner ? 'bg-pet-light text-pet' : 'bg-green-100 text-green-700') + '">' + p.access_role + '</span>'
                + '</div>'
                + '<p class="text-sm text-gray-500">' + (p.type_breed || 'ไม่ระบุพันธุ์') + '</p>'
                + '<p class="text-sm text-gray-500">' + (p.age ? p.age + ' ปี' : 'ไม่ระบุอายุ') + '</p>'
                // Co-caretaker แก้ไขข้อมูลโปรไฟล์สัตว์เลี้ยงได้ แต่จัดการครอบครัว/เก็บเข้าคลัง/
                // ลบถาวรได้เฉพาะ Owner เท่านั้น (บังคับจริงที่ RLS ฝั่งฐานข้อมูลด้วย ไม่ใช่แค่ซ่อนปุ่ม)
                + '<div class="mt-4 flex gap-2">'
                    + '<button onclick="Pets.edit(' + p.pet_id + ')" class="flex-1 btn btn-sm btn-outline-primary"><i class="fa-solid fa-pen mr-1"></i>แก้ไข</button>'
                    + (isOwner ? '<button onclick="Pets.manageFamily(' + p.pet_id + ')" class="btn btn-sm btn-outline-primary" title="จัดการครอบครัว"><i class="fa-solid fa-users"></i></button>'
                    + '<button onclick="Pets.archive(' + p.pet_id + ')" class="btn btn-sm btn-warning" title="เก็บเข้าคลัง"><i class="fa-solid fa-box-archive"></i></button>'
                    + '<button onclick="Pets.remove(' + p.pet_id + ')" class="btn btn-sm btn-danger" title="ลบถาวร"><i class="fa-solid fa-trash"></i></button>' : '')
                    + '</div>'
                + '</div></div>';
        }).join('');
        loadPhotos();
    }

    function photoImgHtml(url) {
        return '<img src="' + url + '" alt="" class="w-full h-full object-cover">';
    }

    // โหลดรูปแยกจาก query หลักโดยตั้งใจ: ถ้าคอลัมน์ image_url หรือ bucket ยังไม่มี
    // (migration ยังไม่ได้รัน) การ์ดสัตว์เลี้ยงยังแสดงผลครบด้วย emoji เหมือนเดิม
    function loadPhotos() {
        var ids = _pets.map(function(p) { return p.pet_id; });
        if (!ids.length) return;
        Api.query('pets', 'select=pet_id,image_url&pet_id=in.(' + ids.join(',') + ')')
        .then(function(rows) {
            (rows || []).forEach(function(row) {
                var pet = _pets.find(function(p) { return p.pet_id === row.pet_id; });
                if (!pet) return;
                pet.image_url = row.image_url || null;
                if (!pet.image_url) return;
                getPhotoUrl(pet.image_url).then(function(url) {
                    var el = document.getElementById('petPhoto-' + pet.pet_id);
                    if (el && pet.image_url && _photoUrls[pet.image_url] === url) el.innerHTML = photoImgHtml(url);
                }).catch(function(err) {
                    console.warn('Load pet photo failed:', err);
                });
            });
        }).catch(function(err) {
            console.warn('Pet photo query failed (image_url column missing?):', err);
        });
    }

    function getPhotoUrl(path) {
        if (_photoUrls[path]) return Promise.resolve(_photoUrls[path]);
        return Api.downloadFileAsBlobUrl(PHOTO_BUCKET, path).then(function(url) {
            _photoUrls[path] = url;
            return url;
        });
    }

    function showPhotoMsg(text) {
        var msg = document.getElementById('petPhotoMsg');
        if (!msg) return;
        msg.textContent = text || '';
        msg.classList.toggle('hidden', !text);
    }

    function showPhotoPreview(url) {
        var wrap = document.getElementById('petPhotoPreviewWrap');
        var img = document.getElementById('petPhotoPreview');
        if (!wrap || !img) return;
        if (url) {
            img.src = url;
            wrap.classList.remove('hidden');
        } else {
            img.removeAttribute('src');
            wrap.classList.add('hidden');
        }
    }

    // ย่อรูปใหญ่ให้ด้านยาวสุดไม่เกิน PHOTO_MAX_DIM แล้วบันทึกเป็น JPEG เพื่อให้ไฟล์เล็ก
    // และโหลดเร็ว (รูปจากมือถือมักเกิน 5MB) — รูปเล็กอยู่แล้วส่งไฟล์เดิมไปเลย
    function preparePhoto(file) {
        if (PHOTO_TYPES.indexOf(file.type) < 0) {
            return Promise.reject(new Error('ไฟล์รูปต้องเป็น .jpg, .png หรือ .webp เท่านั้น'));
        }
        return new Promise(function(resolve, reject) {
            var srcUrl = URL.createObjectURL(file);
            var img = new Image();
            img.onload = function() {
                URL.revokeObjectURL(srcUrl);
                var longest = Math.max(img.naturalWidth, img.naturalHeight);
                if (longest <= PHOTO_MAX_DIM && file.size <= 1024 * 1024) { resolve(file); return; }
                var scale = Math.min(1, PHOTO_MAX_DIM / longest);
                var canvas = document.createElement('canvas');
                canvas.width = Math.round(img.naturalWidth * scale);
                canvas.height = Math.round(img.naturalHeight * scale);
                var ctx = canvas.getContext('2d');
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                canvas.toBlob(function(blob) {
                    resolve(blob || file);
                }, 'image/jpeg', 0.85);
            };
            img.onerror = function() {
                URL.revokeObjectURL(srcUrl);
                reject(new Error('เปิดไฟล์รูปนี้ไม่ได้ กรุณาเลือกรูปอื่น'));
            };
            img.src = srcUrl;
        }).then(function(blob) {
            if (blob.size > PHOTO_MAX_BYTES) throw new Error('รูปมีขนาดใหญ่เกิน 5MB กรุณาเลือกรูปที่เล็กลง');
            return blob;
        });
    }

    function onPhotoChange(input) {
        var file = input.files && input.files[0];
        showPhotoMsg('');
        if (!file) return;
        preparePhoto(file).then(function(blob) {
            _photoBlob = blob;
            _photoRemoved = false;
            showPhotoPreview(URL.createObjectURL(blob));
        }).catch(function(err) {
            _photoBlob = null;
            input.value = '';
            showPhotoMsg(err.message || String(err));
        });
    }

    function removePhoto() {
        _photoBlob = null;
        _photoRemoved = true;
        var input = document.getElementById('formPetImage');
        if (input) input.value = '';
        showPhotoMsg('');
        showPhotoPreview(null);
    }

    function photoExtension(blob) {
        if (blob.type === 'image/png') return 'png';
        if (blob.type === 'image/webp') return 'webp';
        return 'jpg';
    }

    // เรียกหลังบันทึกข้อมูลสัตว์เลี้ยงสำเร็จแล้วเท่านั้น ถ้าส่วนรูปพัง ข้อมูลสัตว์เลี้ยงยังอยู่ครบ
    function applyPhotoChange(petId, oldPath) {
        if (_photoBlob) {
            var path = petId + '/' + Date.now() + '.' + photoExtension(_photoBlob);
            return Api.uploadFile(PHOTO_BUCKET, path, _photoBlob)
                .then(function() { return Api.update('pets', 'pet_id=eq.' + petId, { image_url: path }); })
                .then(function() {
                    if (oldPath && oldPath !== path) {
                        Api.removeFile(PHOTO_BUCKET, oldPath).catch(function(err) { console.warn('Remove old pet photo failed:', err); });
                    }
                });
        }
        if (_photoRemoved && oldPath) {
            return Api.update('pets', 'pet_id=eq.' + petId, { image_url: null }).then(function() {
                Api.removeFile(PHOTO_BUCKET, oldPath).catch(function(err) { console.warn('Remove pet photo failed:', err); });
            });
        }
        return Promise.resolve();
    }

    // chk_pets_gender ในฐานข้อมูลจริงยอมรับเฉพาะค่าภาษาอังกฤษ (Male/Female)
    // แต่ dropdown ในฟอร์มใช้ค่าภาษาไทย (ผู้/เมีย) ต้องแปลงไปมาตรงนี้
    function mapGenderToDb(genderUi) {
        if (genderUi === 'ผู้') return 'Male';
        if (genderUi === 'เมีย') return 'Female';
        return genderUi;
    }

    function mapGenderToUi(genderDb) {
        if (genderDb === 'Male') return 'ผู้';
        if (genderDb === 'Female') return 'เมีย';
        return genderDb || '';
    }

    function openModal(pet) {
        document.getElementById('formPetId').value = pet ? pet.pet_id : '';
        document.getElementById('formPetName').value = pet ? pet.name : '';
        document.getElementById('formPetType').value = pet ? (pet.type || '') : '';
        document.getElementById('formPetGender').value = pet ? mapGenderToUi(pet.gender) : '';
        document.getElementById('formPetBreed').value = pet ? (pet.breed || pet.type_breed || '') : '';
        document.getElementById('formPetAge').value = pet ? (pet.age || '') : '';
        document.getElementById('formPetWeight').value = pet ? (pet.weight || '') : '';
        document.getElementById('formPetBirthdate').value = pet ? (pet.birthdate || '') : '';
        document.getElementById('formPetAdoptionDate').value = pet ? (pet.adoption_date || '') : '';
        document.getElementById('formPetMicrochip').value = pet ? (pet.microchip || '') : '';
        document.getElementById('petModalTitle').textContent = pet ? 'แก้ไขสัตว์เลี้ยง' : 'เพิ่มสัตว์เลี้ยงใหม่';
        _photoBlob = null;
        _photoRemoved = false;
        _editingImagePath = pet ? (pet.image_url || null) : null;
        var photoInput = document.getElementById('formPetImage');
        if (photoInput) photoInput.value = '';
        showPhotoMsg('');
        showPhotoPreview(_editingImagePath ? (_photoUrls[_editingImagePath] || null) : null);
        document.getElementById('petModal').classList.remove('hidden');
    }

    function closeModal() { document.getElementById('petModal').classList.add('hidden'); }

    function edit(petId) {
        var pet = _pets.find(function(p) { return p.pet_id === petId; });
        if (pet) openModal(pet);
    }

    function save() {
        var id = document.getElementById('formPetId').value;
        var breed = document.getElementById('formPetBreed').value.trim() || null;
        var genderUi = document.getElementById('formPetGender').value;
        var typeVal = document.getElementById('formPetType').value.trim();
        var ageVal = document.getElementById('formPetAge').value ? Number(document.getElementById('formPetAge').value) : null;
        var name = document.getElementById('formPetName').value.trim();
        if (!name) { alert('กรุณากรอกชื่อสัตว์เลี้ยง'); return; }
        if (!typeVal) { alert('กรุณากรอกประเภทสัตว์เลี้ยง'); return; }
        if (!genderUi) { alert('กรุณาเลือกเพศ'); return; }
        if (ageVal === null) { alert('กรุณากรอกอายุ'); return; }

        var promise;
        if (id) {
            // แก้ไขสัตว์เลี้ยงเดิม: ใช้ชื่อคอลัมน์จริงในตาราง pets (ไม่ตรงกับชื่อที่
            // migration ในโค้ดสมมติไว้ — ของจริงคือ pet_type/weight_kg/birth_date/
            // microchip_id ดูรายละเอียดที่ 20260910000000_fix_pet_schema_drift.sql)
            promise = Api.update('pets', 'pet_id=eq.' + id, {
                name: name,
                pet_type: typeVal,
                gender: mapGenderToDb(genderUi),
                type_breed: breed,
                breed: breed,
                age: ageVal,
                weight_kg: document.getElementById('formPetWeight').value ? Number(document.getElementById('formPetWeight').value) : null,
                birth_date: document.getElementById('formPetBirthdate').value || null,
                adoption_date: document.getElementById('formPetAdoptionDate').value || null,
                microchip_id: document.getElementById('formPetMicrochip').value.trim() || null
            });
        } else {
            // ใช้ RPC create_pet_with_owner แทนการ insert pets + pet_access แยกกัน 2 request
            // เพราะถ้า insert เข้า pets เฉยๆ ก่อน แถวที่เพิ่ง insert จะยังไม่มีสิทธิ์ใน
            // pet_access เลย ทำให้ Postgres ปฏิเสธตอน RETURNING แถวกลับมาด้วย error
            // "new row violates row-level security policy for table pets" (ดูรายละเอียด
            // ที่ migration 20260909000000_create_pet_with_owner.sql) — ฟังก์ชันนี้ insert
            // ทั้งสองตารางในทรานแซกชันเดียวกัน ปิดช่องว่างนั้นไปเลย (ฟังก์ชันแปลงค่า
            // เพศเป็นภาษาอังกฤษให้เองอยู่แล้วด้วย)
            promise = Api.rpc('create_pet_with_owner', {
                p_name: name,
                p_type: typeVal,
                p_gender: mapGenderToDb(genderUi),
                p_age: ageVal,
                p_type_breed: breed,
                p_breed: breed,
                p_weight: document.getElementById('formPetWeight').value ? Number(document.getElementById('formPetWeight').value) : null,
                p_birthdate: document.getElementById('formPetBirthdate').value || null,
                p_adoption_date: document.getElementById('formPetAdoptionDate').value || null,
                p_microchip: document.getElementById('formPetMicrochip').value.trim() || null
            });
        }

        var saveBtn = document.getElementById('petSaveBtn');
        if (saveBtn) saveBtn.disabled = true;
        var oldPath = id ? _editingImagePath : null;

        promise.then(function(result) {
            var row = Array.isArray(result) ? result[0] : result;
            var petId = id ? Number(id) : (row && row.pet_id);
            var photoStep = petId ? applyPhotoChange(petId, oldPath) : Promise.resolve();
            if (!petId && _photoBlob) console.warn('Pet saved but new pet_id not returned; photo skipped');
            return photoStep.catch(function(err) {
                console.error('Save pet photo error:', err);
                alert('บันทึกข้อมูลสัตว์เลี้ยงแล้ว แต่บันทึกรูปภาพไม่สำเร็จ: ' + (err.message || err));
            });
        }).then(function() {
            closeModal();
            load();
        }).catch(function(e) {
            console.error('Save pet error:', e);
            alert('เกิดข้อผิดพลาด: ' + (e.message || e));
        }).then(function() {
            if (saveBtn) saveBtn.disabled = false;
        });
    }

    // === เก็บเข้าคลัง (Pet Archive) แทนการลบถาวร เมื่อสัตว์เลี้ยงเสียชีวิตหรือย้ายไปอยู่
    // ในความดูแลของผู้อื่น — ประวัติค่าใช้จ่ายเดิมยังอยู่ครบ แค่ไม่โผล่ในหน้านี้อีกต่อไป
    // ดูย้อนหลังได้ที่หน้าโปรไฟล์ (Profile.js: คลังสัตว์เลี้ยง) ===
    function archive(petId) {
        _archivePetId = petId;
        var pet = _pets.find(function(p) { return p.pet_id === petId; });
        document.getElementById('archiveModalPetName').textContent = pet ? pet.name : '';
        document.getElementById('archiveReason').value = 'เสียชีวิต';
        document.getElementById('archiveOtherNote').value = '';
        document.getElementById('archiveOtherNoteWrap').classList.add('hidden');
        document.getElementById('archiveMsg').classList.add('hidden');
        document.getElementById('archiveModal').classList.remove('hidden');
    }

    function closeArchiveModal() {
        document.getElementById('archiveModal').classList.add('hidden');
        _archivePetId = null;
    }

    function onArchiveReasonChange() {
        var reason = document.getElementById('archiveReason').value;
        document.getElementById('archiveOtherNoteWrap').classList.toggle('hidden', reason !== '__other__');
    }

    function confirmArchive() {
        if (!_archivePetId) return;
        var msg = document.getElementById('archiveMsg');
        var reason = document.getElementById('archiveReason').value;
        var note = reason === '__other__' ? document.getElementById('archiveOtherNote').value.trim() : reason;

        if (!note) {
            msg.textContent = 'กรุณาระบุรายละเอียด';
            msg.classList.remove('hidden');
            return;
        }

        Api.update('pets', 'pet_id=eq.' + _archivePetId, {
            is_archived: true,
            archived_note: note,
            archived_at: new Date().toISOString()
        }).then(function() {
            closeArchiveModal();
            load();
        }).catch(function(err) {
            msg.textContent = 'ไม่สามารถเก็บเข้าคลังได้: ' + (err.message || err);
            msg.classList.remove('hidden');
        });
    }

    // ลบถาวร — ต่างจาก "เก็บเข้าคลัง" ตรงที่ลบแถวออกจากตารางจริง (CASCADE ลบรายจ่าย/
    // งบประมาณ/แจ้งเตือนที่ผูกกับสัตว์เลี้ยงตัวนี้ไปด้วยตาม schema) กู้คืนไม่ได้อีก
    // เหมาะกับกรณีลบโปรไฟล์ที่สร้างผิด/ซ้ำ ไม่ใช่กรณีสัตว์เลี้ยงเสียชีวิต/ย้ายไปแล้ว
    // (แนะนำให้ใช้ "เก็บเข้าคลัง" แทนถ้าต้องการรักษาประวัติค่าใช้จ่ายเดิมไว้)
    function remove(petId) {
        if (!confirm('ต้องการลบสัตว์เลี้ยงตัวนี้ถาวรหรือไม่?\n\nการลบถาวรจะลบประวัติค่าใช้จ่าย งบประมาณ และการแจ้งเตือนที่ผูกกับสัตว์เลี้ยงตัวนี้ทั้งหมด และกู้คืนไม่ได้\n\nถ้าสัตว์เลี้ยงเสียชีวิตหรือย้ายไปอยู่ในความดูแลของผู้อื่น แนะนำให้ใช้ "เก็บเข้าคลัง" แทน เพื่อรักษาประวัติไว้')) return;
        var pet = _pets.find(function(p) { return p.pet_id === petId; });
        var photoPath = pet && pet.image_url;
        Api.remove('pets', 'pet_id=eq.' + petId)
            .then(function() {
                if (photoPath) Api.removeFile(PHOTO_BUCKET, photoPath).catch(function(err) { console.warn('Remove pet photo failed:', err); });
                load();
            })
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

        Promise.all([
            Api.query('pet_access', 'select=user_id,access_role&pet_id=eq.' + _familyPetId),
            Api.query('pet_invitations', 'select=invitation_id,invited_user_id,status&pet_id=eq.' + _familyPetId + '&status=eq.pending').catch(function() { return []; })
        ])
        .then(function(results) {
            var access = results[0] || [];
            var invitations = results[1] || [];
            var userIds = access.map(function(a) { return a.user_id; })
                .concat(invitations.map(function(i) { return i.invited_user_id; }));
            if (!userIds.length) { list.innerHTML = ''; return; }
            return Api.query('users', 'select=user_id,name,email&user_id=in.(' + userIds.join(',') + ')')
            .then(function(users) {
                var userMap = {};
                (users || []).forEach(function(u) { userMap[u.user_id] = u; });

                var memberRows = access.map(function(a) {
                    var u = userMap[a.user_id] || { name: 'ไม่ทราบชื่อ', email: '' };
                    var isRoleOwner = a.access_role === 'Owner';
                    return '<div class="flex items-center gap-3 py-3 border-b border-gray-100 last:border-0">'
                        + '<img class="h-9 w-9 rounded-full object-cover" src="https://ui-avatars.com/api/?name=' + encodeURIComponent(u.name) + '&background=e0f2fe&color=0369a1" alt="">'
                        + '<div class="flex-1 min-w-0"><p class="text-sm font-medium text-gray-900 truncate">' + u.name + '</p><p class="text-xs text-gray-500 truncate">' + u.email + '</p></div>'
                        + '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ' + (isRoleOwner ? 'bg-pet-light text-pet' : 'bg-green-100 text-green-700') + '">' + a.access_role + '</span>'
                        + (isRoleOwner ? '' : '<button onclick="Pets.removeFamilyMember(' + a.user_id + ')" class="ml-1 px-2 py-1 text-red-500 hover:bg-red-50 rounded-lg transition" title="นำออก"><i class="fa-solid fa-user-xmark"></i></button>')
                        + '</div>';
                }).join('');

                var inviteRows = invitations.map(function(inv) {
                    var u = userMap[inv.invited_user_id] || { name: 'ไม่ทราบชื่อ', email: '' };
                    return '<div class="flex items-center gap-3 py-3 border-b border-gray-100 last:border-0">'
                        + '<img class="h-9 w-9 rounded-full object-cover opacity-60" src="https://ui-avatars.com/api/?name=' + encodeURIComponent(u.name) + '&background=e0f2fe&color=0369a1" alt="">'
                        + '<div class="flex-1 min-w-0"><p class="text-sm font-medium text-gray-900 truncate">' + u.name + '</p><p class="text-xs text-gray-500 truncate">' + u.email + '</p></div>'
                        + '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700">รอตอบรับ</span>'
                        + '<button onclick="Pets.cancelInvitation(' + inv.invitation_id + ')" class="ml-1 px-2 py-1 text-red-500 hover:bg-red-50 rounded-lg transition" title="ยกเลิกคำเชิญ"><i class="fa-solid fa-xmark"></i></button>'
                        + '</div>';
                }).join('');

                list.innerHTML = memberRows + inviteRows;
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

        Api.rpc('invite_co_caretaker', { p_pet_id: _familyPetId, p_email: email })
        .then(function() {
            emailInput.value = '';
            loadFamilyMembers();
        })
        .catch(function(err) {
            msg.textContent = (err && err.message) || String(err);
            msg.classList.remove('hidden');
        });
    }

    function cancelInvitation(invitationId) {
        if (!confirm('ต้องการยกเลิกคำเชิญนี้หรือไม่?')) return;
        Api.rpc('cancel_pet_invitation', { p_invitation_id: invitationId })
        .then(function() { loadFamilyMembers(); })
        .catch(function(err) { alert('ไม่สามารถยกเลิกคำเชิญได้: ' + (err.message || err)); });
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
        onPhotoChange: onPhotoChange, removePhoto: removePhoto,
        archive: archive, closeArchiveModal: closeArchiveModal, onArchiveReasonChange: onArchiveReasonChange, confirmArchive: confirmArchive,
        manageFamily: manageFamily, closeFamilyModal: closeFamilyModal, addFamilyMember: addFamilyMember,
        removeFamilyMember: removeFamilyMember, cancelInvitation: cancelInvitation
    };
})();
