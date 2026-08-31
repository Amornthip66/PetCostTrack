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

        Auth.login(
            document.getElementById('loginEmail').value,
            document.getElementById('loginPassword').value
        ).then(function(data) {
            if (data.error) {
                showError('loginError', data.error_description || data.error);
                setLoading('loginBtn', false, 'เข้าสู่ระบบ');
                return;
            }
            Auth.saveSession(data);
            window.location.href = 'index.html';
        }).catch(function(err) {
            showError('loginError', 'เกิดข้อผิดพลาด: ' + err.message);
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

        Auth.signup(email, password)
        .then(function(data) {
            // Supabase ใช้ error / code / message สำหรับ error หลายรูปแบบ
            if (data.error || data.code || data.message) {
                var errMsg = data.error_description || data.error || data.message || 'เกิดข้อผิดพลาด';
                showError('signupError', errMsg);
                setLoading('signupBtn', false, 'สมัครสมาชิก');
                return;
            }
            Auth.saveSession(data);
            // กรณี confirm email แล้ว data.user อาจไม่มี
            var userId = data.user && data.user.id ? data.user.id : null;
            if (!userId) {
                document.getElementById('signupSuccess').textContent = 'สมัครสำเร็จ! กรุณาตรวจสอบอีเมลเพื่อยืนยันตัวตน';
                document.getElementById('signupSuccess').classList.remove('hidden');
                setLoading('signupBtn', false, 'สมัครสมาชิก');
                return;
            }
            return Auth.createUserProfile(name, email, role, userId);
        })
        .then(function(result) {
            if (!result) return; // email confirmation flow — ไม่ต้องทำอะไรเพิ่ม
            if (result && result.error) {
                showError('signupError', result.message || result.error);
                setLoading('signupBtn', false, 'สมัครสมาชิก');
                return;
            }
            document.getElementById('signupSuccess').textContent = 'สมัครสำเร็จ! กำลังเข้าสู่ระบบ...';
            document.getElementById('signupSuccess').classList.remove('hidden');
            setTimeout(function() { window.location.href = 'index.html'; }, 1000);
        }).catch(function(err) {
            showError('signupError', 'เกิดข้อผิดพลาด: ' + err.message);
            setLoading('signupBtn', false, 'สมัครสมาชิก');
        });
    };
})();
