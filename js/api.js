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
            return r.json();
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
            return r.json().then(function(d) { return Array.isArray(d) ? d.length : 0; });
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
            return r.json().then(function(data) {
                if (!r.ok) throw new Error(data.message || data.error || 'Insert failed (' + r.status + ')');
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
            return r.json().then(function(data) {
                if (!r.ok) throw new Error(data.message || data.error || 'Update failed (' + r.status + ')');
                return data;
            });
        });
    }

    function remove(table, params) {
        return fetch(CONFIG.REST + '/' + table + '?' + params, {
            method: 'DELETE',
            headers: Auth.headers()
        }).then(function(r) {
            return r.json().then(function(data) {
                if (!r.ok) throw new Error(data.message || data.error || 'Delete failed (' + r.status + ')');
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
