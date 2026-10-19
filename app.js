/* HarvestLink Marketplace:
   TWO MODES.
   - Live (config.js is filled in): harvests come from the database and only farmers who agreed are shown. Buyers send
     requests that the coordinator follows up. Farmers do not sign in: the coordinator posts for them
     (coordinator.html). The phone page is a simulation whose attempts are logged for the test. No sample data is ever shown.
   - Demo (no config, or add ?demo to the address): sample data from data.js, kept in this browser's localStorage.
   Words come from i18n.js (English and draft Twi).
   */
(function () {
  'use strict';
  var SEED = window.HL_DATA;
  var I18N = window.HL_I18N;
  var KEY = 'hl-market-v1';
  var LANG_KEY = 'hl-lang';
  var CRATE_KG = 40; /* one crate is about 40 kg */
  var STORE = window.HL_STORE;
  var LIVE = !!(STORE && STORE.configured() && !/[?&]demo\b/.test(location.search));
  var live = { state: LIVE ? 'loading' : 'ready' }; /* loading, ready or error */

  /* ---------- language ---------- */
  var lang = 'en';
  try { var saved = localStorage.getItem(LANG_KEY); if (saved && I18N[saved]) lang = saved; } catch (e) { /* ignore */ }
  function words(l, key, vars) {
    var s = (I18N[l] && I18N[l][key]);
    if (s == null) s = I18N.en[key];
    if (s == null) s = key;
    if (vars) Object.keys(vars).forEach(function (k) { s = s.split('{' + k + '}').join(vars[k]); });
    return s;
  }
  function t(key, vars) { return words(lang, key, vars); }
  /* The demo phone is English only for now, whatever language the site is in. */
  function pt(key, vars) { return words('en', key, vars); }

  /* ---------- helpers ---------- */
  function $(s) { return document.querySelector(s); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function ymd(d) { var z = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 10); }
  var today = ymd(new Date());
  function daysUntil(s) { return Math.round((Date.parse(s) - Date.parse(today)) / 864e5); }
  /* English uses the browser's date format. Twi uses Akan day names plus day/month numbers,
     because month names in Twi are not standardised. Edit `days` in i18n.js if a name needs fixing. */
  function fmtDate(s) {
    var d = new Date(s + 'T00:00:00Z'), names = t('days');
    if (!names) return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
    return names.split(',')[d.getUTCDay()] + ' ' + d.getUTCDate() + '/' + (d.getUTCMonth() + 1);
  }
  function cedi(n) { return 'GH¢' + Math.round(n).toLocaleString('en-GB'); }
  function uid(p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }
  function initials(name) { return String(name).split(/\s+/).slice(0, 2).map(function (w) { return w.charAt(0); }).join('').toUpperCase(); }

  /* ---------- data ---------- */
  /* BACKEND: replace load() with a fetch of farmers, listings and enquiries. */
  function load() {
    if (LIVE) { var e = clone(SEED); e.farmers = []; e.listings = []; e.enquiries = []; e.sms = []; e.me = null; return e; } /* never show sample people as real */
    try {
      var s = JSON.parse(localStorage.getItem(KEY));
      if (s && s.version === SEED.version) { s.sms = s.sms || []; return s; }
    } catch (e) { /* storage blocked or empty: use the sample data */ }
    return clone(SEED);
  }
  /* BACKEND: replace save() with POST/PUT/DELETE calls. */
  function save() { if (LIVE) return true; /* live data is kept by the database, not this browser */ try { localStorage.setItem(KEY, JSON.stringify(data)); return true; } catch (e) { return false; /* storage blocked or full */ } }
  var data = load();

  var LIVE_ME = { id: null, name: 'Farmer', phone: '', avatar: null }; /* the simulated phone has no owner in the live version */
  function me() { return LIVE ? LIVE_ME : data.farmers.filter(function (f) { return f.id === data.me; })[0]; }
  function placeOf(f) { return [f.town, f.region].filter(Boolean).join(', '); }
  function farmerOf(l) { return data.farmers.filter(function (f) { return f.id === l.farmerId; })[0]; }
  function varietyOf(l) { return data.varieties.filter(function (v) { return v.id === l.variety; })[0] || data.varieties[0]; }
  function listingById(id) { return data.listings.filter(function (l) { return l.id === id; })[0]; }
  function isReady(l) { return daysUntil(l.ready) <= 0; }
  function statusText(l) {
    var d = daysUntil(l.ready);
    if (d <= 0) return t('readyNow');
    if (d === 1) return t('readyTomorrow');
    return t('readyIn', { n: d });
  }
  function statusPill(l) {
    if (l.status === 'sold') return '<span class="pill sold">' + esc(t('sold')) + '</span>';
    return '<span class="pill ' + (isReady(l) ? 'now' : 'soon') + '">' + esc(statusText(l)) + '</span>';
  }

  /* ---------- UI state ---------- */
  var ui = { route: { name: 'browse', id: null }, filter: { status: 'all', q: '', variety: 'all', sort: 'ready' },
             compare: [], editing: null, adding: false, harvestPhoto: null, confirmRemove: null, sent: null, photoError: '' };
  (function initRoute() {
    var h = (location.hash || '').replace('#', '');
    if ((h === 'farm' && !LIVE) || h === 'phone') ui.route = { name: h, id: null };
    else if (/^listing-/.test(h)) ui.route = { name: 'listing', id: h.slice(8) };
  })();
  function go(name, id) {
    if (ui.route.name === 'phone' && name !== 'phone') phoneStop(); /* leaving the phone hangs up */
    ui.route = { name: name, id: id || null };
    ui.sent = null; ui.confirmRemove = null;
    try { location.hash = name === 'listing' ? 'listing-' + id : name; } catch (e) { /* ignore */ }
    render(); window.scrollTo(0, 0);
    if (LIVE && name === 'browse' && live.state === 'ready') refreshLive();
  }

  /* ---------- live data: read what the coordinator has posted ---------- */
  function varietyKey(name) {
    var n = String(name || '').trim(), low = n.toLowerCase();
    var v = data.varieties.filter(function (x) { return x.id === low || x.name.toLowerCase() === low; })[0];
    if (v) return v.id;
    v = { id: low.replace(/[^a-z0-9]+/g, '-') || 'other', name: n || 'Other' };
    data.varieties.push(v);
    return v.id;
  }
  function applyLive(r) {
    var known = {};
    data.farmers = r.farmers.map(function (f) {
      known[f.id] = true;
      return { id: f.id, code: f.code, name: f.display_name, farm: f.farm || f.display_name, town: f.town || '', region: f.region || '',
               since: f.since, bio: f.bio || '', phone: '', avatar: null }; /* phone numbers are private: the database never sends them */
    });
    data.listings = r.listings.filter(function (l) { return known[l.farmer_id]; }).map(function (l) {
      return { id: l.id, farmerId: l.farmer_id, variety: varietyKey(l.variety), crates: l.crates, price: Number(l.price),
               ready: l.ready, notes: l.notes || '', photo: null, status: l.status };
    });
  }
  function loadLive() {
    live.state = 'loading'; if (ui.route.name !== 'phone') render();
    return STORE.listPublic().then(function (r) { applyLive(r); live.state = 'ready'; if (ui.route.name !== 'phone') render(); },
      function () { live.state = 'error'; if (ui.route.name !== 'phone') render(); });
  }
  /* A quiet refresh: keeps what is on screen if it fails, and never redraws a form the buyer is typing in. */
  function refreshLive() {
    return STORE.listPublic().then(function (r) { applyLive(r); if (ui.route.name === 'browse' && $('#results')) renderResults(); }, function () { /* keep the old list */ });
  }
  function renderLiveWait() {
    $('#view').innerHTML = live.state === 'error'
      ? '<div class="empty">' + esc(t('errLoad')) + '<br><button class="btn" type="button" data-act="liveretry" style="margin-top:12px">' + esc(t('retry')) + '</button></div>'
      : '<div class="empty" role="status">' + esc(t('loadingLive')) + '</div>';
  }

  /* ---------- pictures: the farmer's produce photo, or a dummy image when there is none ---------- */
  function art(photo, alt) {
    if (photo) return '<img alt="' + esc(alt) + '" src="' + esc(photo) + '">';
    return '<div class="noimg"><svg viewBox="0 0 48 48" aria-hidden="true"><rect x="6" y="10" width="36" height="28" rx="4" fill="none" stroke="currentColor" stroke-width="2.5"/>' +
      '<circle cx="17" cy="20" r="3.5" fill="currentColor"/><path d="M8 35l10-10 7 6 6-8 9 12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/></svg>' +
      '<span>' + esc(t('noPhoto')) + '</span></div>';
  }
  function avatar(f, big) {
    return '<span class="avatar' + (big ? ' big' : '') + '">' + (f.avatar ? '<img alt="' + esc(f.name) + '" src="' + esc(f.avatar) + '">' : esc(initials(f.name))) + '</span>';
  }

  /* ---------- fixed page parts (header, banner, footer) ---------- */
  function renderChrome() {
    document.documentElement.lang = t('htmlLang');
    $('#demo').textContent = t(LIVE ? 'liveNote' : 'demoNote');
    $('#footText').textContent = t('footer');
    $('#resetBtn').textContent = t('reset'); $('#resetBtn').hidden = LIVE;
    $('#logo').setAttribute('aria-label', t('homeLabel'));
    document.querySelectorAll('#langSeg button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.lang === lang)); });
    $('#nav').innerHTML =
      '<button type="button" data-go="browse" ' + (ui.route.name !== 'farm' && ui.route.name !== 'phone' ? 'aria-current="page"' : '') + '>' + esc(t('navBrowse')) + '</button>' +
      (LIVE ? '' : '<button type="button" data-go="farm" ' + (ui.route.name === 'farm' ? 'aria-current="page"' : '') + '>' + esc(t('navFarm')) + '</button>') +
      '<button type="button" data-go="phone" ' + (ui.route.name === 'phone' ? 'aria-current="page"' : '') + '>' + esc(t('navPhone')) + '</button>';
    var m = me();
    $('#who').textContent = m && !LIVE ? t('demoFarmer', { name: m.name }) : '';
  }

  /* ---------- browse ---------- */
  function visibleListings() {
    var f = ui.filter;
    var L = data.listings.filter(function (l) { return l.status === 'active'; });
    if (f.status === 'now') L = L.filter(isReady);
    if (f.status === 'soon') L = L.filter(function (l) { return !isReady(l); });
    if (f.variety !== 'all') L = L.filter(function (l) { return l.variety === f.variety; });
    var q = f.q.trim().toLowerCase();
    if (q) L = L.filter(function (l) {
      var fm = farmerOf(l);
      return [fm.name, fm.farm, fm.town, fm.region, varietyOf(l).name].join(' ').toLowerCase().indexOf(q) !== -1;
    });
    L = L.slice().sort(function (a, b) {
      if (f.sort === 'price') return a.price - b.price;
      if (f.sort === 'crates') return b.crates - a.crates;
      return daysUntil(a.ready) - daysUntil(b.ready);
    });
    return L;
  }
  function cardHtml(l, minPrice, many) {
    var fm = farmerOf(l), v = varietyOf(l), checked = ui.compare.indexOf(l.id) !== -1;
    return '<article class="card"><div class="art">' + art(l.photo, t('tomatoesOf', { variety: v.name })) + statusPill(l) +
      (many && l.price === minPrice ? '<span class="pill low">' + esc(t('lowest')) + '</span>' : '') + '</div>' +
      '<div class="body"><div class="row"><h3>' + esc(v.name) + '</h3><span class="muted small">' + l.crates + ' ' + esc(t('crates')) + '</span></div>' +
      '<div class="who">' + avatar(fm) + '<div><div class="nm">' + esc(fm.name) + '</div><div class="muted small">' + esc(placeOf(fm)) + '</div></div></div>' +
      '<div class="row"><span class="price">' + cedi(l.price) + ' <small>' + esc(t('perCrate')) + '</small></span><span class="muted small">' + esc(fmtDate(l.ready)) + '</span></div>' +
      '<div class="card-actions"><label class="cmp"><input type="checkbox" data-cmp="' + l.id + '" ' + (checked ? 'checked' : '') + '> ' + esc(t('compare')) + '</label>' +
      '<button class="btn primary sm" type="button" data-open="' + l.id + '">' + esc(t(LIVE ? 'viewAsk' : 'viewContact')) + '</button></div></div></article>';
  }
  function renderResults() {
    var L = visibleListings();
    var minPrice = L.length ? Math.min.apply(null, L.map(function (l) { return l.price; })) : 0;
    $('#count').textContent = L.length === 1 ? t('foundOne') : t('found', { n: L.length });
    $('#results').innerHTML = L.length
      ? L.map(function (l) { return cardHtml(l, minPrice, L.length > 1); }).join('')
      : '<div class="empty">' + esc(t(LIVE && !data.listings.length ? 'emptyLive' : 'noMatch')) + '</div>';
    renderTray();
  }
  function renderBrowse() {
    var f = ui.filter;
    var chip = function (k, label) { return '<button type="button" class="chip-btn" data-status="' + k + '" aria-pressed="' + (f.status === k) + '">' + esc(label) + '</button>'; };
    $('#view').innerHTML =
      '<section class="hero"><h1>' + esc(t('heroTitle')) + '</h1><p>' + esc(t(LIVE ? 'heroTextLive' : 'heroText')) + '</p></section>' +
      '<div class="bar"><input class="search" id="q" type="search" placeholder="' + esc(t('searchPh')) + '" value="' + esc(f.q) + '" aria-label="' + esc(t('searchLabel')) + '">' +
      '<select id="variety" aria-label="' + esc(t('varietyLabel')) + '"><option value="all">' + esc(t('allVarieties')) + '</option>' +
      data.varieties.map(function (v) { return '<option value="' + v.id + '" ' + (f.variety === v.id ? 'selected' : '') + '>' + esc(v.name) + '</option>'; }).join('') + '</select>' +
      '<select id="sort" aria-label="' + esc(t('sortLabel')) + '"><option value="ready" ' + (f.sort === 'ready' ? 'selected' : '') + '>' + esc(t('sortReady')) + '</option>' +
      '<option value="price" ' + (f.sort === 'price' ? 'selected' : '') + '>' + esc(t('sortPrice')) + '</option>' +
      '<option value="crates" ' + (f.sort === 'crates' ? 'selected' : '') + '>' + esc(t('sortCrates')) + '</option></select></div>' +
      '<div class="chips" role="group" aria-label="' + esc(t('availLabel')) + '">' + chip('all', t('fAll')) + chip('now', t('fNow')) + chip('soon', t('fSoon')) + '</div>' +
      '<p class="count" id="count"></p><div class="grid" id="results"></div>';
    renderResults();
  }
  function renderTray() {
    var n = ui.compare.length;
    $('#tray').innerHTML = n ? '<div class="tray"><span>' + esc(t('selected', { n: n })) + '</span>' +
      '<button class="btn" type="button" data-act="compare" ' + (n < 2 ? 'disabled' : '') + '>' + esc(t('comparePrices')) + '</button>' +
      '<button class="btn ghost" type="button" data-act="clearcmp">' + esc(t('clear')) + '</button></div>' : '';
  }
  function renderCompare() {
    var L = ui.compare.map(listingById).filter(Boolean);
    var min = Math.min.apply(null, L.map(function (l) { return l.price; }));
    var row = function (label, fn, best) {
      return '<tr><th scope="row">' + esc(label) + '</th>' + L.map(function (l) {
        return '<td' + (best && best(l) ? ' class="best"' : '') + '>' + fn(l) + '</td>';
      }).join('') + '</tr>';
    };
    $('#overlay').innerHTML = '<div class="overlay" data-act="closeov"><div class="sheet" role="dialog" aria-modal="true" aria-label="' + esc(t('compareTitle')) + '">' +
      '<div class="section-head"><h2>' + esc(t('compareTitle')) + '</h2><button class="btn sm" type="button" data-act="closeov">' + esc(t('close')) + '</button></div>' +
      '<div class="table-wrap"><table><thead><tr><th></th>' + L.map(function (l) { return '<th scope="col" style="color:var(--ink)">' + esc(farmerOf(l).farm) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      row(t('rPriceCrate'), function (l) { return cedi(l.price); }, function (l) { return l.price === min; }) +
      row(t('rPriceKg'), function (l) { return 'GH¢' + (l.price / CRATE_KG).toFixed(2); }, function (l) { return l.price === min; }) +
      row(t('rAvail'), function (l) { return statusPill(l) + '<div class="muted small">' + esc(fmtDate(l.ready)) + '</div>'; }) +
      row(t('rCrates'), function (l) { return l.crates; }) +
      row(t('rVariety'), function (l) { return esc(varietyOf(l).name); }) +
      row(t('rLocation'), function (l) { return esc(placeOf(farmerOf(l)) || '-'); }) +
      row(t('rFarmer'), function (l) { return esc(farmerOf(l).name); }) +
      row('', function (l) { return '<button class="btn primary sm" type="button" data-open="' + l.id + '">' + esc(t(LIVE ? 'viewAsk' : 'viewContact')) + '</button>'; }) +
      '</tbody></table></div></div></div>';
  }

  /* ---------- listing detail ---------- */
  function waLink(phone, msg) {
    var d = String(phone).replace(/\D/g, '');
    if (d.charAt(0) === '0') d = '233' + d.slice(1);
    return 'https://wa.me/' + d + '?text=' + encodeURIComponent(msg);
  }
  function renderListing() {
    var l = listingById(ui.route.id);
    if (!l) { $('#view').innerHTML = '<div class="empty">' + esc(t('gone')) + ' <button class="linkish" data-go="browse">' + esc(t('backShort')) + '</button></div>'; return; }
    var fm = farmerOf(l), v = varietyOf(l);
    var others = data.listings.filter(function (x) { return x.farmerId === fm.id && x.id !== l.id && x.status === 'active'; });
    var msg = t('waMsg', { name: fm.name.split(' ')[0], variety: v.name, n: l.crates, price: l.price, status: statusText(l).toLowerCase() });
    var sent = ui.sent === l.id;
    $('#view').innerHTML =
      '<div class="crumbs"><button class="linkish" type="button" data-go="browse">' + esc(t('back')) + '</button></div>' +
      '<div class="detail"><div class="stack">' +
      '<div class="panel"><div class="art">' + art(l.photo, t('tomatoesOf', { variety: v.name })) + '</div>' +
      '<div class="actions"><h1>' + esc(t('tomatoesOf', { variety: v.name })) + '</h1>' + statusPill(l) + '</div>' +
      '<div class="facts">' +
      '<div class="fact"><span class="muted small">' + esc(t('rPriceCrate')) + '</span><b>' + cedi(l.price) + '</b><span class="muted small">GH¢' + (l.price / CRATE_KG).toFixed(2) + ' ' + esc(t('perKg')) + '</span></div>' +
      '<div class="fact"><span class="muted small">' + esc(t('available')) + '</span><b>' + l.crates + ' ' + esc(t('crates')) + '</b><span class="muted small">' + esc(t('aboutKg', { n: (l.crates * CRATE_KG).toLocaleString('en-GB') })) + '</span></div>' +
      '<div class="fact"><span class="muted small">' + esc(t('ready')) + '</span><b>' + esc(fmtDate(l.ready)) + '</b><span class="muted small">' + esc(statusText(l)) + '</span></div>' +
      '<div class="fact"><span class="muted small">' + esc(t('location')) + '</span><b>' + esc(fm.town || fm.region || '-') + '</b><span class="muted small">' + esc(fm.town && fm.region ? t('regionWord', { name: fm.region }) : '') + '</span></div></div>' +
      (l.notes ? '<p>' + esc(l.notes) + '</p>' : '') + '</div>' +
      '<div class="panel"><h2>' + esc(t('aboutFarmer')) + '</h2><div class="profile">' + avatar(fm, true) +
      '<div><h3>' + esc(fm.name) + '</h3><div class="muted">' + esc(fm.farm) + '</div>' + (fm.since ? '<div class="muted small">' + esc(t('farmingSince', { year: fm.since })) + '</div>' : '') + '</div></div>' +
      (fm.bio ? '<p>' + esc(fm.bio) + '</p>' : '') +
      (others.length ? '<div><h3>' + esc(t('alsoFrom')) + '</h3><div class="stack" style="margin-top:8px">' + others.map(function (o) {
        return '<div class="lrow"><div class="info"><b>' + esc(varietyOf(o).name) + '</b><span class="muted small">' + o.crates + ' ' + esc(t('crates')) + ' · ' + cedi(o.price) + ' ' + esc(t('perCrate')) + '</span></div>' + statusPill(o) +
          '<button class="btn sm" type="button" data-open="' + o.id + '">' + esc(t('view')) + '</button></div>';
      }).join('') + '</div></div>' : '') + '</div></div>' +
      '<aside class="panel"><div class="price">' + cedi(l.price) + ' <small>' + esc(t('perCrate')) + '</small></div>' +
      (LIVE ? '<div class="contact-box"><span class="muted small">' + esc(t('liveContactNote')) + '</span></div>' :
      '<div class="contact-box"><b>' + esc(t('contact', { name: fm.name.split(' ')[0] })) + '</b><div class="num">' + esc(fm.phone) + '</div>' +
      '<div class="actions"><a class="btn primary" target="_blank" rel="noopener" href="' + esc(waLink(fm.phone, msg)) + '">' + esc(t('whatsapp')) + '</a>' +
      '<button class="btn" type="button" data-act="copy" data-num="' + esc(fm.phone) + '">' + esc(t('copyNum')) + '</button></div></div>') +
      (sent ? '<div class="contact-box"><b>' + esc(t('sentTitle')) + '</b><span class="muted small">' + esc(LIVE ? t('sentCall', { phone: ui.sentPhone || '' }) : fm.id === data.me ? t('sentDemo') : t('sentLive')) + '</span></div>'
        : '<form id="enqForm" novalidate data-id="' + l.id + '"><h3>' + esc(t('askBuy')) + '</h3>' +
          '<label for="e-name">' + esc(t('yourName')) + '<input id="e-name" name="buyer" autocomplete="name" maxlength="80"></label>' +
          (LIVE ? '<label for="e-phone">' + esc(t('yourPhone')) + '<input id="e-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" maxlength="20"></label>' : '') +
          '<label for="e-crates">' + esc(t('cratesWant')) + '<input id="e-crates" name="crates" type="number" inputmode="numeric" min="1" max="' + l.crates + '"></label>' +
          (LIVE ? '<label for="e-intent">' + esc(t('intentLabel')) + '<select id="e-intent" name="intent" style="width:100%"><option value="commit">' + esc(t('intentCommit')) + '</option><option value="info">' + esc(t('intentInfo')) + '</option></select></label>' : '') +
          '<label for="e-msg">' + esc(t('message')) + ' <small>' + esc(t('optional')) + '</small><textarea id="e-msg" name="message" maxlength="300" placeholder="' + esc(t('msgPh')) + '"></textarea></label>' +
          (LIVE ? '<label class="consent" for="e-consent"><input id="e-consent" name="consent" type="checkbox"> <span>' + esc(t('consentCall')) + '</span></label>' : '') +
          '<div class="err" id="e-err" role="alert"></div><button class="btn primary" type="submit">' + esc(t('sendReq')) + '</button></form>') +
      '</aside></div>';
  }

  /* ---------- farmer page ---------- */
  /* The photo being chosen in the harvest form is held in ui.harvestPhoto until the form is saved. */
  function harvestPhotoHtml() {
    var p = ui.harvestPhoto;
    return '<div class="art preview">' + art(p, t('hPhoto')) + '</div>' +
      '<div class="stack"><div class="actions"><button class="btn" type="button" data-act="pickhphoto">' + esc(p ? t('changePhoto') : t('addPhoto')) + '</button>' +
      (p ? '<button class="btn" type="button" data-act="removehphoto">' + esc(t('removePhoto')) + '</button>' : '') + '</div>' +
      '<span class="muted small">' + esc(t('hPhotoHint')) + '</span></div>';
  }
  function harvestForm(l) {
    var edit = !!l;
    var cur = l || { variety: data.varieties[0].id, crates: '', price: '', ready: ymd(new Date(Date.now() + 5 * 864e5)), notes: '' };
    return '<form id="harvestForm" class="panel" novalidate data-id="' + (edit ? l.id : '') + '"><h3>' + esc(edit ? t('editHarvest') : t('addHarvest')) + '</h3>' +
      '<div class="two"><label for="h-var">' + esc(t('rVariety')) + '<select id="h-var" name="variety" style="width:100%">' +
      data.varieties.map(function (v) { return '<option value="' + v.id + '" ' + (cur.variety === v.id ? 'selected' : '') + '>' + esc(v.name) + '</option>'; }).join('') + '</select></label>' +
      '<label for="h-crates">' + esc(t('hCrates')) + '<input id="h-crates" name="crates" type="number" inputmode="numeric" min="1" value="' + esc(cur.crates) + '"></label></div>' +
      '<div class="two"><label for="h-price">' + esc(t('hPrice')) + '<input id="h-price" name="price" type="number" inputmode="numeric" min="1" value="' + esc(cur.price) + '"></label>' +
      '<label for="h-date">' + esc(t('hDate')) + '<small>' + esc(t('hDateHint')) + '</small><input id="h-date" name="ready" type="date" value="' + esc(cur.ready) + '"></label></div>' +
      '<label for="h-notes">' + esc(t('hNotes')) + ' <small>' + esc(t('optional')) + '</small><textarea id="h-notes" name="notes" placeholder="' + esc(t('hNotesPh')) + '">' + esc(cur.notes) + '</textarea></label>' +
      '<div class="photo-field"><b>' + esc(t('hPhoto')) + ' <small>' + esc(t('optional')) + '</small></b>' +
      '<div class="profile" id="h-photo">' + harvestPhotoHtml() + '</div><input id="hphoto" type="file" accept="image/*" hidden></div>' +
      '<div class="err" id="h-err" role="alert"></div>' +
      '<div class="actions"><button class="btn primary" type="submit">' + esc(edit ? t('saveChanges') : t('addHarvest')) + '</button><button class="btn" type="button" data-act="cancelform">' + esc(t('cancel')) + '</button></div></form>';
  }
  function manageRow(l) {
    var v = varietyOf(l);
    var sold = l.status === 'sold';
    return '<div class="lrow"><div class="art thumb">' + art(l.photo, t('tomatoesOf', { variety: v.name })) + '</div>' +
      '<div class="info"><b>' + esc(v.name) + '</b><span class="muted small">' + l.crates + ' ' + esc(t('crates')) + ' · ' + cedi(l.price) + ' ' + esc(t('perCrate')) + ' · ' + esc(fmtDate(l.ready)) + '</span></div>' + statusPill(l) +
      '<div class="actions">' +
      (sold ? '<button class="btn sm" type="button" data-act="relist" data-id="' + l.id + '">' + esc(t('listAgain')) + '</button>'
            : '<button class="btn sm" type="button" data-act="edit" data-id="' + l.id + '">' + esc(t('edit')) + '</button><button class="btn sm" type="button" data-act="sold" data-id="' + l.id + '">' + esc(t('markSold')) + '</button>') +
      (ui.confirmRemove === l.id ? '<button class="btn sm danger" type="button" data-act="remove" data-id="' + l.id + '">' + esc(t('removeAgain')) + '</button>'
                                 : '<button class="btn sm" type="button" data-act="remove" data-id="' + l.id + '">' + esc(t('remove')) + '</button>') +
      '</div></div>';
  }
  function renderFarm() {
    var m = me();
    var mine = data.listings.filter(function (l) { return l.farmerId === m.id; });
    var active = mine.filter(function (l) { return l.status === 'active'; });
    var ids = mine.map(function (l) { return l.id; });
    var enq = data.enquiries.filter(function (e) { return ids.indexOf(e.listingId) !== -1; });
    var newEnq = enq.filter(function (e) { return !e.handled; });
    var editing = ui.editing && listingById(ui.editing);
    $('#view').innerHTML =
      '<h1>' + esc(t('hello', { name: m.name.split(' ')[0] })) + '</h1><p class="muted">' + esc(t('helloSub')) + '</p>' +
      '<div class="stats"><div class="stat"><b>' + active.length + '</b><span class="muted small">' + esc(t('sActive')) + '</span></div>' +
      '<div class="stat"><b>' + active.filter(isReady).length + '</b><span class="muted small">' + esc(t('sReady')) + '</span></div>' +
      '<div class="stat"><b>' + active.filter(function (l) { return !isReady(l); }).length + '</b><span class="muted small">' + esc(t('sUpcoming')) + '</span></div>' +
      '<div class="stat"><b>' + newEnq.length + '</b><span class="muted small">' + esc(t('sNew')) + '</span></div></div>' +
      '<section class="section"><div class="section-head"><h2>' + esc(t('yourProfile')) + '</h2></div>' +
      '<form id="profileForm" class="panel" novalidate><div class="profile">' + avatar(m, true) +
      '<div class="stack"><div class="actions"><button class="btn" type="button" data-act="pickphoto">' + esc(m.avatar ? t('changePhoto') : t('addPhoto')) + '</button>' +
      (m.avatar ? '<button class="btn" type="button" data-act="removephoto">' + esc(t('removePhoto')) + '</button>' : '') + '</div>' +
      '<span class="muted small">' + esc(t('photoHint')) + '</span>' +
      '<div class="err" id="p-err" role="alert">' + esc(ui.photoError ? t(ui.photoError) : '') + '</div>' +
      '<input id="photo" type="file" accept="image/*" hidden></div></div>' +
      '<div class="two"><label for="p-name">' + esc(t('pName')) + '<input id="p-name" name="name" value="' + esc(m.name) + '"></label>' +
      '<label for="p-farm">' + esc(t('pFarm')) + '<input id="p-farm" name="farm" value="' + esc(m.farm) + '"></label></div>' +
      '<div class="two"><label for="p-town">' + esc(t('pTown')) + '<input id="p-town" name="town" value="' + esc(m.town) + '"></label>' +
      '<label for="p-phone">' + esc(t('pPhone')) + '<input id="p-phone" name="phone" type="tel" value="' + esc(m.phone) + '"></label></div>' +
      '<label for="p-bio">' + esc(t('pBio')) + '<textarea id="p-bio" name="bio">' + esc(m.bio) + '</textarea></label>' +
      '<div class="actions"><button class="btn primary" type="submit">' + esc(t('saveProfile')) + '</button></div></form></section>' +
      '<section class="section"><div class="section-head"><h2>' + esc(t('yourHarvests')) + '</h2><button class="btn primary" type="button" data-act="add">' + esc(t('addHarvest')) + '</button></div>' +
      (ui.adding ? harvestForm(null) : '') + (editing ? harvestForm(editing) : '') +
      '<div class="stack">' + (mine.length ? mine.slice().sort(function (a, b) { return daysUntil(a.ready) - daysUntil(b.ready); }).map(manageRow).join('') : '<div class="empty">' + esc(t('noHarvests')) + '</div>') + '</div></section>' +
      '<section class="section"><h2>' + esc(t('requests')) + '</h2><div class="stack">' + (enq.length ? enq.map(function (e) {
        var l = listingById(e.listingId);
        return '<div class="lrow"><div class="info"><b>' + esc(t('wants', { buyer: e.buyer, n: e.crates })) + '</b><span class="muted small">' + esc(l ? varietyOf(l).name : '') + ' · ' + esc(fmtDate(e.date)) + '</span>' +
          (e.message ? '<span>' + esc(e.message) + '</span>' : '') + '</div>' +
          (e.handled ? '<span class="pill sold">' + esc(t('handled')) + '</span>' : '<button class="btn sm" type="button" data-act="handled" data-id="' + e.id + '">' + esc(t('markHandled')) + '</button>') + '</div>';
      }).join('') : '<div class="empty">' + esc(t('noRequests')) + '</div>') + '</div></section>';
  }

  /* ---------- demo phone: USSD menu, voice line (IVR) and SMS for farmers without a smartphone ---------- */
  /* The phone belongs to the demo farmer (data.me) and works on the same data as the website.
     Nothing is really dialled or sent.
     BACKEND: a USSD, voice and SMS provider would call your server with each key press, and the server
     would answer with the text that ussdText() and ivrPrompt() build here. */
  var USSD_CODE = '*920*55#'; /* made-up short code */
  var IVR_NUMBER = '5050';    /* made-up voice line number */
  var USSD_MAX = 160;         /* characters that fit on one USSD screen */
  var USSD_TIMEOUT_S = 120;    /* a real USSD session closes when the farmer stops answering */
  var PAGE = 4;               /* list rows on one USSD screen */
  var WHEN = [{ days: 0, key: 'pNow' }, { days: 3, key: 'pIn3' }, { days: 7, key: 'pIn7' }, { days: 14, key: 'pIn14' }];
  var KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];
  var canSpeak = 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function';
  /* mode: idle (dialling), ussd, ussdEnd (last USSD screen), call (voice line) or sms (inbox) */
  var ph = { mode: 'idle', typed: '', notice: '', endText: '', ussd: null, call: null, log: [], last: '', sound: true, timer: null, code: '', saveFail: false };
  try { ph.code = sessionStorage.getItem('hl-ph-code') || ''; } catch (e) { /* ignore */ }

  /* ----- test log (live version): one line per attempt, so we can count who finished and where they got stuck ----- */
  var trk = null;
  function trkBegin(ch) { trk = { ch: ch, t0: Date.now(), invalid: 0, back: 0, steps: [], reached: false }; trkStep('main'); }
  function trkStep(st) { if (!trk) return; if (trk.steps[trk.steps.length - 1] !== st) trk.steps.push(st); if (st === 'var') trk.reached = true; }
  function trkInvalid() { if (trk) trk.invalid++; }
  function trkBack() { if (trk) trk.back++; }
  function trkFinish(done, d) {
    var x = trk; trk = null;
    if (!x || !LIVE) return;
    if (!x.reached && !done) return; /* never started posting a harvest: nothing to count */
    STORE.recordPhoneSession({
      farmerCode: ph.code || null, channel: x.ch, durationS: Math.min(7200, Math.round((Date.now() - x.t0) / 1000)), reachedPost: x.reached, completed: !!done,
      invalid: Math.min(1000, x.invalid), back: Math.min(1000, x.back), steps: x.steps.join('>').slice(0, 200),
      draft: done ? { variety: varietyOf(d).name, crates: d.crates, price: d.price, ready: ymd(new Date(Date.now() + WHEN[d.when].days * 864e5)) } : null
    }).then(function () { ph.saveFail = false; phoneDraw(); }, function () { ph.saveFail = true; phoneDraw(); });
  }
  function liveFarmerId() {
    var c = (ph.code || '').toUpperCase(), f = data.farmers.filter(function (x) { return x.code && x.code.toUpperCase() === c; })[0];
    return f ? f.id : null;
  }

  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function clip(s, n) { s = String(s); return s.length > n ? s.slice(0, Math.max(0, n - 2)) + '..' : s; }
  function numbered(a) { return a.map(function (x, i) { return (i + 1) + '. ' + x; }).join('\n'); }
  function wholeNumber(v) { return /^\d{1,5}$/.test(v) ? parseInt(v, 10) : NaN; }
  function plural(n, one, many) { return n === 1 ? pt(one) : pt(many, { n: n }); }
  function phStatus(l) {
    var d = daysUntil(l.ready);
    return d <= 0 ? pt('readyNow') : d === 1 ? pt('readyTomorrow') : pt('readyIn', { n: d });
  }
  function myActive() {
    var owner = LIVE ? liveFarmerId() : data.me;
    return data.listings.filter(function (l) { return owner && l.farmerId === owner && l.status === 'active'; })
      .sort(function (a, b) { return daysUntil(a.ready) - daysUntil(b.ready); });
  }
  function myRequests() {
    if (LIVE) return []; /* buyer requests are private: the coordinator passes them on by phone */
    return data.enquiries.filter(function (e) { var l = listingById(e.listingId); return !e.handled && l && l.farmerId === data.me; });
  }
  function priceRanges() {
    return data.varieties.map(function (v) {
      var p = data.listings.filter(function (l) { return l.status === 'active' && l.variety === v.id; }).map(function (l) { return l.price; });
      return p.length ? { name: v.name, min: Math.min.apply(null, p), max: Math.max.apply(null, p) } : null;
    }).filter(Boolean);
  }
  function draftVars(d) {
    return { n: d.crates, variety: varietyOf(d).name, price: d.price, when: pt(WHEN[d.when].key), code: USSD_CODE };
  }

  /* SMS inbox of the demo phone. BACKEND: send a real SMS through your provider instead. */
  function unread() { return data.sms.filter(function (m) { return !m.read; }).length; }
  function sms(text) {
    data.sms.unshift({ id: uid('s'), text: text, at: Date.now(), read: false });
    data.sms = data.sms.slice(0, 20);
    save(); phoneDraw();
  }
  /* A harvest posted from the phone has no photo or notes; the farmer can add them on the website later. */
  function phonePost(d) {
    if (LIVE) { trkFinish(true, d); sms(pt('smsPostedLive', draftVars(d))); return; } /* the coordinator turns it into a listing after confirming by phone */
    /* BACKEND: create the listing on the server. */
    data.listings.push({ id: uid('l'), farmerId: data.me, variety: d.variety, crates: d.crates, price: d.price,
      ready: ymd(new Date(Date.now() + WHEN[d.when].days * 864e5)), notes: '', photo: null, status: 'active' });
    sms(pt('smsPosted', draftVars(d))); /* sms() also saves */
  }
  function phoneStop() {
    trkFinish(false); /* leaving, hanging up or timing out before confirming counts as not finished */
    clearTimeout(ph.timer);
    if (canSpeak) window.speechSynthesis.cancel();
    ph.mode = 'idle'; ph.typed = ''; ph.notice = ''; ph.ussd = null; ph.call = null;
  }

  /* ----- USSD: one short text screen at a time; the farmer answers with a number ----- */
  function ussdStart() {
    phoneStop();
    ph.mode = 'ussd'; ph.ussd = { step: 'main', draft: {}, page: 0, id: null, bad: false };
    trkBegin('ussd'); ussdTick();
  }
  function ussdTick() {
    clearTimeout(ph.timer);
    ph.timer = setTimeout(function () {
      if (ph.mode !== 'ussd') return;
      ussdEnd(pt('uTimeout', { code: USSD_CODE })); phoneDraw();
    }, USSD_TIMEOUT_S * 1000);
  }
  /* The last screen of a session: the network closes it and the farmer can only press OK. */
  function ussdEnd(text) {
    trkFinish(false); /* no-op when the harvest was just posted */
    clearTimeout(ph.timer);
    ph.mode = 'ussdEnd'; ph.endText = clip(text, USSD_MAX); ph.typed = ''; ph.ussd = null;
  }
  function ussdText() {
    var s = ph.ussd, back = '\n' + pt('uBack'), body, L, l, e, head, tail, room;
    if (s.step === 'main') body = pt('uMain');
    else if (s.step === 'var') body = pt('uVar') + '\n' + numbered(data.varieties.map(function (v) { return v.name; })) + back;
    else if (s.step === 'crates') body = pt('uCrates') + back;
    else if (s.step === 'price') body = pt('uPrice') + back;
    else if (s.step === 'ready') body = pt('uReady') + '\n' + numbered(WHEN.map(function (w) { return cap(pt(w.key)); })) + back;
    else if (s.step === 'confirm') body = pt('uConfirm', draftVars(s.draft));
    else if (s.step === 'mine') {
      L = myActive();
      if (!L.length) body = pt('uMineNone') + back;
      else body = pt('uMineTitle') + '\n' + numbered(L.slice(s.page * PAGE, s.page * PAGE + PAGE).map(function (x) {
        return pt('uMineItem', { variety: varietyOf(x).name, n: x.crates, price: x.price });
      })) + (L.length > (s.page + 1) * PAGE ? '\n' + pt('uMore') : '') + back;
    }
    else if (s.step === 'one') { l = listingById(s.id); body = pt(LIVE ? 'uOneLive' : 'uOne', { variety: varietyOf(l).name, n: l.crates, price: l.price, status: phStatus(l) }) + back; }
    else if (s.step === 'newprice') body = pt('uNewPrice') + back;
    else if (s.step === 'reqs') {
      L = myRequests();
      if (LIVE) body = pt('uReqLive') + back;
      else body = L.length ? pt('uReqTitle') + '\n' + numbered(L.slice(0, PAGE).map(function (x) { return pt('uReqItem', { buyer: clip(x.buyer, 18), n: x.crates }); })) + back
                      : pt('uReqNone') + back;
    }
    else {
      /* one buyer request: the buyer's message gets whatever room is left on the screen */
      e = data.enquiries.filter(function (x) { return x.id === s.id; })[0];
      head = pt('uReq', { buyer: clip(e.buyer, 30), n: e.crates, variety: varietyOf(listingById(e.listingId)).name });
      tail = '\n' + pt('uReqDo') + back;
      room = USSD_MAX - head.length - tail.length - pt('uInvalid').length - 4;
      body = head + (e.message && room > 10 ? '\n"' + clip(e.message, room) + '"' : '') + tail;
    }
    return clip((s.bad ? pt('uInvalid') + '\n' : '') + body, USSD_MAX);
  }
  function ussdSend() {
    var s = ph.ussd, v = ph.typed, n = wholeNumber(v), L, l, pick;
    ph.typed = ''; s.bad = false;
    if (s.step === 'main') {
      if (v === '1') { s.draft = {}; s.step = 'var'; }
      else if (v === '2') { s.page = 0; s.step = 'mine'; }
      else if (v === '3') s.step = 'reqs';
      else if (v === '4') {
        L = priceRanges();
        return ussdEnd(L.length ? pt('uPricesTitle') + '\n' + L.map(function (r) { return r.name + ' ' + (r.min === r.max ? r.min : r.min + '-' + r.max); }).join('\n') : pt('uNoPrices'));
      }
      else s.bad = true;
    }
    else if (s.step === 'var') {
      if (v === '0') s.step = 'main';
      else if (data.varieties[n - 1]) { s.draft.variety = data.varieties[n - 1].id; s.step = 'crates'; }
      else s.bad = true;
    }
    else if (s.step === 'crates') {
      if (v === '0') s.step = 'var';
      else if (n > 0) { s.draft.crates = n; s.step = 'price'; }
      else s.bad = true;
    }
    else if (s.step === 'price') {
      if (v === '0') s.step = 'crates';
      else if (n > 0) { s.draft.price = n; s.step = 'ready'; }
      else s.bad = true;
    }
    else if (s.step === 'ready') {
      if (v === '0') s.step = 'price';
      else if (WHEN[n - 1]) { s.draft.when = n - 1; s.step = 'confirm'; }
      else s.bad = true;
    }
    else if (s.step === 'confirm') {
      if (v === '1') { phonePost(s.draft); return ussdEnd(pt(LIVE ? 'uPostedLive' : 'uPosted')); }
      if (v === '2') return ussdEnd(pt('uCancelled'));
      s.bad = true;
    }
    else if (s.step === 'mine') {
      L = myActive(); pick = n >= 1 && n <= PAGE ? L[s.page * PAGE + n - 1] : null;
      if (v === '0') s.step = 'main';
      else if (!L.length && v === '1') { s.draft = {}; s.step = 'var'; }
      else if (v === '9' && L.length > (s.page + 1) * PAGE) s.page++;
      else if (L.length && pick) { s.id = pick.id; s.step = 'one'; }
      else s.bad = true;
    }
    else if (s.step === 'one') {
      l = listingById(s.id);
      if (v === '0') s.step = 'mine';
      else if (v === '1' && !LIVE) { l.status = 'sold'; save(); return ussdEnd(pt('uSold')); }
      else if (v === '2' && !LIVE) s.step = 'newprice';
      else s.bad = true;
    }
    else if (s.step === 'newprice') {
      if (v === '0') s.step = 'one';
      else if (n > 0) { listingById(s.id).price = n; save(); return ussdEnd(pt('uPriceSet', { price: n })); }
      else s.bad = true;
    }
    else if (s.step === 'reqs') {
      pick = n >= 1 && n <= PAGE ? myRequests()[n - 1] : null;
      if (v === '0') s.step = 'main';
      else if (pick) { s.id = pick.id; s.step = 'req'; }
      else s.bad = true;
    }
    else {
      if (v === '0') s.step = 'reqs';
      else if (v === '1') { data.enquiries.forEach(function (x) { if (x.id === s.id) x.handled = true; }); save(); return ussdEnd(pt('uHandled')); }
      else s.bad = true;
    }
    if (s.bad) trkInvalid(); else if (v === '0') trkBack();
    trkStep(s.step);
    ussdTick();
  }

  /* ----- voice line (IVR): the menu is read aloud and the farmer presses keys. For farmers who do not read. ----- */
  /* Each sentence is spoken on its own because some browsers cut off one long speech. */
  function speak(text) {
    if (!canSpeak) return;
    window.speechSynthesis.cancel();
    if (!ph.sound) return;
    (text.match(/[^.?!]+[.?!]*/g) || [text]).forEach(function (part) {
      if (!part.trim()) return;
      var u = new window.SpeechSynthesisUtterance(part.trim());
      u.lang = 'en-GB'; u.rate = 0.95;
      window.speechSynthesis.speak(u);
    });
  }
  function say(text) { ph.last = text; ph.log.push({ who: 'line', text: text }); speak(text); }
  function pressList(names) { return names.map(function (x, i) { return pt('vPress', { n: i + 1, what: x }); }).join(' '); }
  function ivrPrompt() {
    var c = ph.call, R, e;
    if (c.step === 'menu') return pt('vMenu');
    if (c.step === 'var') return pt('vVar') + ' ' + pressList(data.varieties.map(function (v) { return v.name; }));
    if (c.step === 'crates') return pt('vCrates');
    if (c.step === 'price') return pt('vPrice');
    if (c.step === 'ready') return pt('vReady') + ' ' + pressList(WHEN.map(function (w) { return pt(w.key); }));
    if (c.step === 'confirm') return pt('vConfirm', draftVars(c.draft));
    R = myRequests(); e = R[c.idx];
    return pt('vReq', { i: c.idx + 1, n: R.length, buyer: e.buyer, crates: e.crates, variety: varietyOf(listingById(e.listingId)).name }) +
      (e.message ? ' ' + pt('vReqMsg', { message: e.message }) : '') + ' ' + pt('vReqKeys');
  }
  function ivrGo(step, before) {
    trkStep(step);
    ph.call.step = step; ph.call.digits = '';
    say((before ? before + ' ' : '') + ivrPrompt());
  }
  function callStart() {
    phoneStop();
    ph.mode = 'call'; ph.call = { step: 'menu', digits: '', keys: '', draft: {}, idx: 0 }; ph.log = [];
    trkBegin('voice');
    ivrGo('menu', LIVE ? pt('vWelcomeLive') : pt('vWelcome', { name: me().name.split(' ')[0], harvests: plural(myActive().length, 'vHarvest1', 'vHarvestN'), requests: plural(myRequests().length, 'vRequest1', 'vRequestN') }));
  }
  function ivrKey(k) {
    var c = ph.call, typing = c.step === 'crates' || c.step === 'price', n = parseInt(k, 10), last = ph.log[ph.log.length - 1], L, R;
    c.keys = (c.keys + ' ' + k).slice(-16);
    if (last && last.who === 'you') last.text += ' ' + k; else ph.log.push({ who: 'you', text: k });
    var wrong = function () { trkInvalid(); say(pt('vInvalid') + ' ' + ivrPrompt()); };
    if (k === '*') return ivrGo(c.step); /* hear it again */
    if (typing) {
      /* numbers are typed digit by digit and finished with # */
      if (k !== '#') { if (c.digits.length < 5) c.digits += k; if (canSpeak) window.speechSynthesis.cancel(); return; }
      n = wholeNumber(c.digits);
      if (!(n > 0)) { c.digits = ''; trkInvalid(); return say(pt('vBadNumber') + ' ' + ivrPrompt()); }
      if (c.step === 'crates') { c.draft.crates = n; return ivrGo('price'); }
      c.draft.price = n; return ivrGo('ready');
    }
    if (k === '0' && c.step !== 'menu') { trkBack(); return ivrGo('menu'); }
    if (c.step === 'menu') {
      if (k === '1') { c.draft = {}; ivrGo('var'); }
      else if (k === '2') {
        L = myActive();
        ivrGo('menu', L.length ? pt('vMine', { harvests: plural(L.length, 'vHarvest1', 'vHarvestN') }) + ' ' + L.map(function (l, i) {
          return pt('vMineItem', { i: i + 1, n: l.crates, variety: varietyOf(l).name, price: l.price, status: phStatus(l).toLowerCase() });
        }).join(' ') : pt('vMineNone'));
      }
      else if (k === '3') { if (LIVE) ivrGo('menu', pt('vReqLive')); else if (myRequests().length) { c.idx = 0; ivrGo('req'); } else ivrGo('menu', pt('vReqNone')); }
      else if (k === '4') {
        L = priceRanges();
        ivrGo('menu', L.length ? pt('vPrices') + ' ' + L.map(function (r) { return r.min === r.max ? pt('vPriceOne', { name: r.name, price: r.min }) : pt('vPriceRange', r); }).join(' ') : pt('vNoPrices'));
      }
      else wrong();
    }
    else if (c.step === 'var') { if (data.varieties[n - 1]) { c.draft.variety = data.varieties[n - 1].id; ivrGo('crates'); } else wrong(); }
    else if (c.step === 'ready') { if (WHEN[n - 1]) { c.draft.when = n - 1; ivrGo('confirm'); } else wrong(); }
    else if (c.step === 'confirm') {
      if (k === '1') { phonePost(c.draft); ivrGo('menu', pt(LIVE ? 'vPostedLive' : 'vPosted')); }
      else if (k === '2') ivrGo('menu', pt('vCancelled'));
      else wrong();
    }
    else {
      R = myRequests();
      if (k === '1') { c.idx = (c.idx + 1) % R.length; ivrGo('req'); }
      else if (k === '2') {
        R[c.idx].handled = true; save(); R = myRequests();
        if (R.length) { c.idx = c.idx % R.length; ivrGo('req', pt('vHandled')); }
        else ivrGo('menu', pt('vHandled') + ' ' + pt('vReqNone'));
      }
      else wrong();
    }
  }

  /* ----- the phone itself: keys, screen and the page around it ----- */
  function phoneKey(k) {
    var m = ph.mode;
    ph.notice = '';
    if (m === 'call') {
      if (k === 'end') { phoneStop(); ph.notice = pt('sCallEnded'); }
      else if (KEYS.indexOf(k) !== -1) ivrKey(k);
    }
    else if (m === 'ussd') {
      if (k === 'end') phoneStop();
      else if (k === 'call') ussdSend();
      else if (k === 'del') { ph.typed = ph.typed.slice(0, -1); ussdTick(); }
      else if (KEYS.indexOf(k) !== -1) { if (ph.typed.length < 12) ph.typed += k; ussdTick(); }
    }
    else if (m === 'ussdEnd' || m === 'sms') { if (k === 'call' || k === 'end') phoneStop(); }
    else if (k === 'sms') { ph.mode = 'sms'; ph.typed = ''; data.sms.forEach(function (x) { x.read = true; }); save(); }
    else if (k === 'del') ph.typed = ph.typed.slice(0, -1);
    else if (k === 'end') ph.typed = '';
    else if (k === 'call') {
      if (ph.typed === USSD_CODE) ussdStart();
      else if (ph.typed === IVR_NUMBER) callStart();
      else if (ph.typed) { ph.typed = ''; ph.notice = pt('sWrong', { code: USSD_CODE, num: IVR_NUMBER }); }
    }
    else if (ph.typed.length < 15) ph.typed += k;
    phoneDraw();
  }
  function phoneScreen() {
    var m = ph.mode, n = unread(), text;
    if (m === 'ussd' || m === 'ussdEnd') {
      text = m === 'ussd' ? ussdText() : ph.endText;
      return '<div class="ph-ussd">' + esc(text) + '</div>' +
        (m === 'ussd' ? '<div class="ph-reply">' + esc(ph.typed) + '_</div>' : '') +
        '<div class="ph-foot"><span>' + esc(m === 'ussd' ? pt('sSend') : pt('sOk')) + '</span><span>' + text.length + '/' + USSD_MAX + '</span></div>';
    }
    if (m === 'call') {
      return '<div class="ph-status">' + esc(pt('sCall', { num: IVR_NUMBER })) + '</div><div class="ph-big">' + esc(pt('sInCall')) + '</div>' +
        '<div>' + esc(ph.call.keys ? pt('sKeys', { keys: ph.call.keys.trim() }) : '') + '</div><div class="ph-foot"><span>' + esc(pt('sHangUp')) + '</span></div>';
    }
    if (m === 'sms') {
      return '<div class="ph-status">' + esc(pt('sMessages')) + '</div>' + (data.sms.length ? data.sms.map(function (x) {
        return '<div class="ph-sms"><span class="ph-time">' + esc(new Date(x.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })) + '</span> ' + esc(x.text) + '</div>';
      }).join('') : '<div>' + esc(pt('sNoSms')) + '</div>') + '<div class="ph-foot"><span>' + esc(pt('sBack')) + '</span></div>';
    }
    return '<div class="ph-status">' + esc(LIVE ? pt('sTestPhone') + (ph.code ? ' · ' + ph.code : '') : me().name + ' · ' + me().phone) + '</div><div class="ph-big">' + esc(ph.typed) + '</div>' +
      '<div>' + esc(ph.notice || (ph.typed ? '' : pt('sIdle', { code: USSD_CODE, num: IVR_NUMBER }))) + '</div>' +
      '<div class="ph-foot"><span>' + esc(n ? plural(n, 'sNewSms1', 'sNewSms') : '') + '</span></div>';
  }
  /* Redraws only the screen and the few labels that change, so the key that was pressed keeps the focus. */
  function phoneDraw() {
    var sc = $('#ph-screen');
    if (!sc) return; /* the phone page is not open */
    sc.innerHTML = phoneScreen();
    $('#ph-smsbtn').textContent = t('phOpenSms', { n: unread() });
    if ($('#ph-sound')) $('#ph-sound').textContent = t(ph.sound ? 'phSoundOn' : 'phSoundOff');
    var log = $('#ph-log');
    log.innerHTML = ph.log.length ? ph.log.map(function (x) {
      return '<p' + (x.who === 'you' ? ' class="muted"' : '') + '><b>' + esc(t(x.who === 'you' ? 'phYou' : 'phLine')) + ':</b> ' + esc(x.text) + '</p>';
    }).join('') : '<p class="muted">' + esc(t('phLogEmpty', { num: IVR_NUMBER })) + '</p>';
    log.scrollTop = log.scrollHeight;
    if ($('#ph-warn')) $('#ph-warn').textContent = ph.saveFail ? t('phSaveFail') : '';
  }
  function renderPhone() {
    var m = me(), names = { code: USSD_CODE, num: IVR_NUMBER, name: m.name.split(' ')[0] };
    var fn = function (k, cls, label) { return '<button type="button" class="ph-key fn ' + cls + '" data-key="' + k + '">' + esc(pt(label)) + '</button>'; };
    $('#view').innerHTML =
      '<h1>' + esc(t('phTitle')) + '</h1><p class="muted">' + esc(LIVE ? t('phIntroLive') : t('phIntro', { name: m.name })) + '</p>' +
      (LIVE ? '<label class="ph-code" for="ph-code">' + esc(t('phCode')) + ' <input id="ph-code" maxlength="12" value="' + esc(ph.code) + '" placeholder="F1" autocomplete="off"></label>' : '') +
      '<div class="phone-wrap"><div class="phone" role="group" aria-label="' + esc(t('phLabel')) + '">' +
      '<div class="ph-screen" id="ph-screen" aria-live="polite"></div>' +
      '<div class="ph-fn">' + fn('call', 'call', 'kCall') + fn('sms', '', 'kSms') + fn('del', '', 'kDel') + fn('end', 'end', 'kEnd') + '</div>' +
      '<div class="ph-pad">' + KEYS.map(function (k) { return '<button type="button" class="ph-key" data-key="' + k + '">' + k + '</button>'; }).join('') + '</div></div>' +
      '<div class="stack"><div class="panel"><h2>' + esc(t('phTry')) + '</h2><ol class="ph-steps">' +
      (LIVE ? ['phStep1', 'phStep2', 'phStep3Live'] : ['phStep1', 'phStep2', 'phStep3', 'phStep4']).map(function (k) { return '<li>' + esc(t(k, names)) + '</li>'; }).join('') + '</ol>' +
      '<div class="actions"><button class="btn primary" type="button" data-act="phussd">' + esc(t('phDialUssd', names)) + '</button>' +
      '<button class="btn" type="button" data-act="phcall">' + esc(t('phDialIvr', names)) + '</button>' +
      '<button class="btn" type="button" data-act="phsms" id="ph-smsbtn"></button></div>' +
      '<span class="muted small">' + esc(t('phKeys')) + '</span><div class="err" id="ph-warn" role="alert"></div></div>' +
      '<div class="panel"><div class="section-head"><h2>' + esc(t('phLog')) + '</h2>' +
      (canSpeak ? '<button class="btn sm" type="button" data-act="phsound" id="ph-sound"></button>' : '') + '</div>' +
      '<span class="muted small">' + esc(t(canSpeak ? 'phLogHint' : 'phNoVoice')) + '</span>' +
      '<div class="ph-log" id="ph-log" role="log"></div></div></div></div>';
    phoneDraw();
  }

  /* ---------- photos: crop to the middle and shrink to w x h before storing ---------- */
  function shrinkImage(file, w, h) {
    return new Promise(function (resolve, reject) {
      if (!/^image\//.test(file.type)) return reject({ key: 'errPhotoType' });
      if (file.size > 12 * 1024 * 1024) return reject({ key: 'errPhotoBig' });
      var r = new FileReader();
      r.onerror = function () { reject({ key: 'errPhotoRead' }); };
      r.onload = function () {
        var img = new Image();
        img.onerror = function () { reject({ key: 'errPhotoOpen' }); };
        img.onload = function () {
          var s = Math.max(w / img.width, h / img.height), sw = w / s, sh = h / s;
          var c = document.createElement('canvas'); c.width = w; c.height = h;
          c.getContext('2d').drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, 0, 0, w, h);
          resolve(c.toDataURL('image/jpeg', 0.8));
        };
        img.src = r.result;
      };
      r.readAsDataURL(file);
    });
  }

  /* ---------- toast ---------- */
  var toastTimer;
  function toast(msg) {
    $('#toastHost').innerHTML = '<div class="toast" role="status">' + esc(msg) + '</div>';
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { $('#toastHost').innerHTML = ''; }, 3000);
  }

  /* ---------- main render ---------- */
  function render() {
    renderChrome();
    if (LIVE && live.state !== 'ready' && (ui.route.name === 'browse' || ui.route.name === 'listing')) { renderLiveWait(); renderTray(); return; }
    if (ui.route.name === 'listing') renderListing();
    else if (ui.route.name === 'farm') renderFarm();
    else if (ui.route.name === 'phone') renderPhone();
    else renderBrowse();
    renderTray();
    if ($('#overlay').innerHTML) renderCompare();
  }

  /* ---------- events ---------- */
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-lang],[data-go],[data-open],[data-status],[data-act],[data-key]');
    if (!el) return;
    if (el.dataset.key) return phoneKey(el.dataset.key);
    if (el.dataset.act === 'closeov' && e.target !== el && !el.matches('button')) return; /* only the backdrop or Close closes */
    if (el.dataset.lang) {
      if (!I18N[el.dataset.lang]) return;
      lang = el.dataset.lang;
      try { localStorage.setItem(LANG_KEY, lang); } catch (err) { /* ignore */ }
      return render();
    }
    if (el.dataset.go) return go(el.dataset.go);
    if (el.dataset.open) { $('#overlay').innerHTML = ''; return go('listing', el.dataset.open); }
    if (el.dataset.status) { ui.filter.status = el.dataset.status; return renderBrowse(); }
    var a = el.dataset.act, id = el.dataset.id, l;
    if (a === 'compare') renderCompare();
    else if (a === 'closeov') $('#overlay').innerHTML = '';
    else if (a === 'clearcmp') { ui.compare = []; if (ui.route.name === 'browse') renderResults(); else renderTray(); }
    else if (a === 'copy') {
      var done = function () { toast(t('copied')); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(el.dataset.num).then(done, function () { toast(el.dataset.num); });
      else toast(el.dataset.num);
    }
    else if (a === 'add') { ui.adding = true; ui.editing = null; ui.harvestPhoto = null; renderFarm(); var h = $('#h-crates'); if (h) h.focus(); }
    else if (a === 'cancelform') { ui.adding = false; ui.editing = null; ui.harvestPhoto = null; renderFarm(); }
    else if (a === 'edit') { ui.editing = id; ui.adding = false; ui.harvestPhoto = listingById(id).photo || null; renderFarm(); var c = $('#h-crates'); if (c) c.focus(); }
    /* The harvest photo buttons redraw only the photo box, so what the farmer has typed in the form is kept. */
    else if (a === 'pickhphoto') { $('#hphoto').click(); }
    else if (a === 'removehphoto') { ui.harvestPhoto = null; $('#hphoto').value = ''; $('#h-photo').innerHTML = harvestPhotoHtml(); }
    else if (a === 'sold' || a === 'relist') { l = listingById(id); l.status = a === 'sold' ? 'sold' : 'active'; save(); renderFarm(); toast(a === 'sold' ? t('tSold') : t('tRelisted')); }
    else if (a === 'remove') {
      if (ui.confirmRemove === id) { data.listings = data.listings.filter(function (x) { return x.id !== id; }); ui.compare = ui.compare.filter(function (x) { return x !== id; }); ui.confirmRemove = null; save(); renderFarm(); toast(t('tRemoved')); }
      else { ui.confirmRemove = id; renderFarm(); }
    }
    else if (a === 'handled') { data.enquiries.forEach(function (x) { if (x.id === id) x.handled = true; }); save(); renderFarm(); }
    else if (a === 'pickphoto') { $('#photo').click(); }
    else if (a === 'removephoto') { me().avatar = null; save(); renderFarm(); }
    else if (a === 'liveretry') { loadLive(); }
    else if (a === 'phussd') { ussdStart(); phoneDraw(); }
    else if (a === 'phcall') { callStart(); phoneDraw(); }
    else if (a === 'phsms') { phoneStop(); phoneKey('sms'); }
    else if (a === 'phsound') { ph.sound = !ph.sound; if (ph.mode === 'call') speak(ph.last); phoneDraw(); }
    else if (a === 'reset') { try { localStorage.removeItem(KEY); } catch (err) { /* ignore */ } data = clone(SEED); ui.compare = []; ui.adding = false; ui.editing = null; ui.harvestPhoto = null; phoneStop(); ph.log = []; go('browse'); toast(t('tReset')); }
  });
  /* On the phone page the computer keyboard works the phone keys. */
  document.addEventListener('keydown', function (e) {
    if (ui.route.name !== 'phone' || e.ctrlKey || e.metaKey || e.altKey || !e.target.closest) return;
    if (e.target.closest('input,textarea,select')) return;
    var k = e.key;
    if (k === 'Enter') { if (e.target.closest('button:not(.ph-key),a')) return; k = 'call'; }
    else if (k === 'Backspace') k = 'del';
    else if (k === 'Escape') k = 'end';
    else if (KEYS.indexOf(k) === -1) return;
    e.preventDefault();
    phoneKey(k);
  });
  document.addEventListener('input', function (e) {
    if (e.target.id === 'q') { ui.filter.q = e.target.value; renderResults(); }
    else if (e.target.id === 'ph-code') {
      ph.code = e.target.value.trim().toUpperCase().slice(0, 12);
      try { sessionStorage.setItem('hl-ph-code', ph.code); } catch (err) { /* ignore */ }
      phoneDraw();
    }
  });
  document.addEventListener('change', function (e) {
    var el = e.target;
    if (el.id === 'variety') { ui.filter.variety = el.value; renderResults(); }
    else if (el.id === 'sort') { ui.filter.sort = el.value; renderResults(); }
    else if (el.dataset && el.dataset.cmp) {
      var id = el.dataset.cmp, i = ui.compare.indexOf(id);
      if (el.checked) {
        if (ui.compare.length >= 3) { el.checked = false; toast(t('compareMax')); return; }
        ui.compare.push(id);
      } else if (i !== -1) ui.compare.splice(i, 1);
      renderTray();
    }
    else if (el.id === 'photo' && el.files && el.files[0]) {
      shrinkImage(el.files[0], 240, 240).then(function (url) {
        me().avatar = url; ui.photoError = ''; save(); renderFarm(); toast(t('photoSaved'));
      }, function (err) { ui.photoError = (err && err.key) || 'errPhotoRead'; renderFarm(); });
    }
    else if (el.id === 'hphoto' && el.files && el.files[0]) {
      shrinkImage(el.files[0], 640, 360).then(function (url) {
        if (!$('#h-photo')) return; /* the form was closed while the picture loaded */
        ui.harvestPhoto = url; $('#h-photo').innerHTML = harvestPhotoHtml(); $('#h-err').textContent = '';
      }, function (err) { if ($('#h-err')) $('#h-err').textContent = t((err && err.key) || 'errPhotoRead'); });
      el.value = ''; /* so choosing the same file again still counts as a change */
    }
  });
  document.addEventListener('submit', function (e) {
    var f = e.target;
    e.preventDefault();
    var fd = new FormData(f), err;
    if (f.id === 'enqForm') {
      var crates = parseInt(fd.get('crates'), 10), name = String(fd.get('buyer') || '').trim();
      err = $('#e-err');
      var l = listingById(f.dataset.id);
      if (!name) { err.textContent = t('errName'); return; }
      if (!(crates > 0)) { err.textContent = t('errCrates'); return; }
      if (crates > l.crates) { err.textContent = t('errMax', { n: l.crates }); return; }
      if (LIVE) {
        /* Sent to the database. The coordinator sees it and calls the buyer; the farmer's number is never shown. */
        var phone = String(fd.get('phone') || '').replace(/[\s-]/g, '');
        if (!/^\+?\d{9,15}$/.test(phone)) { err.textContent = t('errPhone'); return; }
        if (!fd.get('consent')) { err.textContent = t('errConsent'); return; }
        var sb = f.querySelector('button[type=submit]'); sb.disabled = true; err.textContent = '';
        STORE.sendEnquiry({ listingId: l.id, buyerName: name, buyerPhone: phone, crates: crates, intent: String(fd.get('intent') || 'commit'),
          message: String(fd.get('message') || '').trim(), consent: true })
          .then(function () { ui.sent = l.id; ui.sentPhone = phone; renderListing(); toast(t('tSent')); },
                function () { sb.disabled = false; err.textContent = t('errSend'); });
        return;
      }
      /* BACKEND: send this request to the farmer instead of storing it locally. */
      data.enquiries.unshift({ id: uid('e'), listingId: l.id, buyer: name, crates: crates, message: String(fd.get('message') || '').trim(), date: today, handled: false });
      save(); ui.sent = l.id; renderListing(); toast(t('tSent'));
      /* The demo farmer hears about it by SMS on the demo phone. */
      if (l.farmerId === data.me) sms(pt('smsRequest', { buyer: name, n: crates, variety: varietyOf(l).name, code: USSD_CODE }));
    } else if (f.id === 'harvestForm') {
      err = $('#h-err');
      var cr = parseInt(fd.get('crates'), 10), pr = parseFloat(fd.get('price')), rd = fd.get('ready');
      if (!(cr > 0)) { err.textContent = t('errHCrates'); return; }
      if (!(pr > 0)) { err.textContent = t('errHPrice'); return; }
      if (!rd) { err.textContent = t('errHDate'); return; }
      var rec = { variety: fd.get('variety'), crates: cr, price: pr, ready: rd, notes: String(fd.get('notes') || '').trim(), photo: ui.harvestPhoto || null };
      /* BACKEND: create or update the listing on the server, and upload the photo file to storage. */
      var isEdit = !!f.dataset.id;
      if (isEdit) Object.assign(listingById(f.dataset.id), rec);
      else data.listings.push(Object.assign({ id: uid('l'), farmerId: data.me, status: 'active' }, rec));
      var stored = save();
      ui.adding = false; ui.editing = null; ui.harvestPhoto = null; renderFarm();
      toast(!stored ? t('errStore') : isEdit ? t('tSaved') : t('tAdded'));
    } else if (f.id === 'profileForm') {
      var m = me();
      var nm = String(fd.get('name') || '').trim();
      if (!nm) { $('#p-err').textContent = t('errPName'); return; }
      m.name = nm; m.farm = String(fd.get('farm') || '').trim(); m.town = String(fd.get('town') || '').trim();
      m.phone = String(fd.get('phone') || '').trim(); m.bio = String(fd.get('bio') || '').trim();
      save(); renderFarm(); toast(t('profileSaved'));
    }
  });

  document.addEventListener('visibilitychange', function () { if (LIVE && !document.hidden && live.state === 'ready') refreshLive(); });
  render();
  if (LIVE) loadLive();
})();
