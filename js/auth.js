/**
 * Authentication Module
 * จัดการ login, signup, logout, session
 */
var Auth = (function() {
    var _session = null;
    var _user = null;

    // อ่าน response เป็น JSON อย่างปลอดภัยเสมอ: ห้ามเรียก r.json() ตรงๆ เด็ดขาด
    // เพราะถ้า body ว่างเปล่า (204, RPC ที่คืนค่า VOID ฯลฯ) r.json() จะโยน
    // error "Unexpected end of JSON input" ทันที แม้ header จะบอกว่าเป็น application/json ก็ตาม
    function safeJson(r) {
        if (r.status === 204) return Promise.resolve(null);
        return r.text().then(function(text) {
            if (!text || !text.trim()) return null;
            try { return JSON.parse(text); } catch (e) { return null; }
        });
    }

    // === Session Management ===
    function isAccessExpired(s) {
        // ตรวจสอบว่า access token หมดอายุหรือยัง (เทียบกับ expires_at)
        return !!(s && s.expires_at && Math.floor(Date.now() / 1000) > s.expires_at);
    }

    function getSession() {
        if (_session) return _session;
        var raw = localStorage.getItem('sb_session');
        if (raw) {
            try {
                _session = JSON.parse(raw);
            } catch (e) {
                _session = null;
            }
        }
        return _session;
    }

    function saveSession(data) {
        if (!data) return;
        if (data.expires_in && !data.expires_at) {
            data.expires_at = Math.floor(Date.now() / 1000) + parseInt(data.expires_in);
        }
        _session = data;
        localStorage.setItem('sb_session', JSON.stringify(data));
    }

    function clearSession() {
        _session = null;
        _user = null;
        localStorage.removeItem('sb_session');
    }

    // === Token Refresh ===
    // กันการเรียก refresh พร้อมกันหลายครั้ง (single-flight)
    // ไม่งั้น refresh token ถูก rotate หลายรอบพร้อมกันจน token เพี้ยนได้
    var _refreshing = null;

    function refreshSession() {
        if (_refreshing) return _refreshing;

        var raw = localStorage.getItem('sb_session');
        var s = null;
        if (raw) {
            try { s = JSON.parse(raw); } catch (e) { s = null; }
        }
        if (!s || !s.refresh_token) return Promise.resolve(null);

        _refreshing = fetch(CONFIG.AUTH + '/token?grant_type=refresh_token', {
            method: 'POST',
            headers: {
                'apikey': CONFIG.SB_KEY,
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + s.refresh_token
            },
            body: JSON.stringify({ refresh_token: s.refresh_token })
        }).then(function(r) {
            return safeJson(r).then(function(data) {
                if (!r.ok || !data || !data.access_token) {
                    clearSession();
                    return null;
                }
                saveSession(data);
                return getSession();
            });
        }).catch(function(err) {
            console.warn('Session refresh failed:', err);
            return null;
        }).then(function(result) {
            _refreshing = null;
            return result;
        });
        return _refreshing;
    }

    // ตรวจสอบ/ต่ออายุ session ให้ใช้ได้ก่อนส่ง request เสมอ
    // - session ยังไม่หมดอายุ → คืน session เดิมทันที
    // - หมดอายุแต่ยังมี refresh token → พยายามต่ออายุ แล้วคืน session ใหม่
    // - ต่ออายุไม่ได้ / ไม่มี session เลย → คืน null
    function ensureSession() {
        var s = getSession();
        if (s && !isAccessExpired(s)) return Promise.resolve(s);
        return refreshSession();
    }

    function isLoggedIn() {
        var s = getSession();
        return !!s && !isAccessExpired(s);
    }

    // === Auth Headers ===
    function headers() {
        var h = { 'apikey': CONFIG.SB_KEY };
        var s = getSession();
        // ถ้า token หมดอายุแล้ว อย่าส่ง Authorization (server จะตอบ 401)
        // Api จะเรียก ensureSession() เพื่อต่ออายุให้ก่อนส่ง request จริง
        if (s && s.access_token && !isAccessExpired(s)) {
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
        }).then(function(r) {
            return safeJson(r).then(function(data) {
                if (!r.ok) {
                    var msg = (data && (data.msg || data.message || data.error_description)) || 'Signup failed (' + r.status + ')';
                    throw new Error(msg);
                }
                return data;
            });
        });
    }

    function login(email, password) {
        return fetch(CONFIG.AUTH + '/token?grant_type=password', {
            method: 'POST',
            headers: { 'apikey': CONFIG.SB_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email, password: password })
        }).then(function(r) {
            return safeJson(r).then(function(data) {
                if (!r.ok) {
                    var msg = (data && (data.msg || data.message || data.error_description)) || 'Login failed (' + r.status + ')';
                    throw new Error(msg);
                }
                return data;
            });
        });
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
    // JWT ใช้ Base64URL (มีตัวอักษร - และ _ แทน + และ / และไม่มี padding =)
    // atob() มาตรฐานรองรับแค่ Base64 ปกติ ถ้าเจอ - หรือ _ จะ throw error ทันที
    // ต้องแปลงเป็น Base64 ปกติ + เติม padding ก่อนค่อยส่งให้ atob()
    function base64UrlDecode(str) {
        str = str.replace(/-/g, '+').replace(/_/g, '/');
        while (str.length % 4) { str += '='; }
        return atob(str);
    }

    function getAuthUserId() {
        var s = getSession();
        if (!s) return null;
        // ใช้ user.id จาก session ตรงๆ ก่อน (แม่นยำและเร็วกว่าการถอด JWT เอง)
        if (s.user && s.user.id) return s.user.id;
        if (!s.access_token) return null;
        try {
            var payload = JSON.parse(base64UrlDecode(s.access_token.split('.')[1]));
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
            if (users && users.length) {
                _user = users[0];
                return _user;
            }

            // ถ้าไม่พบจาก auth_id ให้ลองค้นหาจาก email
            var s = getSession();
            var email = (s && s.user && s.user.email) ? s.user.email : '';
            var meta = (s && s.user && (s.user.user_metadata || s.user.raw_user_meta_data)) || {};
            var name = meta.name || (email ? email.split('@')[0] : 'User');
            var role = meta.role || 'Owner';

            if (email) {
                return Api.query('users', 'select=user_id,name,email,role&email=eq.' + encodeURIComponent(email))
                .then(function(emailUsers) {
                    if (emailUsers && emailUsers.length) {
                        // พบผู้ใช้เดิม (Seed) -> Update auth_id
                        return Api.update('users', 'user_id=eq.' + emailUsers[0].user_id, { auth_id: authId })
                        .then(function(updated) {
                            _user = (Array.isArray(updated) && updated.length) ? updated[0] : emailUsers[0];
                            return _user;
                        }).catch(function() {
                            _user = emailUsers[0];
                            return _user;
                        });
                    }

                    // ยังไม่มี profile -> สร้างใหม่
                    return createUserProfile(name, email, role, authId)
                    .then(function(created) {
                        _user = (Array.isArray(created) && created.length) ? created[0] : {
                            name: name,
                            email: email,
                            role: role,
                            auth_id: authId
                        };
                        return _user;
                    }).catch(function() {
                        // Fallback object ไม่ให้แอปล่ม
                        _user = {
                            name: name,
                            email: email,
                            role: role,
                            auth_id: authId
                        };
                        return _user;
                    });
                }).catch(function() {
                    _user = { name: name, email: email, role: role, auth_id: authId };
                    return _user;
                });
            }

            _user = { name: name, email: email, role: role, auth_id: authId };
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
        if (isLoggedIn()) return true;

        // access token หมดอายุ แต่ยังมี refresh token → ลองต่ออายุอัตโนมัติ
        // (สำเร็จหน้าเว็บทำงานต่อได้เลย, ไม่สำเร็จค่อยพาไปหน้า login)
        var raw = localStorage.getItem('sb_session');
        if (raw) {
            refreshSession().then(function(s) {
                if (!s) window.location.href = 'login.html';
            });
            return true;
        }

        window.location.href = 'login.html';
        return false;
    }

    function redirectIfLoggedIn() {
        if (isLoggedIn()) {
            window.location.href = 'index.html';
            return true;
        }

        // token หมดอายุ → ลองต่ออายุเงียบๆ ถ้าสำเร็จพาเข้าแอปต่อได้เลย
        var raw = localStorage.getItem('sb_session');
        if (raw) {
            refreshSession().then(function(s) {
                if (s) window.location.href = 'index.html';
            });
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
            // auto_link_user คืนค่า VOID — ใช้ safeJson แทน r.json() ตรงๆ
            // เพราะบาง server ติด header content-type: application/json มาทั้งที่ body ว่างเปล่าจริง
            return safeJson(r);
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
        refreshSession: refreshSession,
        ensureSession: ensureSession,
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
