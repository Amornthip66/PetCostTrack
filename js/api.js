/**
 * Supabase REST API Module
 * ช่วยเหลือสำหรับ query, count, insert, update, delete
 *
 * สำคัญ: ทุก request ต้องผ่าน authHeaders() ซึ่งเรียก Auth.ensureSession()
 * เพื่อตรวจ/ต่ออายุ session ก่อนเสมอ (access token อายุสั้น ~1 ชม.)
 * เพราะถ้าปล่อยให้ request หลุดไปแบบ "anonymous" จะโดน RLS policy
 * ปฏิเสธทันที เช่น error: new row violates row-level security policy for table "pets"
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

    // สร้าง headers หลังจากตรวจ/ต่ออายุ session แล้วเท่านั้น
    // - session หมดอายุแต่ต่ออายุได้ → ได้ access token ใหม่
    // - ต่ออายุไม่ได้ / ไม่มี session → พาไปหน้า login แล้ว throw (ห้ามส่ง request แบบ anon)
    function authHeaders(extra) {
        return Auth.ensureSession().then(function(s) {
            if (!s) {
                Auth.clearSession();
                window.location.href = 'login.html';
                throw new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่อีกครั้ง');
            }
            var h = { 'apikey': CONFIG.SB_KEY };
            if (s.access_token) {
                h['Authorization'] = 'Bearer ' + s.access_token;
            }
            return Object.assign({}, extra || {}, h);
        });
    }

    function query(table, params) {
        return authHeaders().then(function(headers) {
            return fetch(CONFIG.REST + '/' + table + '?' + params, {
                headers: headers
            }).then(function(r) {
                return safeParse(r).then(function(data) {
                    throwIfHttpError(r, data, 'Query');
                    return data || [];
                });
            });
        });
    }

    function count(table) {
        return authHeaders({
            'Prefer': 'count=exact',
            'Range-Unit': 'items',
            'Range': '0-0'
        }).then(function(headers) {
            return fetch(CONFIG.REST + '/' + table + '?select=*&limit=0', {
                headers: headers
            }).then(function(r) {
                var range = r.headers.get('content-range');
                if (range) return parseInt(range.split('/')[1]) || 0;
                return safeParse(r).then(function(data) {
                    return Array.isArray(data) ? data.length : 0;
                });
            });
        });
    }

    function insert(table, row) {
        return authHeaders({
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
        }).then(function(headers) {
            return fetch(CONFIG.REST + '/' + table, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(row)
            }).then(function(r) {
                return safeParse(r).then(function(data) {
                    return throwIfHttpError(r, data, 'Insert');
                });
            });
        });
    }

    function update(table, params, row) {
        return authHeaders({
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
        }).then(function(headers) {
            return fetch(CONFIG.REST + '/' + table + '?' + params, {
                method: 'PATCH',
                headers: headers,
                body: JSON.stringify(row)
            }).then(function(r) {
                return safeParse(r).then(function(data) {
                    return throwIfHttpError(r, data, 'Update');
                });
            });
        });
    }

    function remove(table, params) {
        return authHeaders({
            'Prefer': 'return=representation'
        }).then(function(headers) {
            return fetch(CONFIG.REST + '/' + table + '?' + params, {
                method: 'DELETE',
                headers: headers
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
        });
    }

    function rpc(fn, params) {
        return authHeaders({
            'Content-Type': 'application/json'
        }).then(function(headers) {
            return fetch(CONFIG.REST + '/rpc/' + fn, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(params || {})
            }).then(function(r) {
                return safeParse(r).then(function(data) {
                    return throwIfHttpError(r, data, 'RPC ' + fn);
                });
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
