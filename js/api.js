/**
 * Supabase REST API Module
 * ช่วยเหลือสำหรับ query, count, insert, update, delete
 */
var Api = (function() {

    function query(table, params) {
        return fetch(CONFIG.REST + '/' + table + '?' + params, {
            headers: Auth.headers()
        }).then(function(r) {
            if (!r.ok) throw new Error('API Error: ' + r.status);
            if (r.status === 204) return [];
            return r.text().then(function(text) {
                if (!text || !text.trim()) return [];
                try { return JSON.parse(text); } catch(e) { return []; }
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
            if (r.status === 204) return 0;
            return r.text().then(function(text) {
                if (!text || !text.trim()) return 0;
                try {
                    var d = JSON.parse(text);
                    return Array.isArray(d) ? d.length : 0;
                } catch(e) {
                    return 0;
                }
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
            if (r.status === 204) return null;
            return r.text().then(function(text) {
                var data = null;
                if (text && text.trim()) {
                    try { data = JSON.parse(text); } catch(e) {}
                }
                if (!r.ok) {
                    var msg = (data && (data.message || data.error || data.details)) || 'Insert failed (' + r.status + ')';
                    throw new Error(msg);
                }
                return data;
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
            if (r.status === 204) return null;
            return r.text().then(function(text) {
                var data = null;
                if (text && text.trim()) {
                    try { data = JSON.parse(text); } catch(e) {}
                }
                if (!r.ok) {
                    var msg = (data && (data.message || data.error || data.details)) || 'Update failed (' + r.status + ')';
                    throw new Error(msg);
                }
                return data;
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
            if (r.status === 204) return null;
            return r.text().then(function(text) {
                var data = null;
                if (text && text.trim()) {
                    try { data = JSON.parse(text); } catch(e) {}
                }
                if (!r.ok) {
                    var msg = (data && (data.message || data.error || data.details)) || 'Delete failed (' + r.status + ')';
                    throw new Error(msg);
                }
                return data;
            });
        });
    }

    return {
        query: query,
        count: count,
        insert: insert,
        update: update,
        remove: remove
    };
})();
