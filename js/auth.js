/**
 * Authentication Module
 * จัดการ login, signup, logout, session
 */
var Auth = (function() {
    var _session = null;
    var _user = null;
    var _refreshTimer = null;

    // ลิงก์รีเซ็ตรหัสผ่านในอีเมลพากลับมาพร้อม #access_token=...&type=recovery
    // ถ้า Supabase ส่งกลับมาที่ Site URL (เช่น index.html) แทน reset-password.html
    // (กรณียังไม่ได้เพิ่ม URL ใน Redirect URLs) ให้ส่งต่อไปหน้าตั้งรหัสผ่านใหม่พร้อม hash เดิม
    // และไม่ให้ requireAuth()/redirectIfLoggedIn() เปลี่ยนหน้าซ้อน
    var _recoveryRedirect = (function() {
        var h = window.location.hash || '';
        if (/(^|[#&])type=recovery(&|$)/.test(h) && !/reset-password(\.html)?$/.test(window.location.pathname)) {
            window.location.replace('reset-password.html' + h);
            return true;
        }
        return false;
    })();

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
            scheduleTokenRefresh();
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
        scheduleTokenRefresh();
    }

    function clearSession() {
        _session = null;
        _user = null;
        localStorage.removeItem('sb_session');
        if (_refreshTimer) { clearTimeout(_refreshTimer); _refreshTimer = null; }
    }

    // Access token ของ Supabase หมดอายุปกติราว 1 ชม. ถ้าไม่มีการ refresh ก่อน
    // หมดอายุ session จะถูกเคลียร์เงียบๆ ตอนเรียก getSession() ครั้งถัดไป ทำให้
    // headers() ไม่มี Authorization ส่งไป PostgREST จะมองเป็น role "anon" ทันที
    // ผลคือ auth.uid() เป็น NULL และชน RLS policy (เช่น pets_insert) แม้ผู้ใช้จะ
    // ล็อกอินอยู่จริงในหน้าจอ จึงต้อง refresh token ล่วงหน้าก่อนหมดอายุเสมอ
    function scheduleTokenRefresh() {
        if (_refreshTimer) { clearTimeout(_refreshTimer); _refreshTimer = null; }
        var s = _session;
        if (!s || !s.refresh_token || !s.expires_at) return;
        var now = Math.floor(Date.now() / 1000);
        // รีเฟรชล่วงหน้า 5 นาทีก่อนหมดอายุ อย่างน้อย 5 วินาที กันกรณี expires_at ใกล้ปัจจุบันมาก
        var delayMs = Math.max((s.expires_at - now - 300), 5) * 1000;
        _refreshTimer = setTimeout(function() { refreshToken(); }, delayMs);
    }

    function refreshToken() {
        var s = _session;
        if (!s || !s.refresh_token) return Promise.resolve(null);
        return fetch(CONFIG.AUTH + '/token?grant_type=refresh_token', {
            method: 'POST',
            headers: { 'apikey': CONFIG.SB_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh_token: s.refresh_token })
        }).then(function(r) {
            return safeJson(r).then(function(data) {
                if (!r.ok || !data || !data.access_token) {
                    console.warn('Token refresh failed, session will expire normally');
                    return null;
                }
                saveSession(data);
                return data;
            });
        }).catch(function(err) {
            console.warn('Token refresh error:', err);
            return null;
        });
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
        }).then(function(r) {
            return safeJson(r).then(function(data) {
                // แนบ status และ error_code ไปด้วย ให้หน้า Login แปลงเป็นข้อความภาษาไทยได้ถูกกรณี
                if (!r.ok) throw authError(r, data, 'Signup failed');
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
                if (!r.ok) throw authError(r, data, 'Login failed');
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

    // === Password reset ด้วยรหัส OTP (F-07) ===
    // ขั้นที่ 1  requestPasswordReset(): POST /recover → Supabase ส่งอีเมล template "Reset Password"
    //           ซึ่งต้องมี {{ .Token }} (รหัส OTP ตัวเลข 6–10 หลัก) ให้ผู้ใช้นำมากรอกในหน้า reset-password.html
    // ขั้นที่ 2  verifyRecoveryOtp(): POST /verify {type:'recovery', email, token} → ได้ session ชั่วคราว
    // ขั้นที่ 3  updatePassword(): PUT /user {password} ด้วย access token จากขั้นที่ 2
    // ไม่ต้องพึ่งลิงก์ในอีเมล จึงไม่มีปัญหาลิงก์ถูกใช้ไปแล้ว/หมดอายุจากการกดซ้ำหรือจากระบบสแกนลิงก์
    // ของผู้ให้บริการอีเมล และไม่ต้องตั้ง Redirect URLs
    //
    // redirect_to ยังส่งไปด้วย เผื่อ template ยังเป็นแบบลิงก์ ลิงก์จะพากลับมาหน้าเดียวกัน
    // (_recoveryRedirect ด้านบนส่งต่อให้ถ้า Supabase พาไป Site URL แทน)
    function resetPasswordUrl() {
        return new URL('reset-password.html', window.location.href).href;
    }

    // แปลงคำตอบที่ไม่สำเร็จจาก Supabase Auth เป็น Error ที่มี status และ code (error_code)
    function authError(r, data, fallback) {
        var err = new Error((data && (data.msg || data.message || data.error_description)) || (fallback + ' (' + r.status + ')'));
        err.status = r.status;
        err.code = data && (data.error_code || data.code);
        return err;
    }

    // ส่งรหัส OTP ไปที่อีเมล — Supabase ตอบสำเร็จเหมือนกันทุกกรณี
    // ไม่ว่าอีเมลนั้นมีบัญชีหรือไม่ (กันการเดาอีเมลสมาชิก)
    function requestPasswordReset(email) {
        return fetch(CONFIG.AUTH + '/recover?redirect_to=' + encodeURIComponent(resetPasswordUrl()), {
            method: 'POST',
            headers: { 'apikey': CONFIG.SB_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email })
        }).then(function(r) {
            return safeJson(r).then(function(data) {
                if (!r.ok) throw authError(r, data, 'recover failed');
                return data;
            });
        });
    }

    // ยืนยันรหัส OTP จากอีเมล คืน session ({ access_token, refresh_token, user, ... })
    // รหัสใช้ได้ครั้งเดียว: ยืนยันสำเร็จแล้วรหัสเดิมจะใช้ซ้ำไม่ได้
    function verifyRecoveryOtp(email, token) {
        return fetch(CONFIG.AUTH + '/verify', {
            method: 'POST',
            headers: { 'apikey': CONFIG.SB_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'recovery', email: email, token: token })
        }).then(function(r) {
            return safeJson(r).then(function(data) {
                if (!r.ok) throw authError(r, data, 'verify failed');
                if (!data || !data.access_token) throw authError(r, data, 'verify returned no session');
                return data;
            });
        });
    }

    // ตั้งรหัสผ่านใหม่ด้วย access token จากการยืนยันรหัส OTP (หรือจากลิงก์ type=recovery)
    function updatePassword(accessToken, newPassword) {
        return fetch(CONFIG.AUTH + '/user', {
            method: 'PUT',
            headers: { 'apikey': CONFIG.SB_KEY, 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: newPassword })
        }).then(function(r) {
            return safeJson(r).then(function(data) {
                if (!r.ok) throw authError(r, data, 'update password failed');
                return data;
            });
        });
    }

    // ยกเลิก session ชั่วคราวที่ได้จากการยืนยันรหัส (ไม่กระทบอุปกรณ์อื่น)
    // ทำแบบไม่รอผล: ถ้าเรียกไม่สำเร็จ session นี้ก็หมดอายุเองตามเวลาของ access token
    function revokeSession(accessToken) {
        return fetch(CONFIG.AUTH + '/logout?scope=local', {
            method: 'POST',
            headers: { 'apikey': CONFIG.SB_KEY, 'Authorization': 'Bearer ' + accessToken }
        }).then(function() {}, function() {});
    }

    // === Redirect ===
    function requireAuth() {
        if (_recoveryRedirect) return false;
        if (!isLoggedIn()) {
            window.location.href = 'login.html';
            return false;
        }
        return true;
    }

    function redirectIfLoggedIn() {
        if (_recoveryRedirect) return true;
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
        autoLinkUser: autoLinkUser,
        requestPasswordReset: requestPasswordReset,
        verifyRecoveryOtp: verifyRecoveryOtp,
        updatePassword: updatePassword,
        revokeSession: revokeSession
    };
})();
