/**
 * Authentication Module
 * จัดการ login, signup, logout, session
 */
var Auth = (function() {
    var _session = null;
    var _user = null;

    // === Session Management ===
    function getSession() {
        if (_session) return _session;
        var raw = localStorage.getItem('sb_session');
        if (raw) {
            _session = JSON.parse(raw);
            // ตรวจสอบว่า token หมดอายุหรือยัง
            if (_session && _session.expires_at) {
                var now = Math.floor(Date.now() / 1000);
                if (now > _session.expires_at) {
                    clearSession();
                    return null;
                }
            }
        }
        return _session;
    }

    function saveSession(data) {
        _session = data;
        localStorage.setItem('sb_session', JSON.stringify(data));
    }

    function clearSession() {
        _session = null;
        _user = null;
        localStorage.removeItem('sb_session');
    }

    function isLoggedIn() {
        return !!getSession();
    }

    // === Auth Headers ===
    function headers() {
        var h = { 'apikey': CONFIG.SB_KEY };
        var s = getSession();
        if (s && s.access_token) {
            h['Authorization'] = 'Bearer ' + s.access_token;
        }
        return h;
    }

    // === Auth API ===
    function signup(email, password, metadata) {
        var body = { email: email, password: password };
        if (metadata) {
            body.data = metadata;
        }
        return fetch(CONFIG.AUTH + '/signup', {
            method: 'POST',
            headers: { 'apikey': CONFIG.SB_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        }).then(function(r) { return r.json(); });
    }

    function login(email, password) {
        return fetch(CONFIG.AUTH + '/token?grant_type=password', {
            method: 'POST',
            headers: { 'apikey': CONFIG.SB_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email, password: password })
        }).then(function(r) { return r.json(); });
    }

    function logout() {
        var s = getSession();
        var promise = Promise.resolve();
        if (s && s.access_token) {
            promise = fetch(CONFIG.AUTH + '/logout', {
                method: 'POST',
                headers: { 'apikey': CONFIG.SB_KEY, 'Authorization': 'Bearer ' + s.access_token }
            }).catch(function() {});
        }
        return promise.then(function() {
            clearSession();
        });
    }

    // === User Profile ===
    function getAuthUserId() {
        var s = getSession();
        if (!s || !s.access_token) return null;
        try {
            var payload = JSON.parse(atob(s.access_token.split('.')[1]));
            return payload.sub;
        } catch(e) {
            return null;
        }
    }

    function getUser() {
        return _user;
    }

    function loadProfile() {
        var authId = getAuthUserId();
        if (!authId) return Promise.reject(new Error('Not authenticated'));

        return Api.query('users', 'select=user_id,name,email,role&auth_id=eq.' + authId)
        .then(function(users) {
            if (!users || !users.length) {
                throw new Error('ไม่พบข้อมูลผู้ใช้ในระบบ');
            }
            _user = users[0];
            return _user;
        });
    }

    function createUserProfile(name, email, role, authId) {
        return Api.insert('users', {
            name: name,
            email: email,
            password: 'auth_managed',
            role: role,
            auth_id: authId
        });
    }

    // === Redirect ===
    function requireAuth() {
        if (!isLoggedIn()) {
            window.location.href = 'login.html';
            return false;
        }
        return true;
    }

    function redirectIfLoggedIn() {
        if (isLoggedIn()) {
            window.location.href = 'index.html';
            return true;
        }
        return false;
    }

    // === Auto-link user to seed data ===
    function autoLinkUser() {
        return fetch(CONFIG.REST + '/rpc/auto_link_user', {
            method: 'POST',
            headers: Object.assign({
                'Content-Type': 'application/json'
            }, headers())
        }).then(function(r) {
            if (!r.ok) throw new Error('auto_link_user failed: ' + r.status);
            // auto_link_user returns VOID — response body is empty
            var ct = r.headers.get('content-type') || '';
            if (ct.indexOf('application/json') >= 0) {
                return r.json();
            }
            return null;
        }).catch(function(err) {
            console.warn('auto_link_user failed (non-critical):', err);
        });
    }

    // === Public API ===
    return {
        getSession: getSession,
        saveSession: saveSession,
        clearSession: clearSession,
        isLoggedIn: isLoggedIn,
        headers: headers,
        signup: signup,
        login: login,
        logout: logout,
        getAuthUserId: getAuthUserId,
        getUser: getUser,
        loadProfile: loadProfile,
        createUserProfile: createUserProfile,
        requireAuth: requireAuth,
        redirectIfLoggedIn: redirectIfLoggedIn,
        autoLinkUser: autoLinkUser
    };
})();
