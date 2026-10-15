/**
 * Reset Password Page (F-07: รีเซ็ตรหัสผ่านด้วยรหัส OTP)
 *
 * ขั้นที่ 1  กรอกอีเมล → Auth.requestPasswordReset() ให้ Supabase ส่งรหัส OTP ทางอีเมล
 *           (template "Reset Password" ต้องมี {{ .Token }} — ดูคู่มือติดตั้ง)
 * ขั้นที่ 2  กรอกรหัส OTP + รหัสผ่านใหม่ → Auth.verifyRecoveryOtp() → Auth.updatePassword()
 *
 * - ตรวจรหัสผ่านใหม่ก่อนยืนยันรหัส OTP เสมอ เพราะรหัส OTP ใช้ได้ครั้งเดียว
 * - ยืนยันรหัสผ่านแล้วแต่ตั้งรหัสผ่านไม่ผ่าน (เช่น ซ้ำรหัสเดิม) แก้รหัสผ่านแล้วกดใหม่ได้เลย
 *   ไม่ต้องขอรหัส OTP ใหม่ (เก็บ access token ไว้ในหน่วยความจำของหน้านี้เท่านั้น)
 * - จำอีเมลที่ขอรหัสไว้ใน sessionStorage เพื่อให้รีเฟรชหน้าแล้วกลับมากรอกรหัสต่อได้
 * - ยังรองรับลิงก์แบบเดิม (#access_token=...&type=recovery) ถ้า template ยังเป็นแบบลิงก์
 */
