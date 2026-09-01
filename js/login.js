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
            ? 'flex-1 py-2 rounded-md text-sm font-medium bg-white shadow text-pet-DEFAULT transition'
            : 'flex-1 py-2 rounded-md text-sm font-medium text-gray-500 transition';
        document.getElementById('tabSignup').className = !isLogin
            ? 'flex-1 py-2 rounded-md text-sm font-medium bg-white shadow text-pet-DEFAULT transition'
            : 'flex-1 py-2 rounded-md text-sm font-medium text-gray-500 transition';
        document.getElementById('loginForm').className = isLogin ? '' : 'hidden';
        document.getElementById('signupForm').className = !isLogin ? '' : 'hidden';
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
            showError('loginError', 'เกิดข้อผิดพลาด: ' + (err.message || 'กรุณาลองใหม่อีกครั้ง'));
            setLoading('loginBtn', false, 'เข้าสู่ระบบ');
        });
    };

    // === Signup Handler ===
    window.handleSignup = function(e) {
        e.preventDefault();
        hideError('signupError');
        document.getElementById('signupSuccess').classList.add('hidden');
        setLoading('signupBtn', true, 'กำลังสมัคร...');

        var name = document.getElementById('signupName').value;
        var email = document.getElementById('signupEmail').value;
        var password = document.getElementById('signupPassword').value;
        var role = document.getElementById('signupRole').value;

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
                document.getElementById('signupSuccess').textContent = 'สมัครสำเร็จ! กรุณาตรวจสอบอีเมลเพื่อยืนยันตัวตนก่อนเข้าสู่ระบบ';
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
            showError('signupError', 'เกิดข้อผิดพลาด: ' + (err.message || 'กรุณาลองใหม่อีกครั้ง'));
            setLoading('signupBtn', false, 'สมัครสมาชิก');
        });
    };
})();
