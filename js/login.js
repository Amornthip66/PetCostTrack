/**
 * Login Page Logic
 */
(function() {
    // ถ้า login อยู่แล้ว ไป dashboard เลย
    Auth.redirectIfLoggedIn();

    // === Tab Switching ===
    window.showTab = function(tab) {
        var isLogin = tab === 'login';
        document.getElementById('tabLogin').className = isLogin
            ? 'flex-1 py-2 rounded-md text-sm font-medium bg-white shadow text-pet transition'
            : 'flex-1 py-2 rounded-md text-sm font-medium text-gray-500 transition';
        document.getElementById('tabSignup').className = !isLogin
            ? 'flex-1 py-2 rounded-md text-sm font-medium bg-white shadow text-pet transition'
            : 'flex-1 py-2 rounded-md text-sm font-medium text-gray-500 transition';
        document.getElementById('loginForm').className = isLogin ? '' : 'hidden';
        document.getElementById('signupForm').className = !isLogin ? '' : 'hidden';
    };

    // === Forgot Password (F-07: รีเซ็ตรหัสผ่านด้วยรหัส OTP) ===
    // ลิงก์ "ลืมรหัสผ่าน?" ไปหน้า reset-password.html — ส่งอีเมลที่กรอกไว้ไปเติมให้ (ผ่าน sessionStorage
    // ไม่ใส่ใน URL) ถ้าใช้ sessionStorage ไม่ได้ ลิงก์ก็ยังพาไปหน้าตั้งรหัสผ่านตามปกติ
    window.goToReset = function() {
        try {
            var email = document.getElementById('loginEmail').value.trim();
            if (email) sessionStorage.setItem('pct_reset_email', JSON.stringify(email));
        } catch (e) { /* ignore */ }
        return true;
    };

    // กลับมาจากหน้าตั้งรหัสผ่านใหม่สำเร็จ → เติมอีเมลให้ในช่องเข้าสู่ระบบ
    (function prefillLoginEmail() {
        try {
            var raw = sessionStorage.getItem('pct_login_email');
            if (!raw) return;
            sessionStorage.removeItem('pct_login_email');
            var email = JSON.parse(raw);
            var input = document.getElementById('loginEmail');
            if (typeof email === 'string' && input && !input.value) input.value = email;
        } catch (e) { /* ignore */ }
    })();

    // === แปลง error จาก Supabase Auth เป็นข้อความภาษาไทย ===
    // action: 'login' หรือ 'signup' — err มาจาก Auth.login()/Auth.signup() (มี status และ code)
    function authErrorMessage(err, action) {
        var msg = (err && err.message) || '';
        var code = String((err && err.code) || '');
        var status = err && err.status;
        // fetch() ที่ต่อเครือข่ายไม่ได้จะ reject ด้วย TypeError (เช่น "Failed to fetch")
        if (!status && err && err.name === 'TypeError') {
            return 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่';
        }
        // ส่งอีเมลยืนยันไม่ได้เพราะเกินโควตา: แบบมีตัวเลขวินาที = ขอซ้ำเร็วเกินไป,
        // แบบไม่มี ("email rate limit exceeded") = โควตาอีเมลรายชั่วโมงของทั้งโปรเจกต์เต็ม
        if (code === 'over_email_send_rate_limit' || /email rate limit|security purposes/i.test(msg)) {
            var wait = /(\d+)\s*second/i.exec(msg);
            if (wait) return 'กรุณารอ ' + wait[1] + ' วินาทีแล้วลองใหม่';
            return action === 'signup'
                ? 'ขณะนี้ระบบส่งอีเมลยืนยันการสมัครครบจำนวนที่กำหนดต่อชั่วโมงแล้ว กรุณาลองสมัครใหม่ภายหลัง (ประมาณ 1 ชั่วโมง)'
                : 'ขณะนี้ระบบส่งอีเมลครบจำนวนที่กำหนดต่อชั่วโมงแล้ว กรุณาลองใหม่ภายหลัง';
        }
        if (status === 429 || code === 'over_request_rate_limit') {
            return 'มีการลองหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่';
        }
        if (code === 'invalid_credentials' || /invalid login credentials|invalid_grant/i.test(msg)) {
            return 'อีเมลหรือรหัสผ่านไม่ถูกต้อง';
        }
        if (code === 'email_not_confirmed' || /email not confirmed/i.test(msg)) {
            return 'กรุณายืนยันอีเมลก่อนเข้าสู่ระบบ (ตรวจสอบใน Inbox/Spam)';
        }
        if (code === 'user_already_exists' || code === 'email_exists' || /already registered|already been registered/i.test(msg)) {
            return 'อีเมลนี้สมัครสมาชิกแล้ว กรุณาเข้าสู่ระบบ หรือกด "ลืมรหัสผ่าน?"';
        }
        if (code === 'weak_password' || /password should|password is known|weak/i.test(msg)) {
            return 'รหัสผ่านไม่ปลอดภัยพอ กรุณาตั้งให้ยาวขึ้นหรือผสมตัวอักษรและตัวเลข';
        }
        if (code === 'email_address_not_authorized' || /not authorized/i.test(msg)) {
            return 'ระบบยังส่งอีเมลถึงที่อยู่นี้ไม่ได้ กรุณาติดต่อผู้ดูแลระบบ';
        }
        if (code === 'email_address_invalid' || /invalid format|unable to validate email/i.test(msg)) {
            return 'รูปแบบอีเมลไม่ถูกต้อง';
        }
        if (code === 'signup_disabled' || /signups not allowed/i.test(msg)) {
            return 'ระบบปิดรับสมัครสมาชิกชั่วคราว';
        }
        if (/Database error saving new user/i.test(msg)) {
            return 'เกิดข้อผิดพลาดที่ฐานข้อมูล (Database error saving new user) กรุณาตรวจสอบ Trigger ใน Supabase';
        }
        if (status >= 500) return 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง';
        return 'เกิดข้อผิดพลาด: ' + (msg || 'กรุณาลองใหม่อีกครั้ง');
    }

    function isEmailNotConfirmed(err) {
        return !!err && (err.code === 'email_not_confirmed' || /email not confirmed/i.test(err.message || ''));
    }

    // === ส่งอีเมลยืนยันการสมัครอีกครั้ง (เข้าสู่ระบบแล้วเจอ "ยังไม่ได้ยืนยันอีเมล") ===
    // Supabase ให้ขอซ้ำได้ทุก 60 วินาที จึงนับถอยหลังบนปุ่มหลังส่งสำเร็จ
    var RESEND_SECONDS = 60;
    var _unconfirmedEmail = '';
    var _resendBusy = false;
    var _resendAt = 0;
    var _resendTimer = null;

    function showResendBox(email) {
        _unconfirmedEmail = email;
        setResendMsg(null, '');
        renderResendBtn();
        document.getElementById('resendConfirmBox').classList.remove('hidden');
    }

    function hideResendBox() {
        document.getElementById('resendConfirmBox').classList.add('hidden');
    }

    function setResendMsg(kind, msg) {
        var el = document.getElementById('resendConfirmMsg');
        el.textContent = msg || '';
        el.className = 'text-sm mt-1 ' + (msg ? '' : 'hidden ') + (kind === 'ok' ? 'text-green-600' : 'text-red-500');
    }

    function renderResendBtn() {
        var btn = document.getElementById('resendConfirmBtn');
        var left = Math.ceil((_resendAt - Date.now()) / 1000);
        if (left > 0) {
            btn.disabled = true;
            btn.textContent = 'ส่งอีกครั้งได้ใน ' + left + ' วินาที';
            return;
        }
        if (_resendTimer) { clearInterval(_resendTimer); _resendTimer = null; }
        btn.disabled = _resendBusy;
        btn.textContent = _resendBusy ? 'กำลังส่ง...' : 'ส่งอีเมลยืนยันอีกครั้ง';
    }

    function startResendCooldown(seconds) {
        _resendAt = Date.now() + seconds * 1000;
        if (_resendTimer) clearInterval(_resendTimer);
        _resendTimer = setInterval(renderResendBtn, 1000);
        renderResendBtn();
    }

    window.resendConfirmation = function() {
        if (_resendBusy || _resendAt > Date.now() || !_unconfirmedEmail) return;
        var email = _unconfirmedEmail;
        _resendBusy = true;
        setResendMsg(null, '');
        renderResendBtn();
        Auth.resendSignupConfirmation(email)
        .then(function() {
            _resendBusy = false;
            setResendMsg('ok', 'ส่งอีเมลยืนยันฉบับใหม่ไปที่ ' + email + ' แล้ว กรุณากดปุ่ม “ยืนยันอีเมล” ในอีเมลฉบับล่าสุด');
            startResendCooldown(RESEND_SECONDS);
        })
        .catch(function(err) {
            _resendBusy = false;
            var wait = /(\d+)\s*second/i.exec((err && err.message) || '');
            if (wait && parseInt(wait[1], 10) > 0) startResendCooldown(parseInt(wait[1], 10));
            else renderResendBtn();
            setResendMsg('error', authErrorMessage(err, 'resend'));
        });
    };

    // === Helpers ===
    function showError(id, msg) {
        var el = document.getElementById(id);
        el.textContent = msg;
        el.classList.remove('hidden');
    }
    function hideError(id) { document.getElementById(id).classList.add('hidden'); }
    function setLoading(btnId, loading, text) {
        var btn = document.getElementById(btnId);
        if (loading) {
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i>' + text;
            btn.disabled = true;
        } else {
            btn.innerHTML = '<span>' + text + '</span>';
            btn.disabled = false;
        }
    }

    // === Login Handler ===
    window.handleLogin = function(e) {
        e.preventDefault();
        hideError('loginError');
        hideResendBox();
        setLoading('loginBtn', true, 'กำลังเข้าสู่ระบบ...');

        var email = document.getElementById('loginEmail').value.trim();
        var password = document.getElementById('loginPassword').value;

        Auth.login(email, password)
        .then(function(data) {
            console.log('Login response:', data); // Debug
            
            // ตรวจสอบ error ทุกรูปแบบจาก Supabase
            var errMsg = data.error_description || data.error || 
                         data.message || data.msg || null;
            var errCode = data.code || null;
            
            if (errMsg || errCode) {
                var displayMsg = errMsg || 'เกิดข้อผิดพลาด (code: ' + errCode + ')';
                if (errMsg === 'invalid_grant' || errMsg === 'Invalid login credentials' || displayMsg.indexOf('Invalid login credentials') >= 0) {
                    displayMsg = 'อีเมลหรือรหัสผ่านไม่ถูกต้อง';
                } else if (errMsg === 'Email not confirmed' || displayMsg.indexOf('Email not confirmed') >= 0) {
                    displayMsg = 'กรุณายืนยันอีเมลก่อนเข้าสู่ระบบ (ตรวจสอบใน Inbox/Spam)';
                }
                showError('loginError', displayMsg);
                setLoading('loginBtn', false, 'เข้าสู่ระบบ');
                return;
            }
            
            // ตรวจสอบว่ามี access_token ไหม
            if (!data.access_token) {
                showError('loginError', 'ไม่ได้รับ token จาก server');
                setLoading('loginBtn', false, 'เข้าสู่ระบบ');
                return;
            }
            
            Auth.saveSession(data);
            console.log('Session saved:', Auth.getSession()); // Debug
            
            // ไปหน้า index.html ทันที
            window.location.href = 'index.html';
        }).catch(function(err) {
            console.error('Login error:', err);
            showError('loginError', authErrorMessage(err, 'login'));
            if (isEmailNotConfirmed(err)) showResendBox(email);
            setLoading('loginBtn', false, 'เข้าสู่ระบบ');
        });
    };

    // === Signup Handler ===
    window.handleSignup = function(e) {
        e.preventDefault();
        hideError('signupError');
        document.getElementById('signupSuccess').classList.add('hidden');
        setLoading('signupBtn', true, 'กำลังสมัคร...');

        var name = (document.getElementById('signupName').value || '').trim();
        var email = (document.getElementById('signupEmail').value || '').trim();
        var password = document.getElementById('signupPassword').value;
        var role = document.getElementById('signupRole').value;

        if (!name || !email || !password) {
            showError('signupError', 'กรุณากรอกข้อมูลให้ครบถ้วน');
            setLoading('signupBtn', false, 'สมัครสมาชิก');
            return;
        }

        // Proposal AC F-07 II: รหัสผ่านต้องมีความยาวไม่น้อยกว่า 8 ตัวอักษร
        if (password.length < 8) {
            showError('signupError', 'รหัสผ่านต้องมีความยาวไม่น้อยกว่า 8 ตัวอักษร');
            setLoading('signupBtn', false, 'สมัครสมาชิก');
            return;
        }

        Auth.signup(email, password, { name: name, role: role })
        .then(function(response) {
            console.log('Signup response:', response); // Debug
            
            // Supabase error formats: {error}, {code, message}, {msg}
            var errMsg = response.error_description || response.error || 
                         response.message || response.msg || null;
            var errCode = response.code || null;
            
            if (errMsg || errCode) {
                // แสดง error message ที่เข้าใจง่าย
                var displayMsg = errMsg || 'เกิดข้อผิดพลาด (code: ' + errCode + ')';
                if (displayMsg.indexOf('Database error saving new user') >= 0) {
                    displayMsg = 'เกิดข้อผิดพลาดที่ฐานข้อมูล (Database error saving new user) กรุณารัน SQL Migration แก้ไข Trigger ใน Supabase';
                } else if (errCode === '400' && errMsg && errMsg.includes('email')) {
                    displayMsg = 'อีเมลนี้ถูกใช้แล้วหรือรูปแบบไม่ถูกต้อง';
                }
                showError('signupError', displayMsg);
                setLoading('signupBtn', false, 'สมัครสมาชิก');
                return;
            }
            
            // สำเร็จ - บันทึก session (ถ้ามี token ส่งกลับมา)
            var sessionData = response.session || response;
            if (sessionData && sessionData.access_token) {
                Auth.saveSession(sessionData);
            }

            var userId = (response.user && response.user.id) ? response.user.id : (response.id || null);
            
            if (!sessionData || !sessionData.access_token) {
                // กรณี Supabase เปิด Confirm Email ไว้
                // อีเมลนี้สมัครและยืนยันไว้แล้ว: Supabase ตอบสำเร็จแบบไม่มี identities และไม่ได้ส่งอีเมล
                var user = response.user || response;
                if (user && Array.isArray(user.identities) && user.identities.length === 0) {
                    showError('signupError', authErrorMessage({ code: 'user_already_exists' }, 'signup'));
                    setLoading('signupBtn', false, 'สมัครสมาชิก');
                    return;
                }
                document.getElementById('signupSuccess').textContent = 'สมัครสำเร็จ! เราส่งอีเมลยืนยันไปที่ ' + email
                    + ' แล้ว กรุณากดปุ่ม “ยืนยันอีเมล” ในอีเมลก่อนเข้าสู่ระบบ (ถ้าไม่เห็น ให้ดูในโฟลเดอร์ Spam/Junk)';
                document.getElementById('signupSuccess').classList.remove('hidden');
                setLoading('signupBtn', false, 'สมัครสมาชิก');
                return;
            }
            
            // Auto-link กับ seed data (trigger ทำงานแล้ว แต่เรียกซ้ำเพื่อความชัวร์)
            return Auth.autoLinkUser().then(function() {
                // ลองเช็คว่า profile มีอยู่แล้วหรือยัง
                return Auth.loadProfile().then(function() {
                    // profile มีอยู่แล้ว
                    document.getElementById('signupSuccess').textContent = 'สมัครสำเร็จ! กำลังเข้าสู่ระบบ...';
                    document.getElementById('signupSuccess').classList.remove('hidden');
                    setTimeout(function() { window.location.href = 'index.html'; }, 1000);
                }).catch(function() {
                    // ยังไม่มี profile → สร้างใหม่
                    return Auth.createUserProfile(name, email, role, userId).then(function() {
                        document.getElementById('signupSuccess').textContent = 'สมัครสำเร็จ! กำลังเข้าสู่ระบบ...';
                        document.getElementById('signupSuccess').classList.remove('hidden');
                        setTimeout(function() { window.location.href = 'index.html'; }, 1000);
                    });
                });
            });
        })
        .catch(function(err) {
            console.error('Signup error:', err);
            showError('signupError', authErrorMessage(err, 'signup'));
            setLoading('signupBtn', false, 'สมัครสมาชิก');
        });
    };
})();