var ResetPassword = (function() {
    var PENDING_KEY = 'pct_reset_pending';   // { email, sentAt } ของคำขอรหัสล่าสุด
    var PREFILL_KEY = 'pct_reset_email';     // อีเมลที่ส่งมาจากหน้า Login / Profile
    var LOGIN_EMAIL_KEY = 'pct_login_email'; // เติมอีเมลให้หน้า Login หลังตั้งรหัสสำเร็จ
    var RESEND_SECONDS = 60;                 // Supabase ให้ขอรหัสซ้ำได้ทุก 60 วินาที
    var PENDING_MAX_AGE_MS = 60 * 60 * 1000; // รหัส OTP มีอายุ 1 ชั่วโมงตามค่าเริ่มต้นของ Supabase
    var MIN_PASSWORD = 8;
    var OTP_PATTERN = /^\d{6,10}$/;
    var EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    var _email = null;
    var _accessToken = null; // ได้หลังยืนยันรหัส OTP สำเร็จ หรือจากลิงก์แบบเดิม
    var _viaLink = false;
    var _busy = false;
    var _resendAt = 0;
    var _timer = null;

    // ---------------------------------------------------------------- helpers
    function $(id) { return document.getElementById(id); }

    function storeGet(key) {
        try {
            var raw = window.sessionStorage.getItem(key);
            return raw ? JSON.parse(raw) : null;
        } catch (e) { return null; }
    }

    function storeSet(key, value) {
        try {
            if (value === null || value === undefined) window.sessionStorage.removeItem(key);
            else window.sessionStorage.setItem(key, JSON.stringify(value));
        } catch (e) { /* โหมดส่วนตัวบางเบราว์เซอร์ใช้ sessionStorage ไม่ได้ — ข้ามไป */ }
    }

    function normalizeEmail(value) {
        return String(value || '').trim().toLowerCase();
    }

    // รับรหัสที่มีช่องว่าง/ขีด และเลขไทย (๐–๙) จากแป้นพิมพ์ภาษาไทย
    function normalizeCode(value) {
        return String(value || '')
            .replace(/[\u0E50-\u0E59]/g, function(c) { return String(c.charCodeAt(0) - 0x0E50); })
            .replace(/[\s-]/g, '');
    }

    function parseHash() {
        var params = {};
        (window.location.hash || '').replace(/^#/, '').split('&').forEach(function(pair) {
            if (!pair) return;
            var i = pair.indexOf('=');
            try {
                var key = decodeURIComponent(i >= 0 ? pair.slice(0, i) : pair);
                params[key] = i >= 0 ? decodeURIComponent(pair.slice(i + 1).replace(/\+/g, ' ')) : '';
            } catch (e) { /* hash ที่ถอดรหัสไม่ได้ — ข้าม */ }
        });
        return params;
    }

    function show(id) {
        ['requestForm', 'verifyForm', 'successPanel'].forEach(function(panel) {
            $(panel).classList.toggle('hidden', panel !== id);
        });
        $('backToLogin').classList.toggle('hidden', id === 'successPanel');
    }

    function showNotice(kind, message) {
        var el = $('notice');
        if (!message) { el.classList.add('hidden'); el.textContent = ''; return; }
        el.textContent = message;
        el.className = 'text-sm rounded-lg px-4 py-3 mb-4 ' + (kind === 'warn'
            ? 'bg-amber-50 text-amber-800 border border-amber-200'
            : 'bg-green-50 text-green-700 border border-green-200');
    }

    function setError(id, message) {
        var el = $(id);
        if (message) { el.textContent = message; el.classList.remove('hidden'); }
        else { el.textContent = ''; el.classList.add('hidden'); }
    }

    function setLoading(btnId, loading, text) {
        var btn = $(btnId);
        btn.disabled = loading;
        btn.innerHTML = loading
            ? '<i class="fa-solid fa-spinner fa-spin mr-2"></i>' + text
            : '<span>' + text + '</span>';
    }

    function isNetworkError(err) {
        return !err || !err.status;
    }

    function isRateLimited(err) {
        return !!err && (err.status === 429 || /rate_limit/.test(String(err.code || '')) ||
            /rate limit|security purposes/i.test(err.message || ''));
    }

    // ขอซ้ำเร็วเกินไป: "For security purposes, you can only request this after 32 seconds." → 32
    // ส่วนโควตาอีเมลรายชั่วโมงของทั้งโปรเจกต์ ("email rate limit exceeded") ไม่มีตัวเลขวินาที → null
    function waitSeconds(err) {
        var m = /(\d+)\s*second/i.exec((err && err.message) || '');
        var n = m ? parseInt(m[1], 10) : NaN;
        return n > 0 && n <= 3600 ? n : null;
    }

    function requestErrorMessage(err) {
        if (isNetworkError(err)) return 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่';
        if (isRateLimited(err)) {
            var wait = waitSeconds(err);
            return wait
                ? 'ขอรหัสบ่อยเกินไป กรุณารอ ' + wait + ' วินาทีแล้วลองใหม่'
                : 'ระบบส่งอีเมลครบจำนวนที่กำหนดต่อชั่วโมงแล้ว กรุณาลองใหม่ภายหลัง';
        }
        if (err.code === 'email_address_not_authorized' || /not authorized/i.test(err.message || '')) {
            // SMTP เริ่มต้นของ Supabase ส่งได้เฉพาะอีเมลสมาชิกทีม จนกว่าจะตั้ง Custom SMTP
            return 'ระบบยังส่งอีเมลถึงที่อยู่นี้ไม่ได้ กรุณาติดต่อผู้ดูแลระบบ';
        }
        if (err.code === 'email_address_invalid' || (err.status === 400 && /email/i.test(err.message || ''))) {
            return 'รูปแบบอีเมลไม่ถูกต้อง';
        }
        if (err.status >= 500) return 'ระบบส่งอีเมลไม่สำเร็จในขณะนี้ กรุณาลองใหม่ภายหลัง';
        return 'ส่งรหัสไม่สำเร็จ กรุณาลองใหม่อีกครั้ง';
    }

    // ---------------------------------------------------------------- ตัวนับถอยหลังปุ่ม "ส่งรหัสใหม่"
    function stopCooldown() {
        if (_timer) { clearInterval(_timer); _timer = null; }
    }

    function renderCooldown() {
        var btn = $('resendBtn');
        var left = Math.ceil((_resendAt - Date.now()) / 1000);
        if (left > 0) {
            btn.disabled = true;
            btn.textContent = 'ส่งรหัสใหม่ได้ใน ' + left + ' วินาที';
            return;
        }
        stopCooldown();
        btn.disabled = _busy;
        btn.textContent = 'ส่งรหัสใหม่';
    }

    function startCooldown(seconds) {
        stopCooldown();
        _resendAt = Date.now() + seconds * 1000;
        renderCooldown();
        _timer = setInterval(renderCooldown, 1000);
    }

    // ---------------------------------------------------------------- สลับขั้นตอน
    function showRequest(prefillEmail) {
        stopCooldown();
        _accessToken = null;
        _viaLink = false;
        if (prefillEmail) $('resetEmail').value = prefillEmail;
        setError('requestError', null);
        show('requestForm');
        $('resetEmail').focus();
    }

    function setCodeVerified(verified) {
        $('otpCode').disabled = verified;
        $('otpVerified').classList.toggle('hidden', !verified);
        $('codeActions').classList.toggle('hidden', verified || _viaLink);
        $('codeHint').classList.toggle('hidden', verified || _viaLink);
    }

    function showVerify() {
        setError('resetError', null);
        $('otpGroup').classList.toggle('hidden', _viaLink);
        $('sentToLine').classList.toggle('hidden', _viaLink);
        $('sentEmail').textContent = _email || '';
        $('otpCode').value = '';
        setCodeVerified(!!_accessToken && !_viaLink);
        show('verifyForm');
        if (_viaLink) {
            $('newPassword').focus();
        } else {
            if (_resendAt > Date.now()) startCooldown(Math.ceil((_resendAt - Date.now()) / 1000));
            else renderCooldown();
            $('otpCode').focus();
        }
    }

    // ---------------------------------------------------------------- ขั้นที่ 1: ขอรหัส
    // คืน true เมื่อส่งสำเร็จ หรือคืน Error เมื่อไม่สำเร็จ (ไม่ reject — ผู้เรียกแสดงข้อความเอง)
    function requestCode(email, btnId, idleText) {
        _busy = true;
        setLoading(btnId, true, 'กำลังส่งรหัส...');
        return Auth.requestPasswordReset(email).then(function() {
            return true;
        }, function(err) {
            return err || new Error('request failed');
        }).then(function(result) {
            _busy = false;
            setLoading(btnId, false, idleText);
            if (result === true) {
                _email = email;
                _accessToken = null;
                storeSet(PENDING_KEY, { email: email, sentAt: Date.now() });
                _resendAt = Date.now() + RESEND_SECONDS * 1000;
                showVerify();
                showNotice('ok', 'ถ้าอีเมลนี้มีบัญชีอยู่ในระบบ เราได้ส่งรหัส OTP ไปแล้ว กรุณาตรวจสอบกล่องจดหมาย (รวมถึง Spam/Junk)');
            } else if (isRateLimited(result)) {
                _resendAt = Date.now() + (waitSeconds(result) || RESEND_SECONDS) * 1000;
            }
            return result;
        });
    }

    function sendCode(e) {
        if (e) e.preventDefault();
        if (_busy) return;
        setError('requestError', null);
        showNotice(null);
        var email = normalizeEmail($('resetEmail').value);
        if (!EMAIL_PATTERN.test(email)) {
            setError('requestError', 'กรุณากรอกอีเมลให้ถูกต้อง');
            $('resetEmail').focus();
            return;
        }
        requestCode(email, 'sendCodeBtn', 'ส่งรหัส OTP').then(function(result) {
            if (result === true) return;
            var msg = requestErrorMessage(result);
            if (isRateLimited(result)) msg += ' — ถ้าได้รับรหัสจากครั้งก่อนแล้ว กด "มีรหัส OTP อยู่แล้ว"';
            setError('requestError', msg);
        });
    }

    // ไปกรอกรหัสได้เลยถ้าได้รับรหัสแล้ว (เช่น เผลอปิดหน้าไปหลังขอรหัส)
    function haveCode() {
        if (_busy) return;
        setError('requestError', null);
        var email = normalizeEmail($('resetEmail').value);
        if (!EMAIL_PATTERN.test(email)) {
            setError('requestError', 'กรอกอีเมลที่ขอรหัสไว้ก่อน แล้วกด "มีรหัส OTP อยู่แล้ว" อีกครั้ง');
            $('resetEmail').focus();
            return;
        }
        _email = email;
        _accessToken = null;
        var pending = storeGet(PENDING_KEY);
        var sentAt = pending && pending.email === email && typeof pending.sentAt === 'number' ? pending.sentAt : 0;
        storeSet(PENDING_KEY, { email: email, sentAt: sentAt });
        if (sentAt) _resendAt = Math.max(_resendAt, sentAt + RESEND_SECONDS * 1000);
        showNotice(null);
        showVerify();
    }

    function resend() {
        if (_busy || !_email || _accessToken) return;
        if (_resendAt > Date.now()) { startCooldown(Math.ceil((_resendAt - Date.now()) / 1000)); return; }
        setError('resetError', null);
        showNotice(null);
        requestCode(_email, 'resendBtn', 'ส่งรหัสใหม่').then(function(result) {
            if (result === true) return;
            if (_resendAt > Date.now()) startCooldown(Math.ceil((_resendAt - Date.now()) / 1000));
            else renderCooldown();
            setError('resetError', requestErrorMessage(result));
        });
    }

    function changeEmail() {
        if (_busy) return;
        storeSet(PENDING_KEY, null);
        showNotice(null);
        showRequest(_email);
    }

    // ---------------------------------------------------------------- ขั้นที่ 2: ยืนยันรหัส + ตั้งรหัสผ่าน
    function verifyErrorMessage(err) {
        if (isNetworkError(err)) return 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่';
        if (isRateLimited(err)) return 'ลองยืนยันรหัสหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่';
        if (err.code === 'otp_expired' || err.status === 403 || err.status === 401 ||
            /expired|invalid/i.test(err.message || '')) {
            return 'รหัส OTP ไม่ถูกต้องหรือหมดอายุแล้ว ตรวจรหัสอีกครั้ง หรือกด "ส่งรหัสใหม่"';
        }
        return 'ยืนยันรหัสไม่สำเร็จ: ' + (err.message || 'กรุณาลองใหม่อีกครั้ง');
    }

    function updateErrorMessage(err) {
        if (isNetworkError(err)) return 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วกดบันทึกอีกครั้ง';
        if (err.code === 'same_password' || /different from the old/i.test(err.message || '')) {
            return 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม กรุณาตั้งรหัสอื่นแล้วกดบันทึกอีกครั้ง';
        }
        if (err.code === 'weak_password' || /weak|at least|should contain/i.test(err.message || '')) {
            return 'รหัสผ่านไม่ปลอดภัยพอ กรุณาตั้งให้ยาวขึ้นหรือผสมตัวอักษรและตัวเลข';
        }
        return 'ตั้งรหัสผ่านไม่สำเร็จ: ' + (err.message || 'กรุณาลองใหม่อีกครั้ง');
    }

    // session ชั่วคราวใช้ไม่ได้แล้ว (หมดอายุ/ถูกยกเลิก) ต้องเริ่มขอรหัสใหม่
    function sessionLost() {
        _accessToken = null;
        storeSet(PENDING_KEY, null);
        if (_viaLink || !_email) {
            showRequest(_email);
            showNotice('warn', 'การยืนยันตัวตนหมดอายุแล้ว กรุณาขอรหัส OTP ใหม่');
        } else {
            setCodeVerified(false);
            $('otpCode').value = '';
            _resendAt = 0;
            renderCooldown();
            setError('resetError', 'การยืนยันรหัสหมดอายุแล้ว กรุณากด "ส่งรหัสใหม่" เพื่อขอรหัส OTP ใหม่');
        }
    }

    function finish(token) {
        Auth.revokeSession(token);
        _accessToken = null;
        stopCooldown();
        storeSet(PENDING_KEY, null);
        if (_email) storeSet(LOGIN_EMAIL_KEY, _email);
        // ล้าง session เดิมในเครื่อง (ถ้ามี) ให้เข้าสู่ระบบใหม่ด้วยรหัสผ่านใหม่
        Auth.clearSession();
        showNotice(null);
        show('successPanel');
        setTimeout(function() { window.location.href = 'login.html'; }, 2500);
    }

    function submit(e) {
        if (e) e.preventDefault();
        if (_busy) return;
        setError('resetError', null);

        var code = '';
        if (!_accessToken) {
            code = normalizeCode($('otpCode').value);
            if (!code) { setError('resetError', 'กรุณากรอกรหัส OTP จากอีเมล'); $('otpCode').focus(); return; }
            if (!OTP_PATTERN.test(code)) {
                setError('resetError', 'รหัส OTP ต้องเป็นตัวเลข 6–10 หลักตามที่ได้รับทางอีเมล');
                $('otpCode').focus();
                return;
            }
            if (!_email) { showRequest(); return; }
        }
        var pw = $('newPassword').value;
        var confirmPw = $('confirmPassword').value;
        if (pw.length < MIN_PASSWORD) {
            setError('resetError', 'รหัสผ่านต้องมีความยาวไม่น้อยกว่า ' + MIN_PASSWORD + ' ตัวอักษร');
            $('newPassword').focus();
            return;
        }
        if (pw !== confirmPw) {
            setError('resetError', 'รหัสผ่านทั้งสองช่องไม่ตรงกัน');
            $('confirmPassword').focus();
            return;
        }

        _busy = true;
        $('resendBtn').disabled = true;
        $('changeEmailBtn').disabled = true;
        setLoading('resetBtn', true, _accessToken ? 'กำลังบันทึก...' : 'กำลังยืนยันรหัส...');

        var tokenStep = _accessToken
            ? Promise.resolve(_accessToken)
            : Auth.verifyRecoveryOtp(_email, code).then(function(session) {
                // รหัส OTP ถูกใช้ไปแล้ว: เก็บ token ไว้ให้ลองตั้งรหัสผ่านใหม่ได้โดยไม่ต้องขอรหัสอีก
                _accessToken = session.access_token;
                storeSet(PENDING_KEY, null);
                setCodeVerified(true);
                setLoading('resetBtn', true, 'กำลังบันทึก...');
                return _accessToken;
            }, function(err) {
                err.stage = 'verify';
                throw err;
            });

        tokenStep.then(function(token) {
            return Auth.updatePassword(token, pw).then(function() { return token; }, function(err) {
                err.stage = 'update';
                throw err;
            });
        }).then(function(token) {
            _busy = false;
            finish(token);
        }).catch(function(err) {
            _busy = false;
            setLoading('resetBtn', false, 'ยืนยันและตั้งรหัสผ่านใหม่');
            $('changeEmailBtn').disabled = false;
            renderCooldown();
            if (err && err.stage === 'update' && (err.status === 401 || err.status === 403)) {
                sessionLost();
                return;
            }
            if (err && err.stage === 'update') {
                setError('resetError', updateErrorMessage(err));
                $('newPassword').focus();
                return;
            }
            setError('resetError', verifyErrorMessage(err || {}));
            $('otpCode').focus();
            $('otpCode').select();
        });
    }

    // ---------------------------------------------------------------- เริ่มหน้า
    function init() {
        var hash = parseHash();
        // เอา token ออกจากแถบที่อยู่ทันที กันติดไปกับประวัติเบราว์เซอร์หรือการแชร์ลิงก์
        if (window.location.hash && window.history && window.history.replaceState) {
            window.history.replaceState(null, '', window.location.pathname + window.location.search);
        }

        var prefill = storeGet(PREFILL_KEY);
        storeSet(PREFILL_KEY, null);
        prefill = typeof prefill === 'string' ? normalizeEmail(prefill) : '';

        // ลิงก์แบบเดิมจากอีเมล (template ยังไม่ได้เปลี่ยนเป็นรหัส OTP)
        if (hash.access_token && hash.type === 'recovery') {
            _viaLink = true;
            _accessToken = hash.access_token;
            showVerify();
            showNotice('ok', 'ยืนยันตัวตนจากลิงก์ในอีเมลแล้ว ตั้งรหัสผ่านใหม่ได้เลย');
            return;
        }
        if (hash.error || hash.error_code) {
            showRequest(prefill);
            showNotice('warn', 'ลิงก์ในอีเมลหมดอายุหรือถูกใช้ไปแล้ว กรุณาขอรหัส OTP ใหม่ด้านล่าง');
            return;
        }

        // กลับมากรอกรหัสต่อหลังรีเฟรชหน้า (ถ้าอีเมลจากหน้า Login/Profile เป็นคนละอีเมล ให้เริ่มใหม่)
        var pending = storeGet(PENDING_KEY);
        if (pending && typeof pending.email === 'string' && EMAIL_PATTERN.test(pending.email) &&
            typeof pending.sentAt === 'number' && (!prefill || prefill === pending.email) &&
            (pending.sentAt === 0 || Date.now() - pending.sentAt < PENDING_MAX_AGE_MS)) {
            _email = pending.email;
            _resendAt = pending.sentAt + RESEND_SECONDS * 1000;
            showVerify();
            return;
        }
        storeSet(PENDING_KEY, null);
        showRequest(prefill);
    }

    document.addEventListener('DOMContentLoaded', init);
    return {
        sendCode: sendCode,
        haveCode: haveCode,
        resend: resend,
        changeEmail: changeEmail,
        submit: submit
    };
})();
