/**
 * Supabase REST API Module
 * ช่วยเหลือสำหรับ query, count, insert, update, delete
 */
var Api = (function() {

    function parseResponse(r, defaultError) {
        return r.text().then(function(text) {
            var data = null;
            if (text && text.trim().length > 0) {
                try {
                    data = JSON.parse(text);
                } catch (e) {
                    data = text;
                }
            }
            if (!r.ok) {
                var msg = (data && (data.message || data.error || data.details || data.hint))
                    || (typeof data === 'string' ? data : null)
                    || (defaultError + ' (' + r.status + ')');
                throw new Error(msg);
            }
            return data;
        });
    }

    function query(table, params) {
        return fetch(CONFIG.REST + '/' + table + '?' + params, {
            headers: Auth.headers()
        }).then(function(r) {
            return parseResponse(r, 'API Error');
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
            return parseResponse(r, 'Count error').then(function(d) {
                return Array.isArray(d) ? d.length : 0;
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
            return parseResponse(r, 'Insert failed');
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
            return parseResponse(r, 'Update failed');
        });
    }

    function remove(table, params) {
        return fetch(CONFIG.REST + '/' + table + '?' + params, {
            method: 'DELETE',
            headers: Object.assign({
                'Prefer': 'return=representation'
            }, Auth.headers())
        }).then(function(r) {
            return parseResponse(r, 'Delete failed');
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
