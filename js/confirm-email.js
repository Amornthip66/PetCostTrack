/**
 * Confirm Email Page (F-07: ยืนยันอีเมลหลังสมัครสมาชิก)
 *
 * ปุ่ม "ยืนยันอีเมล" ในอีเมล (template "Confirm signup") พามาที่หน้านี้พร้อม ?token_hash=...&type=email
 * หน้านี้ยืนยันกับ Supabase เอง (Auth.verifyEmailTokenHash → POST /verify) แล้วแสดงผลให้เห็นชัดเจน
 * - ยืนยันสำเร็จ → ได้ session → เข้าสู่ระบบให้ทันที แล้วกด "เริ่มใช้งาน" เข้าแอปได้เลย
 * - ลิงก์ถูกใช้ไปแล้ว/หมดอายุ → บอกเหตุผล และขออีเมลยืนยันใหม่ได้จากหน้านี้
 * - เชื่อมต่อไม่ได้/ระบบขัดข้อง → ลิงก์ยังไม่ถูกใช้ กด "ลองอีกครั้ง" ได้
 * - ยังรองรับลิงก์แบบเดิมจากอีเมลที่ส่งก่อนเปลี่ยน template
 *   (#access_token=...&type=signup หรือ #error_code=otp_expired ที่ Supabase แนบมาตอน redirect)
 */
