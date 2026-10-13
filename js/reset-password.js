/**
 * Reset Password Page (F-07: รีเซ็ตรหัสผ่าน)
 *
 * ลิงก์ในอีเมลจาก Supabase (/auth/v1/recover) พามาที่หน้านี้พร้อม hash
 *   #access_token=...&expires_in=3600&refresh_token=...&token_type=bearer&type=recovery
 * หรือถ้าลิงก์หมดอายุ/ใช้ไปแล้ว
 *   #error=access_denied&error_code=otp_expired&error_description=...
 * ใช้ access_token นี้เรียก PUT /auth/v1/user เพื่อตั้งรหัสผ่านใหม่ โดยไม่เก็บเป็น
 * session ของแอป (ผู้ใช้ต้องเข้าสู่ระบบใหม่ด้วยรหัสผ่านใหม่เอง)
 */
var ResetPassword = (function() {
    var _token = null;

    function parseHash() {
        var params = {};
        (window.location.hash || '').replace(/^#/, '').split('&').forEach(function(pair) {
            if (!pair) return;
            var i = pair.indexOf('=');
            var key = decodeURIComponent(i >= 0 ? pair.slice(0, i) : pair);
            var value = i >= 0 ? decodeURIComponent(pair.slice(i + 1).replace(/\+/g, ' ')) : '';
            params[key] = value;
        });
        return params;
    }

    function show(id) {
        ['invalidPanel', 'resetForm', 'successPanel'].forEach(function(panel) {
            document.getElementById(panel).classList.toggle('hidden', panel !== id);
        });
    }

    function showInvalid(message) {
        if (message) document.getElementById('invalidMessage').textContent = message;
        show('invalidPanel');
    }

    function setError(message) {
        var el = document.getElementById('resetError');
        if (message) { el.textContent = message; el.classList.remove('hidden'); }
        else el.classList.add('hidden');
    }

    function setLoading(loading) {
        var btn = document.getElementById('resetBtn');
        btn.disabled = loading;
        btn.innerHTML = loading
            ? '<i class="fa-solid fa-spinner fa-spin mr-2"></i>กำลังบันทึก...'
            : '<span>บันทึกรหัสผ่านใหม่</span>';
    }

    function init() {
        var p = parseHash();
        // เอา token ออกจากแถบที่อยู่ทันที กันติดไปกับประวัติเบราว์เซอร์หรือการแชร์ลิงก์
        if (window.location.hash && window.history && window.history.replaceState) {
            window.history.replaceState(null, '', window.location.pathname + window.location.search);
        }
        if (p.error || p.error_code) {
            showInvalid(p.error_code === 'otp_expired'
                ? 'ลิงก์ตั้งรหัสผ่านหมดอายุหรือถูกใช้ไปแล้ว กรุณาขอลิงก์ใหม่'
                : 'ลิงก์ตั้งรหัสผ่านไม่ถูกต้อง กรุณาขอลิงก์ใหม่');
            return;
        }
        if (!p.access_token || p.type !== 'recovery') {
            showInvalid('ไม่พบลิงก์ตั้งรหัสผ่าน กรุณากดลิงก์จากอีเมลอีกครั้ง หรือขอลิงก์ใหม่');
            return;
        }
        _token = p.access_token;
        show('resetForm');
        document.getElementById('newPassword').focus();
    }

    function submit(e) {
        e.preventDefault();
        setError(null);
        var pw = document.getElementById('newPassword').value;
        var confirmPw = document.getElementById('confirmPassword').value;
        if (pw.length < 8) { setError('รหัสผ่านต้องมีความยาวไม่น้อยกว่า 8 ตัวอักษร'); return; }
        if (pw !== confirmPw) { setError('รหัสผ่านทั้งสองช่องไม่ตรงกัน'); return; }
        if (!_token) { showInvalid(); return; }

        setLoading(true);
        Auth.updatePassword(_token, pw)
        .then(function() {
            // ล้าง session เดิมในเครื่อง (ถ้ามี) ให้เข้าสู่ระบบใหม่ด้วยรหัสผ่านใหม่
            Auth.clearSession();
            _token = null;
            show('successPanel');
            setTimeout(function() { window.location.href = 'login.html'; }, 2500);
        })
        .catch(function(err) {
            setLoading(false);
            if (err.code === 'same_password' || /different from the old/i.test(err.message || '')) {
                setError('รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม');
            } else if (err.code === 'weak_password' || /weak|at least/i.test(err.message || '')) {
                setError('รหัสผ่านไม่ปลอดภัยพอ กรุณาตั้งให้ยาวขึ้นหรือผสมตัวอักษรและตัวเลข');
            } else if (err.status === 401 || err.status === 403) {
                showInvalid('ลิงก์ตั้งรหัสผ่านหมดอายุแล้ว กรุณาขอลิงก์ใหม่');
            } else {
                setError('ตั้งรหัสผ่านไม่สำเร็จ: ' + (err.message || 'กรุณาลองใหม่อีกครั้ง'));
            }
        });
    }

    document.addEventListener('DOMContentLoaded', init);
    return { submit: submit };
})();
