/**
 * Supabase REST API Module
 * ช่วยเหลือสำหรับ query, count, insert, update, delete
 */
var Api = (function() {

    // อ่าน response อย่างปลอดภัยเสมอ: ห้ามเรียก r.json() ตรงๆ เด็ดขาด
    // เพราะถ้า body ว่าง (เช่น 204 No Content หรือ DELETE ที่ไม่มี row ถูกลบ)
    // r.json() จะโยน error "Unexpected end of JSON input" ทันที
    function safeParse(r) {
        if (r.status === 204) return Promise.resolve(null);
        return r.text().then(function(text) {
            if (!text || !text.trim()) return null;
            try {
                return JSON.parse(text);
            } catch (e) {
                console.warn('Response is not valid JSON:', text);
                return null;
            }
        });
    }

    function throwIfHttpError(r, data, action) {
        if (!r.ok) {
            var msg = (data && (data.message || data.error || data.details)) || (action + ' failed (' + r.status + ')');
            throw new Error(msg);
        }
        return data;
    }

    function query(table, params) {
        return fetch(CONFIG.REST + '/' + table + '?' + params, {
            headers: Auth.headers()
        }).then(function(r) {
            return safeParse(r).then(function(data) {
                throwIfHttpError(r, data, 'Query');
                return data || [];
            });
        });
    }

    function count(table) {
        return fetch(CONFIG.REST + '/' + table + '?select=*&limit=0', {
            headers: Object.assign({
                'Prefer': 'count=exact',
                'Range-Unit': 'items',
                'Range': '0-0'
            }, Auth.headers())
        }).then(function(r) {
            var range = r.headers.get('content-range');
            if (range) return parseInt(range.split('/')[1]) || 0;
            return safeParse(r).then(function(data) {
                return Array.isArray(data) ? data.length : 0;
            });
        });
    }

    function insert(table, row) {
        return fetch(CONFIG.REST + '/' + table, {
            method: 'POST',
            headers: Object.assign({
                'Content-Type': 'application/json',
                'Prefer': 'return=representation'
            }, Auth.headers()),
            body: JSON.stringify(row)
        }).then(function(r) {
            return safeParse(r).then(function(data) {
                return throwIfHttpError(r, data, 'Insert');
            });
        });
    }

    function update(table, params, row) {
        return fetch(CONFIG.REST + '/' + table + '?' + params, {
            method: 'PATCH',
            headers: Object.assign({
                'Content-Type': 'application/json',
                'Prefer': 'return=representation'
            }, Auth.headers()),
            body: JSON.stringify(row)
        }).then(function(r) {
            return safeParse(r).then(function(data) {
                return throwIfHttpError(r, data, 'Update');
            });
        });
    }

    function remove(table, params) {
        return fetch(CONFIG.REST + '/' + table + '?' + params, {
            method: 'DELETE',
            headers: Object.assign({
                'Prefer': 'return=representation'
            }, Auth.headers())
        }).then(function(r) {
            return safeParse(r).then(function(data) {
                throwIfHttpError(r, data, 'Delete');
                // Supabase/PostgREST: ถ้าลบ "สำเร็จ" ในแง่ HTTP แต่ไม่มี row ไหนตรงเงื่อนไขเลย
                // (โดนนโยบาย RLS บล็อก หรือแถวนั้นถูกลบไปแล้วก่อนหน้า) จะได้ array ว่างกลับมา
                // แทนที่จะปล่อยให้ดูเหมือนลบสำเร็จทั้งที่จริงไม่มีอะไรถูกลบ เราแจ้งเตือนให้ชัดเจน
                if (Array.isArray(data) && data.length === 0) {
                    throw new Error('ไม่พบข้อมูลที่จะลบ หรือคุณไม่มีสิทธิ์ลบรายการนี้');
                }
                return data;
            });
        });
    }

    function rpc(fn, params) {
        return fetch(CONFIG.REST + '/rpc/' + fn, {
            method: 'POST',
            headers: Object.assign({
                'Content-Type': 'application/json'
            }, Auth.headers()),
            body: JSON.stringify(params || {})
        }).then(function(r) {
            return safeParse(r).then(function(data) {
                return throwIfHttpError(r, data, 'RPC ' + fn);
            });
        });
    }

    // === Supabase Storage (ไฟล์แนบ เช่น รูปใบเสร็จ) ===
    // อัปโหลดไฟล์ทับตำแหน่งเดิมได้เสมอ (x-upsert) เพราะแต่ละรายการค่าใช้จ่ายมี
    // ใบเสร็จได้แค่ใบเดียว แนบใหม่ = เขียนทับไฟล์เดิมที่ path เดิม ไม่ต้องลบเองก่อน
    // ไม่ตั้ง Content-Type เอง ปล่อยให้ browser ใส่ตาม file.type ให้อัตโนมัติ
    function uploadFile(bucket, path, file) {
        return fetch(CONFIG.STORAGE + '/object/' + bucket + '/' + path, {
            method: 'POST',
            headers: Object.assign({ 'x-upsert': 'true' }, Auth.headers()),
            body: file
        }).then(function(r) {
            return safeParse(r).then(function(data) {
                return throwIfHttpError(r, data, 'Upload');
            });
        });
    }

    // ดาวน์โหลดไฟล์จาก bucket ส่วนตัว (ต้องส่ง Authorization ไปด้วยเสมอ เพราะ RLS
    // บน storage.objects ไม่ใช่ bucket แบบ public) แล้วแปลงเป็น blob URL ให้ <img> ใช้ได้ตรงๆ
    function downloadFileAsBlobUrl(bucket, path) {
        return fetch(CONFIG.STORAGE + '/object/' + bucket + '/' + path, {
            headers: Auth.headers()
        }).then(function(r) {
            if (!r.ok) throw new Error('ไม่สามารถโหลดรูปใบเสร็จได้ (' + r.status + ')');
            return r.blob();
        }).then(function(blob) {
            return URL.createObjectURL(blob);
        });
    }

    function removeFile(bucket, path) {
        return fetch(CONFIG.STORAGE + '/object/' + bucket + '/' + path, {
            method: 'DELETE',
            headers: Auth.headers()
        }).then(function(r) {
            // 404 ถือว่าไม่มีอะไรต้องลบอยู่แล้ว ไม่ต้องรายงาน error
            if (!r.ok && r.status !== 404) throw new Error('ลบไฟล์ไม่สำเร็จ (' + r.status + ')');
        });
    }

    return {
        query: query,
        count: count,
        insert: insert,
        update: update,
        remove: remove,
        rpc: rpc,
        uploadFile: uploadFile,
        downloadFileAsBlobUrl: downloadFileAsBlobUrl,
        removeFile: removeFile
    };
})();