var ConfirmEmail = (function() {
    var TYPES = ['email', 'signup'];
    var TOKEN_HASH_PATTERN = /^[A-Za-z0-9_-]{10,200}$/;
    var EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    var LOGIN_EMAIL_KEY = 'pct_login_email'; // login.js เติมอีเมลนี้ให้ในช่องเข้าสู่ระบบ
    var RESEND_SECONDS = 60;                  // Supabase ให้ขออีเมลยืนยันซ้ำได้ทุก 60 วินาที

    var _tokenHash = null;
    var _type = 'email';
    var _busy = false;
    var _resendBusy = false;
    var _resendAt = 0;
    var _timer = null;

    // ---------------------------------------------------------------- helpers
    function $(id) { return document.getElementById(id); }

    function storeSet(key, value) {
        try { window.sessionStorage.setItem(key, JSON.stringify(value)); }
        catch (e) { /* โหมดส่วนตัวบางเบราว์เซอร์ใช้ sessionStorage ไม่ได้ — ข้ามไป */ }
    }

    function parseParams(text) {
        var params = {};
        String(text || '').replace(/^[?#]/, '').split('&').forEach(function(pair) {
            if (!pair) return;
            var i = pair.indexOf('=');
            try {
                var key = decodeURIComponent(i >= 0 ? pair.slice(0, i) : pair);
                params[key] = i >= 0 ? decodeURIComponent(pair.slice(i + 1).replace(/\+/g, ' ')) : '';
            } catch (e) { /* ค่าที่ถอดรหัสไม่ได้ — ข้าม */ }
        });
        return params;
    }

    function show(panelId, withResend) {
        ['loadingPanel', 'successPanel', 'expiredPanel', 'errorPanel', 'idlePanel'].forEach(function(id) {
            $(id).classList.toggle('hidden', id !== panelId);
        });
        $('resendForm').classList.toggle('hidden', !withResend);
    }

    function setText(id, message) {
        var el = $(id);
        el.textContent = message || '';
        el.classList.toggle('hidden', !message);
    }

    // บันทึก session ไม่ได้ (เช่น เบราว์เซอร์ปิด localStorage) ก็ยังถือว่ายืนยันอีเมลสำเร็จ ให้ไปเข้าสู่ระบบเอง
    function trySaveSession(data) {
        try { Auth.saveSession(data); return true; }
        catch (e) { console.warn('Cannot save session:', e); return false; }
    }

    function isNetworkError(err) {
        return !err || !err.status;
    }

    function isRateLimited(err) {
        return !!err && (err.status === 429 || /rate_limit/.test(String(err.code || '')) ||
            /rate limit|security purposes/i.test(err.message || ''));
    }

    // ขอซ้ำเร็วเกินไป: "For security purposes, you can only request this after 32 seconds." → 32
    function waitSeconds(err) {
        var m = /(\d+)\s*second/i.exec((err && err.message) || '');
        var n = m ? parseInt(m[1], 10) : NaN;
        return n > 0 && n <= 3600 ? n : null;
    }

    // ---------------------------------------------------------------- ผลการยืนยัน
    function showSuccess(email, loggedIn) {
        $('confirmedEmail').textContent = email || 'ของคุณ';
        if (loggedIn) {
            $('successHint').textContent = 'เข้าสู่ระบบให้เรียบร้อยแล้ว';
            $('startBtn').textContent = 'เริ่มใช้งาน PetCostTrack';
            $('startBtn').setAttribute('href', 'index.html');
        } else {
            $('successHint').textContent = 'เข้าสู่ระบบด้วยอีเมลและรหัสผ่านที่ตั้งไว้ตอนสมัคร';
            $('startBtn').textContent = 'เข้าสู่ระบบ';
            $('startBtn').setAttribute('href', 'login.html');
            if (email) storeSet(LOGIN_EMAIL_KEY, email);
        }
        show('successPanel', false);
    }

    function showExpired(email) {
        if (email && !$('resendEmail').value) $('resendEmail').value = email;
        show('expiredPanel', true);
    }

    function showError(message) {
        $('errorText').textContent = message;
        $('retryBtn').disabled = false;
        show('errorPanel', false);
    }

    function verifyErrorMessage(err) {
        if (isNetworkError(err)) return 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วกด "ลองอีกครั้ง"';
        if (isRateLimited(err)) return 'มีการลองหลายครั้งเกินไป กรุณารอสักครู่แล้วกด "ลองอีกครั้ง"';
        return 'ระบบขัดข้องชั่วคราว กรุณากด "ลองอีกครั้ง"';
    }

    // ลิงก์ใช้ไม่ได้จริง (ใช้ไปแล้ว/หมดอายุ/ไม่ถูกต้อง) ต่างจากเน็ตหลุดหรือเซิร์ฟเวอร์ขัดข้องที่ลองใหม่ได้
    function isLinkInvalid(err) {
        if (isNetworkError(err) || isRateLimited(err)) return false;
        return err.status < 500;
    }

    // ---------------------------------------------------------------- ยืนยันด้วย token_hash
    function verify() {
        if (_busy || !_tokenHash) return;
        _busy = true;
        show('loadingPanel', false);
        Auth.verifyEmailTokenHash(_tokenHash, _type)
        .then(function(data) {
            var email = data && data.user && data.user.email;
            if (!data || !data.access_token) {
                // ยืนยันแล้วแต่ไม่ได้ session กลับมา — ให้เข้าสู่ระบบเอง
                _tokenHash = null;
                _busy = false;
                showSuccess(email, false);
                return;
            }
            _tokenHash = null; // ลิงก์ใช้ได้ครั้งเดียว ไม่ต้องลองซ้ำอีก
            if (!trySaveSession(data)) {
                _busy = false;
                showSuccess(email, false);
                return;
            }
            // ผูกข้อมูลผู้ใช้กับ seed (ไม่ critical — autoLinkUser จัดการ error เองและไม่ reject)
            return Auth.autoLinkUser().then(function() {
                _busy = false;
                showSuccess(email, true);
            });
        })
        .catch(function(err) {
            _busy = false;
            console.warn('Confirm email failed:', err);
            if (isLinkInvalid(err)) {
                _tokenHash = null;
                showExpired('');
                return;
            }
            showError(verifyErrorMessage(err));
        });
    }

    function retry() {
        if (_busy) return;
        if (!_tokenHash) { showExpired(''); return; }
        $('retryBtn').disabled = true;
        verify();
    }

    // ---------------------------------------------------------------- ลิงก์แบบเดิม (#access_token=...&type=signup)
    // Supabase ยืนยันอีเมลให้แล้วก่อน redirect มา จึงแสดงสำเร็จได้เลย
    // แต่ตรวจ token กับ Supabase ก่อนบันทึกเป็น session เสมอ (ไม่เชื่อค่าใน URL ตรงๆ)
    function confirmFromLegacyHash(hash) {
        _busy = true;
        show('loadingPanel', false);
        Auth.fetchUser(hash.access_token)
        .then(function(user) {
            var session = {
                access_token: hash.access_token,
                refresh_token: hash.refresh_token,
                token_type: hash.token_type || 'bearer',
                user: user
            };
            var expiresIn = parseInt(hash.expires_in, 10);
            var expiresAt = parseInt(hash.expires_at, 10);
            if (expiresAt > 0) session.expires_at = expiresAt;
            else if (expiresIn > 0) session.expires_in = expiresIn;
            if (!trySaveSession(session)) {
                _busy = false;
                showSuccess(user.email, false);
                return;
            }
            return Auth.autoLinkUser().then(function() {
                _busy = false;
                showSuccess(user.email, true);
            });
        })
        .catch(function(err) {
            console.warn('Legacy confirm link: session not usable', err);
            _busy = false;
            showSuccess('', false);
        });
    }

    // ---------------------------------------------------------------- ขออีเมลยืนยันใหม่
    function renderResendButton() {
        var btn = $('resendBtn');
        var left = Math.ceil((_resendAt - Date.now()) / 1000);
        if (left > 0) {
            btn.disabled = true;
            btn.innerHTML = '<span>ส่งใหม่ได้ใน ' + left + ' วินาที</span>';
            return;
        }
        if (_timer) { clearInterval(_timer); _timer = null; }
        btn.disabled = _resendBusy;
        btn.innerHTML = _resendBusy
            ? '<i class="fa-solid fa-spinner fa-spin mr-2"></i>กำลังส่ง...'
            : '<span>ส่งอีเมลยืนยันใหม่</span>';
    }

    function startCooldown(seconds) {
        _resendAt = Date.now() + seconds * 1000;
        if (_timer) clearInterval(_timer);
        _timer = setInterval(renderResendButton, 1000);
        renderResendButton();
    }

    function resendErrorMessage(err) {
        if (isNetworkError(err)) return 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่';
        if (isRateLimited(err)) {
            var wait = waitSeconds(err);
            if (wait) return 'กรุณารอ ' + wait + ' วินาทีแล้วลองใหม่';
            return 'ขณะนี้ระบบส่งอีเมลครบจำนวนที่กำหนดต่อชั่วโมงแล้ว กรุณาลองใหม่ภายหลัง (ประมาณ 1 ชั่วโมง)';
        }
        if (err.code === 'email_address_invalid' || /invalid format|unable to validate email/i.test(err.message || '')) {
            return 'รูปแบบอีเมลไม่ถูกต้อง';
        }
        if (err.code === 'email_address_not_authorized' || /not authorized/i.test(err.message || '')) {
            return 'ระบบยังส่งอีเมลถึงที่อยู่นี้ไม่ได้ กรุณาติดต่อผู้ดูแลระบบ';
        }
        if (err.status >= 500) return 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง';
        return 'ส่งอีเมลไม่สำเร็จ: ' + (err.message || 'กรุณาลองใหม่อีกครั้ง');
    }

    function resend(e) {
        if (e) e.preventDefault();
        if (_resendBusy || _resendAt > Date.now()) return;
        setText('resendError', '');
        setText('resendOk', '');
        var email = String($('resendEmail').value || '').trim().toLowerCase();
        if (!EMAIL_PATTERN.test(email)) {
            setText('resendError', 'กรุณากรอกอีเมลที่ใช้สมัครให้ถูกต้อง');
            $('resendEmail').focus();
            return;
        }
        _resendBusy = true;
        renderResendButton();
        Auth.resendSignupConfirmation(email)
        .then(function() {
            _resendBusy = false;
            // Supabase ตอบสำเร็จเหมือนกันไม่ว่าอีเมลนี้สมัครไว้หรือยืนยันไปแล้วหรือไม่ (กันการเดาอีเมลสมาชิก)
            setText('resendOk', 'ถ้าอีเมลนี้สมัครไว้และยังไม่ได้ยืนยัน ระบบจะส่งอีเมลยืนยันฉบับใหม่ไปให้ '
                + 'กรุณาตรวจสอบ Inbox/Spam แล้วกดปุ่ม “ยืนยันอีเมล” ในฉบับล่าสุด');
            startCooldown(RESEND_SECONDS);
        })
        .catch(function(err) {
            _resendBusy = false;
            var wait = isRateLimited(err) ? waitSeconds(err) : null;
            if (wait) startCooldown(wait);
            else renderResendButton();
            setText('resendError', resendErrorMessage(err || {}));
        });
    }

    // ---------------------------------------------------------------- เริ่มหน้า
    function init() {
        var query = parseParams(window.location.search);
        var hash = parseParams(window.location.hash);
        // เอา token ออกจากแถบที่อยู่ทันที กันติดไปกับประวัติเบราว์เซอร์/การแชร์ลิงก์
        // และกันการรีเฟรชหน้าแล้วยืนยันซ้ำด้วยลิงก์ที่ใช้ไปแล้ว
        if ((window.location.search || window.location.hash) && window.history && window.history.replaceState) {
            window.history.replaceState(null, '', window.location.pathname);
        }

        if (query.token_hash !== undefined) {
            if (!TOKEN_HASH_PATTERN.test(query.token_hash)) { showExpired(''); return; }
            _tokenHash = query.token_hash;
            _type = TYPES.indexOf(query.type) >= 0 ? query.type : 'email';
            verify();
            return;
        }
        if (hash.access_token && TYPES.indexOf(hash.type) >= 0) {
            confirmFromLegacyHash(hash);
            return;
        }
        if (hash.error || hash.error_code) {
            showExpired('');
            return;
        }
        // เปิดหน้านี้อีกครั้ง (เช่น รีเฟรชหลังยืนยัน) ขณะเข้าสู่ระบบอยู่: บัญชีที่เข้าสู่ระบบได้ยืนยันอีเมลแล้ว
        var session = Auth.getSession();
        if (session && session.access_token) {
            showSuccess(session.user && session.user.email, true);
            return;
        }
        show('idlePanel', true);
    }

    document.addEventListener('DOMContentLoaded', init);
    return {
        retry: retry,
        resend: resend
    };
})();
