// Refuz — storefront device fingerprint → cart attribute `_dev`.
// Loaded by the theme app extension on every page. Privacy note goes in the shop's policy.
(function () {
  if (window.__refuzDev) return; window.__refuzDev = 1;
  var KEY = 'refuz_id';
  function rnd() { var a = new Uint8Array(16); crypto.getRandomValues(a); return Array.from(a, function (b) { return b.toString(16).padStart(2, '0'); }).join(''); }
  function stored() {
    var v = null;
    try { v = localStorage.getItem(KEY); } catch (e) {}
    if (!v) { var m = document.cookie.match(/(?:^|; )refuz_id=([0-9a-f]{32})/); if (m) v = m[1]; }
    if (!v) v = rnd();
    try { localStorage.setItem(KEY, v); } catch (e) {}
    try { document.cookie = KEY + '=' + v + ';path=/;max-age=31536000;SameSite=Lax;Secure'; } catch (e) {}
    return v;
  }
  function gl() {
    try { var c = document.createElement('canvas'), g = c.getContext('webgl') || c.getContext('experimental-webgl'); if (!g) return ''; var d = g.getExtension('WEBGL_debug_renderer_info'); return d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : ''; } catch (e) { return ''; }
  }
  function canvas() {
    try { var c = document.createElement('canvas'); c.width = 200; c.height = 40; var x = c.getContext('2d'); x.textBaseline = 'top'; x.font = '14px Arial'; x.fillStyle = '#f60'; x.fillRect(100, 1, 60, 20); x.fillStyle = '#069'; x.fillText('Refuz ✓ ăîșț', 2, 2); return c.toDataURL().slice(-64); } catch (e) { return ''; }
  }
  function fp() {
    var parts = [navigator.userAgent, navigator.language, (navigator.languages || []).join(','), screen.width + 'x' + screen.height + 'x' + (window.devicePixelRatio || 1), Intl.DateTimeFormat().resolvedOptions().timeZone, navigator.hardwareConcurrency || '', navigator.deviceMemory || '', gl(), canvas(), stored()];
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts.join('|'))).then(function (b) { return Array.from(new Uint8Array(b), function (x) { return x.toString(16).padStart(2, '0'); }).join(''); });
  }
  function setAttr(h) {
    try { if (sessionStorage.getItem('refuz_dev') === h) return; } catch (e) {}
    fetch('/cart/update.js', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ attributes: { _dev: h } }) })
      .then(function () { try { sessionStorage.setItem('refuz_dev', h); } catch (e) {} }).catch(function () {});
  }
  function go() { fp().then(setAttr); }
  if (document.readyState === 'complete') setTimeout(go, 800); else window.addEventListener('load', function () { setTimeout(go, 800); });
  // re-apply after cart changes (themes replace the cart via AJAX)
  var orig = window.fetch; window.fetch = function (u, o) { var p = orig.apply(this, arguments); try { if (typeof u === 'string' && /\/cart\/(add|change|clear)/.test(u)) p.then(function () { setTimeout(go, 300); }); } catch (e) {} return p; };
})();
