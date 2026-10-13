/* Semafor storefront pop-up (theme app embed). No dependencies.
 * Config comes from window.SemaforPopup (written by blocks/semafor-popup.liquid).
 * window.SemaforPopupUI.render() is also used by the admin live preview, so both look the same. */
(function () {
  'use strict';
  var W = window, D = document;
  if (W.SemaforPopupUI) return;

  var LS = '_smf_pp', DEV = '_smf_dev', DAY = 86400000;

  // ── decorative motifs (one per design; colours come from the CSS palette) ──
  var LEAF = '<svg viewBox="0 0 100 160" fill="currentColor"><path d="M50 2c30 30 46 62 46 92 0 34-22 60-46 64C26 154 4 128 4 94 4 64 20 32 50 2zm0 22c-20 26-32 50-32 70 0 26 14 46 32 50 18-4 32-24 32-50 0-20-12-44-32-70z"/><path d="M48 24h4v130h-4z"/></svg>';
  function flake() {
    var arm = '<path d="M0-4V-46M0-32l-9-9M0-32l9-9M0-19l-7-7M0-19l7-7"/>', g = '';
    for (var i = 0; i < 6; i++) g += '<g transform="rotate(' + i * 60 + ')">' + arm + '</g>';
    return '<svg viewBox="-50 -50 100 100" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">' + g + '<circle r="4"/></svg>';
  }
  function blossom() {
    var p = '';
    for (var i = 0; i < 5; i++) p += '<ellipse cx="0" cy="-21" rx="12" ry="21" transform="rotate(' + i * 72 + ')"/>';
    return '<svg viewBox="-50 -50 100 100" fill="currentColor">' + p + '<circle r="7" fill-opacity=".6"/></svg>';
  }
  var SPRIG = '<svg viewBox="0 0 120 160" fill="currentColor"><path d="M58 158c2-40 6-92 30-150l4 2c-23 56-27 108-29 148z"/><path d="M72 64C48 60 32 44 30 22c22 2 40 18 42 42zM80 40c4-18 18-30 36-32-2 18-16 30-36 32zM66 104c-22 0-38-12-44-32 22-2 40 10 44 32zM70 92c8-18 24-26 42-24-6 18-22 26-42 24z"/></svg>';
  var SUN = '<svg viewBox="-50 -50 100 100" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle r="17" fill="currentColor" fill-opacity=".35"/>' +
    (function () { var r = ''; for (var i = 0; i < 12; i++) r += '<path d="M0-25V-40" transform="rotate(' + i * 30 + ')"/>'; return r; })() + '</svg>';
  var WAVES = '<svg viewBox="0 0 400 60" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" preserveAspectRatio="none"><path d="M0 14c25-10 50-10 75 0s50 10 75 0 50-10 75 0 50 10 75 0 50-10 75 0 50 10 75 0"/><path d="M0 34c25-10 50-10 75 0s50 10 75 0 50-10 75 0 50 10 75 0 50-10 75 0 50 10 75 0" opacity=".7"/><path d="M0 54c25-10 50-10 75 0s50 10 75 0 50-10 75 0 50 10 75 0 50-10 75 0 50 10 75 0" opacity=".45"/></svg>';
  var MAPLE = '<svg viewBox="0 0 100 100" fill="currentColor"><path d="M50 3l7 18 11-6-4 22 16-8-4 12 18 2-14 12 6 6-22 2 2 14-14-8v27h-4V69l-14 8 2-14-22-2 6-6L6 43l18-2-4-12 16 8-4-22 11 6z"/></svg>';
  var MOTIF = {
    classic: [LEAF, LEAF, ''],
    winter: [flake(), flake(), flake()],
    spring: [blossom(), SPRIG, blossom()],
    summer: [SUN, WAVES, ''],
    autumn: [MAPLE, MAPLE, MAPLE],
  };
  var X = '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M1 1l12 12M13 1L1 13"/></svg>';

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function para(s) { return esc(s).replace(/\n/g, '<br>'); }
  function textsOf(cfg, lang) {
    var T = (cfg && cfg.texts) || {}, l = String(lang || '').toLowerCase();
    return T[l] || T[l.slice(0, 2)] || T.en || T.ro || {};
  }

  /** Builds the pop-up element. o: { preview, instant, state, code, onSubmit(email, done), onClose(remember) } */
  function render(cfg, lang, o) {
    o = o || {};
    var t = textsOf(cfg, lang);
    var design = MOTIF[cfg.design] ? cfg.design : 'classic';
    var m = MOTIF[design];
    var root = D.createElement('div');
    root.className = 'smf-pp smf-pp--' + design + (o.instant ? ' smf-pp--instant is-visible' : '');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'smf-pp-h');
    var visual = cfg.image
      ? '<img src="' + esc(cfg.image) + '" alt="" loading="lazy">'
      : (m[0] ? '<span class="smf-pp__m smf-pp__m--1">' + m[0] + '</span>' : '') + (m[1] ? '<span class="smf-pp__m smf-pp__m--2">' + m[1] + '</span>' : '') + (m[2] ? '<span class="smf-pp__m smf-pp__m--3">' + m[2] + '</span>' : '');
    root.innerHTML = '<div class="smf-pp__backdrop" data-smf-close></div>' +
      '<div class="smf-pp__card">' +
      '<button type="button" class="smf-pp__close" aria-label="' + esc(t.close || 'Close') + '" data-smf-close>' + X + '</button>' +
      '<div class="smf-pp__visual" aria-hidden="true">' + visual +
      '<div class="smf-pp__big"><strong>' + esc(t.bigLabel) + '</strong><span>' + esc(t.bigSub) + '</span></div></div>' +
      '<div class="smf-pp__content" aria-live="polite"></div></div>';
    var content = root.querySelector('.smf-pp__content');

    function form(err, value) {
      content.innerHTML = '<p class="smf-pp__eyebrow">' + esc(t.eyebrow) + '</p>' +
        '<h2 class="smf-pp__heading" id="smf-pp-h">' + esc(t.heading) + '</h2>' +
        '<div class="smf-pp__text">' + para(t.text) + '</div>' +
        '<form class="smf-pp__form" novalidate>' +
        '<label class="smf-pp__field"><span class="smf-pp__sr">E-mail</span>' +
        '<input type="email" name="email" inputmode="email" autocomplete="email" required placeholder="' + esc(t.placeholder) + '" value="' + esc(value || '') + '">' +
        '<button type="submit" class="smf-pp__btn">' + esc(t.button) + '</button></label>' +
        (err ? '<p class="smf-pp__error" role="alert">' + esc(err) + '</p>' : '') +
        '</form>' +
        (t.note ? '<p class="smf-pp__note">' + esc(t.note) + '</p>' : '') +
        '<button type="button" class="smf-pp__decline" data-smf-close>' + esc(t.decline) + '</button>';
      var f = content.querySelector('form'), input = f.querySelector('input'), btn = f.querySelector('button');
      f.addEventListener('submit', function (e) {
        e.preventDefault();
        var email = String(input.value || '').trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { form(t.invalid, email); focus(); return; }
        if (!o.onSubmit) return;
        btn.disabled = true;
        o.onSubmit(email, function (error, code) { if (error) { form(t.failed, email); return; } success(code); });
      });
    }
    function success(code) {
      code = code || cfg.code || '';
      var back = (W.location && !o.preview) ? W.location.pathname + W.location.search : '/';
      var href = '/discount/' + encodeURIComponent(code) + '?redirect=' + encodeURIComponent(back);
      content.innerHTML = '<p class="smf-pp__eyebrow">' + esc(t.successEyebrow) + '</p>' +
        '<h2 class="smf-pp__heading" id="smf-pp-h">' + esc(t.successHeading) + '</h2>' +
        '<div class="smf-pp__text">' + para(t.successText) + '</div>' +
        (code ? '<div class="smf-pp__code"><strong>' + esc(code) + '</strong><button type="button" class="smf-pp__copy">' + esc(t.copy) + '</button></div>' +
          '<a class="smf-pp__btn smf-pp__apply" href="' + esc(href) + '">' + esc(t.successButton) + '</a>' : '') +
        (t.successNote ? '<p class="smf-pp__note">' + esc(t.successNote) + '</p>' : '');
      var c = content.querySelector('.smf-pp__copy');
      if (c) c.addEventListener('click', function () {
        try { if (navigator.clipboard) navigator.clipboard.writeText(code); } catch (e) { /* ignore */ }
        c.textContent = t.copied || t.copy;
        setTimeout(function () { c.textContent = t.copy; }, 2000);
      });
      if (o.preview) { var a = content.querySelector('.smf-pp__apply'); if (a) a.addEventListener('click', function (e) { e.preventDefault(); }); }
    }
    function focus() { var i = content.querySelector('input'); if (i && !o.preview) setTimeout(function () { try { i.focus({ preventScroll: true }); } catch (e) { i.focus(); } }, 60); }

    root.addEventListener('click', function (e) {
      var el = e.target;
      while (el && el !== root) { if (el.hasAttribute && el.hasAttribute('data-smf-close')) { if (o.onClose) o.onClose(true); return; } el = el.parentNode; }
    });
    if (o.state === 'success') success(o.code); else form();
    return { root: root, form: form, success: success, focus: focus };
  }

  W.SemaforPopupUI = { render: render, textsOf: textsOf };

  // ─────────────────────────── storefront ───────────────────────────
  var B = W.SemaforPopup;
  if (!B || !B.cfg || !B.cfg.enabled) return;
  var cfg = B.cfg;
  var designMode = !!(B.designMode || (W.Shopify && W.Shopify.designMode));

  function lsGet(k) { try { return W.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { W.localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
  function ssGet(k) { try { return W.sessionStorage.getItem(k); } catch (e) { return null; } }
  function ssSet(k, v) { try { W.sessionStorage.setItem(k, v); } catch (e) { /* ignore */ } }
  function readState() { try { return JSON.parse(lsGet(LS) || 'null'); } catch (e) { return null; } }
  function saveState(s) { s.at = Date.now(); lsSet(LS, JSON.stringify(s)); }

  /** Same browser id as the Semafor pixel (localStorage first, then the cookie); created here when missing. */
  function deviceId() {
    var id = lsGet(DEV), m = D.cookie.match(/(?:^|;\s*)_smf_dev=([^;]+)/), fromCookie = m ? decodeURIComponent(m[1]) : null;
    if (!id) id = fromCookie;
    if (!id) {
      if (W.crypto && W.crypto.randomUUID) id = W.crypto.randomUUID().replace(/-/g, '');
      else {
        var a = new Uint8Array(16); (W.crypto || W.msCrypto).getRandomValues(a);
        id = Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
      }
    }
    if (lsGet(DEV) !== id) lsSet(DEV, id);
    if (fromCookie !== id) D.cookie = '_smf_dev=' + id + '; max-age=31536000; path=/; samesite=lax';
    return id;
  }

  var proxy = (B.proxy || '/apps/semafor').replace(/\/$/, '');
  var dev = deviceId();
  var lang = B.locale || (D.documentElement.lang || '').slice(0, 2) || 'en';

  // tells the merchant's Semafor admin that the embed is on (at most once a day per browser)
  if (!designMode) {
    var lastPing = Number(lsGet('_smf_pp_ping')) || 0;
    if (Date.now() - lastPing > DAY) { lsSet('_smf_pp_ping', String(Date.now())); try { fetch(proxy + '/ping', { credentials: 'same-origin', keepalive: true }).catch(function () {}); } catch (e) { /* ignore */ } }
  }

  /** Never show: logged-in customer, checkout / account pages, subscribed or known browser. */
  function knownLocally() {
    if (B.customer) return true;
    if (/\/(checkouts?|account)(\/|$)/.test(W.location.pathname)) return true;
    var s = readState();
    if (s && (s.s === 'subscribed' || s.s === 'known')) return true;
    // the store's previous theme pop-up already collected this visitor
    try { var old = JSON.parse(lsGet('mhl_welcome_popup') || 'null'); if (old && old.state === 'subscribed') return true; } catch (e) { /* ignore */ }
    return false;
  }
  /** Closed / "no thanks" within hideDays. */
  function dismissedRecently() {
    var s = readState();
    return !!(s && s.s === 'dismissed' && Date.now() - (s.at || 0) < (cfg.hideDays || 14) * DAY);
  }
  var smart = cfg.mode !== 'site' && cfg.mode !== 'cart';
  if (!designMode && knownLocally()) return;
  // site / cart modes: a dismissal silences everything; smart: only the timed pop-up (the cart re-offer still runs)
  if (!designMode && !smart && dismissedRecently()) return;

  // assets: stylesheet + display font, injected once
  function assets() {
    if (D.getElementById('smf-pp-css')) return;
    var l = D.createElement('link'); l.id = 'smf-pp-css'; l.rel = 'stylesheet'; l.href = B.css; D.head.appendChild(l);
  }
  assets();

  /** Asks Semafor whether this browser is already linked to an e-mail (once per session). */
  function serverKnown(cb) {
    var k = ssGet('_smf_pp_k');
    if (k !== null) return cb(k === '1');
    var done = false, timer = setTimeout(function () { if (!done) { done = true; cb(false); } }, 2500);
    try {
      fetch(proxy + '/status?d=' + encodeURIComponent(dev), { credentials: 'same-origin', headers: { Accept: 'application/json' } })
        .then(function (r) { return r.ok ? r.json() : { known: false }; })
        .then(function (j) { ssSet('_smf_pp_k', j && j.known ? '1' : '0'); if (j && j.known) saveState({ s: 'known' }); if (!done) { done = true; clearTimeout(timer); cb(!!(j && j.known)); } })
        .catch(function () { if (!done) { done = true; clearTimeout(timer); cb(false); } });
    } catch (e) { if (!done) { done = true; clearTimeout(timer); cb(false); } }
  }

  /** true when the cart already has a discount (code, automatic or line discount) — then no cart re-offer. */
  function cartHasDiscount(cb) {
    if (/(?:^|;\s*)discount_code=[^;]+/.test(D.cookie)) return cb(true);
    try {
      fetch('/cart.js', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
        .then(function (r) { return r.json(); })
        .then(function (c) {
          if (c && typeof c.item_count === 'number') cartCount = c.item_count;
          var has = !!c && ((c.cart_level_discount_applications || []).length > 0 || Number(c.total_discount) > 0 ||
            (c.items || []).some(function (i) { return (i.line_level_discount_allocations || []).length > 0 || (i.discounts || []).length > 0 || Number(i.total_discount) > 0; }));
          cb(has);
        })
        .catch(function () { cb(false); });
    } catch (e) { cb(false); }
  }

  var ui = null, siteShown = false, prevOverflow = '';
  function onKey(e) { if (e.key === 'Escape' || e.key === 'Esc') close(true); }
  function close(remember) {
    if (!ui) return;
    var r = ui.root;
    r.classList.remove('is-visible');
    D.documentElement.style.overflow = prevOverflow;
    D.removeEventListener('keydown', onKey);
    setTimeout(function () { if (r.parentNode) r.parentNode.removeChild(r); }, 450);
    if (remember && !designMode) { var s = readState(); if (!s || s.s !== 'subscribed') saveState({ s: 'dismissed' }); }
    ui = null;
  }
  function submit(source) {
    return function (email, done) {
      if (designMode) { setTimeout(function () { done(null, cfg.code); }, 300); return; }
      var body = JSON.stringify({ email: email, deviceId: dev, source: source, locale: lang, host: W.location.host, pageUrl: String(W.location.href).slice(0, 500), consent: true });
      fetch(proxy + '/popup', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: body })
        .then(function (r) { return r.json().catch(function () { return {}; }); })
        .then(function (j) {
          if (j && j.ok) { saveState({ s: 'subscribed', code: j.code || cfg.code }); ssSet('_smf_pp_k', '1'); done(null, j.code || cfg.code); }
          else done(new Error((j && j.error) || 'failed'));
        })
        .catch(function (e) { done(e); });
    };
  }
  function show(source) {
    if (ui) return false;
    if (!designMode && (ciVisible() || ciTyping())) return false;
    ui = render(cfg, lang, { onSubmit: submit(source), onClose: close });
    D.body.appendChild(ui.root);
    prevOverflow = D.documentElement.style.overflow;
    D.documentElement.style.overflow = 'hidden';
    D.addEventListener('keydown', onKey);
    requestAnimationFrame(function () { requestAnimationFrame(function () { if (ui) ui.root.classList.add('is-visible'); }); });
    setTimeout(function () { if (ui) ui.focus(); }, 450);
    return true;
  }
  /** Timed pop-up / cart-mode pop-up: once per page, not after a recent dismissal. */
  function open(source) {
    if (siteShown || ui) return;
    // the cart already shows the inline offer (or the visitor is typing in it): never cover it with the pop-up
    if (!designMode && (ciVisible() || ciTyping())) return;
    if (designMode) { siteShown = true; show(source); return; }
    if (knownLocally() || dismissedRecently()) return;
    serverKnown(function (known) { if (!known && !siteShown && show(source)) siteShown = true; });
  }
  /** Smart mode: unknown visitor opens a cart without a discount → offer again (once per session, even after a dismissal). */
  function reoffer() {
    if (ui || ssGet('_smf_pp_cart') || knownLocally() || cartCount <= 0 || ciVisible()) return;
    cartHasDiscount(function (has) {
      if (has || cartCount <= 0) return;
      serverKnown(function (known) {
        if (known || ui || ssGet('_smf_pp_cart')) return;
        if (show('cart')) ssSet('_smf_pp_cart', '1');
      });
    });
  }


  // ── inline offer inside the theme's cart (drawer / page): <div data-semafor-cart-offer></div> ──
  // Shown only to an unknown visitor (no e-mail on file, not subscribed) whose cart has no discount yet.
  var CI = {
    ro: { title: 'Ia {pct}% reducere la această comandă', text: 'Lasă-ne e-mailul și reducerea se aplică imediat.', ph: 'Adresa ta de e-mail', btn: 'Vreau -{pct}%', ok: 'Gata! Reducerea de {pct}% e a ta.', okText: 'Codul {code} se aplică automat la finalizare.', go: 'Finalizează cu -{pct}%', err: 'Verifică adresa de e-mail.', fail: 'Nu a mers. Încearcă din nou.', note: 'Primești și noutățile noastre. Te poți dezabona oricând.' },
    de: { title: 'Sichere dir {pct} % Rabatt auf diese Bestellung', text: 'Hinterlasse deine E-Mail – der Rabatt gilt sofort.', ph: 'Deine E-Mail-Adresse', btn: '-{pct} % sichern', ok: 'Geschafft! Deine {pct} % gehören dir.', okText: 'Der Code {code} wird an der Kasse automatisch angewendet.', go: 'Mit -{pct} % zur Kasse', err: 'Bitte prüfe deine E-Mail-Adresse.', fail: 'Das hat nicht geklappt. Bitte versuche es erneut.', note: 'Du erhältst auch unsere Neuigkeiten. Abmeldung jederzeit möglich.' },
    pl: { title: 'Odbierz {pct}% rabatu na to zamówienie', text: 'Zostaw e-mail – rabat działa od razu.', ph: 'Twój adres e-mail', btn: 'Chcę -{pct}%', ok: 'Gotowe! Twoje {pct}% rabatu czeka.', okText: 'Kod {code} zostanie dodany automatycznie przy płatności.', go: 'Zamów z -{pct}%', err: 'Sprawdź adres e-mail.', fail: 'Nie udało się. Spróbuj ponownie.', note: 'Otrzymasz też nasze nowości. Możesz zrezygnować w każdej chwili.' },
    en: { title: 'Take {pct}% off this order', text: 'Leave your e-mail and the discount applies right away.', ph: 'Your e-mail address', btn: 'Get -{pct}%', ok: 'Done! Your {pct}% is ready.', okText: 'Code {code} is applied automatically at checkout.', go: 'Checkout with -{pct}%', err: 'Please check your e-mail address.', fail: 'That didn’t work. Please try again.', note: 'You’ll also get our news. Unsubscribe anytime.' },
  };
  var ciT = CI[String(lang).slice(0, 2)] || CI.en;
  var ciPct = String(Number(cfg.pct) || (String((textsOf(cfg, lang) || {}).bigLabel || '').match(/\d+/) || [15])[0]);
  function ciFill(s, code) { return String(s).replace(/\{pct\}/g, ciPct).replace(/\{code\}/g, code || ''); }
  var ciState = null; // null = not decided, 'hide', 'show', or { code }
  function ciRender(slot) {
    if (slot.__smfCi === ciState) return;
    slot.__smfCi = ciState;
    if (!ciState || ciState === 'hide') { slot.innerHTML = ''; slot.hidden = true; return; }
    slot.hidden = false;
    if (ciState.code) {
      var href = '/discount/' + encodeURIComponent(ciState.code) + '?redirect=' + encodeURIComponent('/checkout');
      slot.innerHTML = '<div class="smf-ci smf-ci--done" role="status"><p class="smf-ci__title">' + esc(ciFill(ciT.ok)) + '</p>' +
        '<p class="smf-ci__text">' + esc(ciFill(ciT.okText, ciState.code)) + '</p>' +
        '<a class="smf-ci__btn" href="' + esc(href) + '">' + esc(ciFill(ciT.go)) + '</a></div>';
      return;
    }
    slot.innerHTML = '<div class="smf-ci"><p class="smf-ci__badge">-' + esc(ciPct) + '%</p>' +
      '<p class="smf-ci__title">' + esc(ciFill(ciT.title)) + '</p><p class="smf-ci__text">' + esc(ciFill(ciT.text)) + '</p>' +
      // no <form>: the slot usually sits inside the theme's cart <form>, and a nested form is dropped by the browser
      '<div class="smf-ci__form" role="group"><input type="email" name="smf_email" inputmode="email" autocomplete="email" aria-label="E-mail" placeholder="' + esc(ciT.ph) + '">' +
      '<button type="button" class="smf-ci__btn">' + esc(ciFill(ciT.btn)) + '</button></div>' +
      '<p class="smf-ci__err" role="alert" hidden></p><p class="smf-ci__note">' + esc(ciT.note) + '</p></div>';
    var f = slot.querySelector('.smf-ci__form'), inp = f.querySelector('input'), b = f.querySelector('button'), er = slot.querySelector('.smf-ci__err');
    var go = function (e) {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      if (b.disabled) return;
      var email = String(inp.value || '').trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { er.textContent = ciT.err; er.hidden = false; return; }
      b.disabled = true; er.hidden = true;
      submit('cart')(email, function (error, code) {
        if (error) { b.disabled = false; er.textContent = ciT.fail; er.hidden = false; return; }
        ciState = { code: code || cfg.code };
        // attach the code to the cart right away (cookie), so the checkout already shows it
        try { fetch('/discount/' + encodeURIComponent(ciState.code), { credentials: 'same-origin' }).catch(function () {}); } catch (x) { /* ignore */ }
        ciMountAll();
      });
    };
    b.addEventListener('click', go);
    // Enter in the field must not submit the theme's cart form (→ /cart or checkout)
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.keyCode === 13) go(e); });
    // keep the theme's drawer from treating clicks/keys in our block as its own (some drawers close or re-render)
    ['click', 'keydown', 'keyup', 'input', 'change'].forEach(function (t) { f.addEventListener(t, function (e) { e.stopPropagation(); }); });
  }
  function ciMountAll() { Array.prototype.forEach.call(D.querySelectorAll('[data-semafor-cart-offer]'), ciRender); }
  var ciAt = 0, ciBusy = false;
  function ciDecide() {
    if (ciState && ciState.code) return ciMountAll();
    if (knownLocally()) { ciState = 'hide'; return ciMountAll(); }
    if (ciState && Date.now() - ciAt < 15000) return ciMountAll(); // fresh decision: just render new slots
    if (ciBusy) return;
    ciBusy = true;
    cartHasDiscount(function (has) {
      if (has) { ciBusy = false; ciAt = Date.now(); ciState = 'hide'; return ciMountAll(); }
      serverKnown(function (known) { ciBusy = false; ciAt = Date.now(); ciState = known ? 'hide' : 'show'; ciMountAll(); });
    });
  }
  (function () {
    var t = null;
    // only react when a NEW offer slot appears (the drawer re-renders its HTML after every cart change)
    var scan = function () {
      var fresh = false;
      Array.prototype.forEach.call(D.querySelectorAll('[data-semafor-cart-offer]'), function (el) { if (!el.__smfSeen) { el.__smfSeen = 1; fresh = true; } });
      if (!fresh) return;
      clearTimeout(t); t = setTimeout(function () { ciAt = 0; ciDecide(); }, 120);
    };
    try { new MutationObserver(function (ms) { for (var i = 0; i < ms.length; i++) { if (ms[i].addedNodes && ms[i].addedNodes.length) { scan(); return; } } }).observe(D.body || D.documentElement, { childList: true, subtree: true }); } catch (e) { /* ignore */ }
    if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', scan); else scan();
  })();
  function ciVisible() { var el = D.querySelector('[data-semafor-cart-offer] .smf-ci'); return !!(el && el.offsetParent); }
  function ciTyping() { var a = D.activeElement; return !!(a && a.closest && a.closest('[data-semafor-cart-offer]')); }

  if (designMode) { setTimeout(function () { open(smart ? 'site' : cfg.mode); }, 400); return; }

  // ── triggers ──
  var cartCount = Number(B.cartCount) || 0;
  var cartTimer = null;
  /** The cart was opened / changed. how: "add" (add-to-cart) or "open" (cart page, drawer, open event). */
  function cartActivity(how) {
    if (cartCount <= 0) return;
    if (cfg.mode === 'cart') {
      if (siteShown) return;
      clearTimeout(cartTimer);
      cartTimer = setTimeout(function () { open('cart'); }, Math.max(0, Number(cfg.cartDelay) || 0) * 1000);
    } else if (smart && how === 'open') {
      clearTimeout(cartTimer);
      cartTimer = setTimeout(reoffer, Math.max(0, Number(cfg.cartDelay) || 0) * 1000);
    }
  }
  function seenCartUrl(url, body) {
    url = String(url || '');
    if (!/\/cart(\/(add|change|update|clear)(\.js)?|\.js)(\?|$)/.test(url.split('#')[0])) return;
    var added = /\/cart\/add/.test(url);
    if (body && typeof body.item_count === 'number') cartCount = body.item_count;
    else if (added) cartCount = Math.max(cartCount, 1);
    if (added) cartActivity('add');
    else if (/\/cart\/(change|update)/.test(url)) cartActivity('change');
  }
  // listen to the theme's AJAX cart calls (fetch + XHR) without changing them
  try {
    var of = W.fetch;
    if (of) W.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      var p = of.apply(this, arguments);
      if (/\/cart/.test(url)) p.then(function (r) { try { r.clone().json().then(function (j) { seenCartUrl(url, j); }, function () { seenCartUrl(url, null); }); } catch (e) { seenCartUrl(url, null); } }, function () {});
      return p;
    };
    var oo = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (m, url) {
      if (/\/cart/.test(String(url))) this.addEventListener('load', function () { var j = null; try { j = JSON.parse(this.responseText); } catch (e) { /* not json */ } seenCartUrl(url, j); });
      return oo.apply(this, arguments);
    };
  } catch (e) { /* ignore */ }
  // common theme events (Dawn and many premium themes)
  ['cart:open', 'cart-drawer:open', 'theme:cart:open', 'cart:opened', 'cart:updated', 'cart:refresh', 'cart:change', 'theme:cart:change', 'ajaxProduct:added', 'product:added', 'cart:item-added', 'on:cart:add', 'cart:added'].forEach(function (n) {
    D.addEventListener(n, function () {
      if (/add/i.test(n)) { cartCount = Math.max(cartCount, 1); cartActivity('add'); }
      else cartActivity(/open/i.test(n) ? 'open' : 'change');
    });
  });
  // cart drawer becoming visible
  try {
    var drawers = D.querySelectorAll('cart-drawer, #CartDrawer, #cart-drawer, .cart-drawer, [data-cart-drawer], #sidebar-cart, #mini-cart, .drawer--cart');
    var isOpen = function (el) { return el.hasAttribute('open') || /(^|\s)(active|is-active|is-open|open|drawer--is-open)(\s|$)/.test(el.className || '') || el.getAttribute('aria-hidden') === 'false'; };
    Array.prototype.forEach.call(drawers, function (el) {
      var was = isOpen(el);
      new MutationObserver(function () { var now = isOpen(el); if (now && !was) { if (cartCount <= 0) cartCount = 1; cartActivity('open'); } was = now; }).observe(el, { attributes: true, attributeFilter: ['class', 'open', 'aria-hidden'] });
    });
  } catch (e) { /* ignore */ }

  if (cfg.mode !== 'cart') setTimeout(function () { open('site'); }, Math.max(0, Number(cfg.delay) || 0) * 1000);
  if (B.pageType === 'cart' && cartCount > 0) cartActivity('open');

  // exit intent (desktop): the mouse leaves through the top while the cart has items — once
  if (cfg.exitIntent && W.matchMedia && W.matchMedia('(pointer: fine)').matches) {
    var armedAt = Date.now() + 3000;
    var onOut = function (e) {
      if (ui || Date.now() < armedAt || cartCount <= 0) return;
      if (!e.relatedTarget && e.clientY <= 0) { D.removeEventListener('mouseout', onOut); if (smart) reoffer(); else open(cfg.mode); }
    };
    D.addEventListener('mouseout', onOut);
  }
})();
