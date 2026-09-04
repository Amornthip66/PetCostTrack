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

    return {
        query: query,
        count: count,
        insert: insert,
        update: update,
        remove: remove,
        rpc: rpc
    };
})();
