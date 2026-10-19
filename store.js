/* HarvestLink data layer for the BUILD stage.
   Talks to Supabase with plain fetch (no library, no build step).
   - Anyone can read consented, active listings (listPublic), send a buyer request (sendEnquiry) and
     add one line to the phone-test log (recordPhoneSession). They can read nothing else.
   - Only signed-in coordinators can read or write private data (everything else).
   Every function returns a Promise and throws an Error with a plain message on failure. */
(function () {
  var cfg = window.HL_CONFIG || {};
  var SESSION_KEY = 'hl-coord-session';   /* sessionStorage: cleared when the tab closes */
  var session = null;
  try { session = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch (e) {}

  function saveSession(s) {
    session = s;
    try { s ? sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)) : sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
  }
  function configured() { return !!(cfg.supabaseUrl && cfg.publishableKey); }
  function signedIn() { return !!(session && session.access_token); }

  function authHeaders(extra) {
    /* The publishable key is NOT a login token: it goes in `apikey` only.
       A signed-in coordinator adds their own token as Bearer. */
    var h = { apikey: cfg.publishableKey, 'Content-Type': 'application/json' };
    if (signedIn()) h.Authorization = 'Bearer ' + session.access_token;
    if (extra) Object.keys(extra).forEach(function (k) { h[k] = extra[k]; });
    return h;
  }

  function explain(status, body) {
    var msg = body && (body.message || body.msg || body.error_description || body.error || body.hint);
    if (status === 401 || status === 403) return 'Not allowed. Sign in as a coordinator and try again.' + (msg ? ' (' + msg + ')' : '');
    if (status === 409) return 'That already exists (duplicate code).';
    if (status === 400 || status === 422) return 'The database rejected this: ' + (msg || 'check the values.');
    if (status === 404) return 'Table not found. Run schema.sql in Supabase first.';
    return 'Request failed (' + status + ')' + (msg ? ': ' + msg : '');
  }

  function refresh() {
    if (!session || !session.refresh_token) return Promise.reject(new Error('Session ended. Sign in again.'));
    return fetch(cfg.supabaseUrl + '/auth/v1/token?grant_type=refresh_token', {
      method: 'POST', headers: { apikey: cfg.publishableKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: session.refresh_token })
    }).then(function (r) { return r.json().then(function (b) { return { r: r, b: b }; }); })
      .then(function (x) {
        if (!x.r.ok || !x.b.access_token) { saveSession(null); throw new Error('Session ended. Sign in again.'); }
        saveSession({ access_token: x.b.access_token, refresh_token: x.b.refresh_token, email: session.email });
      });
  }

  function call(method, path, body, opts) {
    opts = opts || {};
    if (!configured()) return Promise.reject(new Error('Database is not configured (see config.js).'));
    function go() {
      var extra = {};
      if (opts.returning) extra.Prefer = 'return=representation';
      if (opts.upsert) extra.Prefer = 'resolution=merge-duplicates' + (opts.returning ? ',return=representation' : '');
      return fetch(cfg.supabaseUrl + '/rest/v1/' + path, {
        method: method, headers: authHeaders(extra), body: body === undefined ? undefined : JSON.stringify(body)
      });
    }
    return go().then(function (r) {
      if (r.status === 401 && signedIn()) {
        return refresh().then(go);
      }
      return r;
    }).then(function (r) {
      if (r.status === 204) return [];
      return r.text().then(function (t) {
        var b = null; try { b = t ? JSON.parse(t) : null; } catch (e) {}
        if (!r.ok) throw new Error(explain(r.status, b));
        return b;
      });
    });
  }

  function clean(o) { /* drop empty strings so the database gets NULL instead of '' */
    var out = {};
    Object.keys(o).forEach(function (k) { var v = o[k]; if (v === '' || v === undefined) v = null; out[k] = v; });
    return out;
  }
  function one(rows) { return Array.isArray(rows) ? rows[0] : rows; }
  function nextCode(prefix, rows) {
    var n = 0;
    rows.forEach(function (r) { var m = new RegExp('^' + prefix + '(\\d+)$').exec(r.code || ''); if (m) n = Math.max(n, +m[1]); });
    return prefix + (n + 1);
  }

  window.HL_STORE = {
    configured: configured,
    signedIn: signedIn,
    email: function () { return session && session.email || ''; },

    signIn: function (email, password) {
      if (!configured()) return Promise.reject(new Error('Database is not configured (see config.js).'));
      return fetch(cfg.supabaseUrl + '/auth/v1/token?grant_type=password', {
        method: 'POST', headers: { apikey: cfg.publishableKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, password: password })
      }).then(null, function () { throw new Error('Sign-in failed: could not reach the database. Check the internet connection and the address in config.js.'); })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (b) { return { r: r, b: b }; }); })
        .then(function (x) {
          if (!x.r.ok || !x.b.access_token) {
            /* Say what Supabase actually said, so a setup problem is not mistaken for a typo. */
            var code = String(x.b.error_code || x.b.code || ''), raw = String(x.b.msg || x.b.error_description || x.b.message || x.b.error || '');
            if (code === 'email_not_confirmed' || /not confirmed/i.test(raw)) throw new Error('Sign-in failed: this email address is not confirmed yet. In Supabase open Authentication, then Users, open this user and choose Confirm email (or delete the user and add it again with Auto Confirm User ticked).');
            if (code === 'invalid_credentials' || /invalid login/i.test(raw)) throw new Error('Sign-in failed: Supabase says the email or password does not match a user in this project. Check you are using the user you created under Authentication, Users, and reset its password there if unsure.');
            if (/api key|apikey/i.test(raw) || x.r.status === 401 || x.r.status === 403) throw new Error('Sign-in failed: the database did not accept the key in config.js (' + (raw || 'status ' + x.r.status) + '). Copy the publishable key again from Project Settings, API Keys.');
            if (x.r.status === 429) throw new Error('Sign-in failed: too many attempts. Wait a few minutes and try again.');
            throw new Error('Sign-in failed (' + x.r.status + '): ' + (raw || 'unknown reason') + '.');
          }
          saveSession({ access_token: x.b.access_token, refresh_token: x.b.refresh_token, email: email });
          /* Ask the database whether this account is a coordinator (the browser cannot fake this). */
          return call('POST', 'rpc/is_coordinator', {}).then(function (ok) {
            if (ok !== true) { saveSession(null); throw new Error('This account is not a coordinator.'); }
            return true;
          });
        });
    },
    isCoordinator: function () { return call('POST', 'rpc/is_coordinator', {}).then(function (ok) { return ok === true; }); },
    signOut: function () { saveSession(null); return Promise.resolve(); },

    /* ---- public (no sign-in) ---- */
    listPublic: function () {
      return Promise.all([
        call('GET', 'farmers?select=id,code,display_name,farm,town,region,since,bio&order=created_at.asc'),
        call('GET', 'listings?select=id,farmer_id,variety,crates,price,ready,notes,status&status=eq.active&order=ready.asc')
      ]).then(function (a) { return { farmers: a[0], listings: a[1] }; });
    },
    sendEnquiry: function (e) {
      /* No "return" asked for: the public key may insert but may not read enquiries back.
         The database refuses the row unless contact_consent is true and a phone number is present (schema-2.sql). */
      return call('POST', 'enquiries', clean({
        listing_id: e.listingId, buyer_name: e.buyerName, buyer_phone: e.buyerPhone, crates: e.crates,
        intent: e.intent, message: e.message, contact_consent: e.consent === true
      }));
    },
    recordPhoneSession: function (s) {
      /* One line per attempt on the phone simulation. Insert only: the public key cannot read these back. */
      var d = s.draft || {};
      return call('POST', 'phone_sessions', clean({
        farmer_code: s.farmerCode, channel: s.channel, duration_s: s.durationS, reached_post: !!s.reachedPost, completed: !!s.completed,
        invalid_count: s.invalid, back_count: s.back, steps: s.steps,
        variety: d.variety, crates: d.crates, price: d.price, ready: d.ready
      }));
    },

    /* ---- coordinator ---- */
    loadAll: function () {
      var t = [['farmers', 'created_at.asc'], ['farmer_private', 'farmer_id.asc'], ['listings', 'created_at.asc'], ['buyers', 'created_at.asc'],
               ['responses', 'created_at.asc'], ['follow_ups', 'created_at.asc'], ['enquiries', 'created_at.asc'], ['phone_sessions', 'created_at.asc']];
      var needs2 = false;
      return Promise.all(t.map(function (x) {
        return call('GET', x[0] + '?select=*&order=' + x[1]).catch(function (err) {
          /* schema-2.sql not run yet: keep the rest of the page working and say so */
          if (x[0] === 'phone_sessions' && /not found|Table/.test(err.message)) { needs2 = true; return []; }
          throw err;
        });
      })).then(function (r) { var o = {}; t.forEach(function (x, i) { o[x[0]] = r[i]; }); o.needsSchema2 = needs2; return o; });
    },
    setEnquiryHandled: function (id, handled) {
      return call('PATCH', 'enquiries?id=eq.' + encodeURIComponent(id), { handled: !!handled }, { returning: true }).then(one);
    },
    setSessionNote: function (id, note) {
      return call('PATCH', 'phone_sessions?id=eq.' + encodeURIComponent(id), clean({ note: note }), { returning: true }).then(one);
    },
    linkSessionListing: function (id, listingId) {
      return call('PATCH', 'phone_sessions?id=eq.' + encodeURIComponent(id), { listing_id: listingId }, { returning: true }).then(one);
    },
    addFarmer: function (f, existing) {
      var code = nextCode('F', existing);
      return call('POST', 'farmers', clean({
        code: code, display_name: f.displayName, farm: f.farm, town: f.town, region: f.region,
        consent_given: !!f.consent, consent_note: f.consentNote
      }), { returning: true }).then(function (rows) {
        var farmer = one(rows);
        return call('POST', 'farmer_private', clean({ farmer_id: farmer.id, full_name: f.fullName, phone: f.phone })).then(function () { return farmer; });
      });
    },
    addListing: function (l) {
      return call('POST', 'listings', clean({
        farmer_id: l.farmerId, variety: l.variety, crates: +l.crates, price: +l.price, ready: l.ready,
        notes: l.notes, posted_by: l.postedBy || 'coordinator'
      }), { returning: true }).then(one);
    },
    setListingStatus: function (id, status) {
      return call('PATCH', 'listings?id=eq.' + encodeURIComponent(id), { status: status }, { returning: true }).then(one);
    },
    addBuyer: function (b, existing) {
      var code = nextCode('B', existing);
      return call('POST', 'buyers', clean({
        code: code, kind: b.kind, town: b.town, full_name: b.fullName, phone: b.phone,
        consent_given: !!b.consent, consent_note: b.consentNote
      }), { returning: true }).then(one);
    },
    addResponse: function (r) {
      return call('POST', 'responses', clean({
        listing_id: r.listingId, buyer_id: r.buyerId, answer: r.answer,
        crates: r.crates ? +r.crates : null, price: r.price ? +r.price : null,
        needed_on: r.neededOn, reason: r.reason
      }), { returning: true }).then(one);
    },
    saveFollowUp: function (f) {
      var row = clean({
        listing_id: f.listingId, harvested_on: f.harvestedOn,
        on_time: f.onTime === '' || f.onTime == null ? null : f.onTime === true || f.onTime === 'yes',
        days_off: f.daysOff === '' || f.daysOff == null ? null : +f.daysOff,
        sold_crates: f.sold === '' || f.sold == null ? null : +f.sold,
        rejected_crates: f.rejected === '' || f.rejected == null ? null : +f.rejected,
        cheap_crates: f.cheap === '' || f.cheap == null ? null : +f.cheap,
        would_use_again: f.wouldUseAgain, change_wanted: f.changeWanted
      });
      return call('POST', 'follow_ups?on_conflict=listing_id', row, { upsert: true, returning: true }).then(one);
    }
  };
})();

// /* HarvestLink data layer for the BUILD stage.
//    Talks to Supabase with plain fetch (no library, no build step).
//    - Anyone can read consented, active listings (listPublic), send a buyer request (sendEnquiry) and
//      add one line to the phone-test log (recordPhoneSession). They can read nothing else.
//    - Only signed-in coordinators can read or write private data (everything else).
//    Every function returns a Promise and throws an Error with a plain message on failure. */
// (function () {
//   var cfg = window.HL_CONFIG || {};
//   var SESSION_KEY = 'hl-coord-session';   /* sessionStorage: cleared when the tab closes */
//   var session = null;
//   try { session = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch (e) {}

//   function saveSession(s) {
//     session = s;
//     try { s ? sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)) : sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
//   }
//   function configured() { return !!(cfg.supabaseUrl && cfg.publishableKey); }
//   function signedIn() { return !!(session && session.access_token); }

//   function authHeaders(extra) {
//     /* The publishable key is NOT a login token: it goes in `apikey` only.
//        A signed-in coordinator adds their own token as Bearer. */
//     var h = { apikey: cfg.publishableKey, 'Content-Type': 'application/json' };
//     if (signedIn()) h.Authorization = 'Bearer ' + session.access_token;
//     if (extra) Object.keys(extra).forEach(function (k) { h[k] = extra[k]; });
//     return h;
//   }

//   function explain(status, body) {
//     var msg = body && (body.message || body.msg || body.error_description || body.error || body.hint);
//     if (status === 401 || status === 403) return 'Not allowed. Sign in as a coordinator and try again.' + (msg ? ' (' + msg + ')' : '');
//     if (status === 409) return 'That already exists (duplicate code).';
//     if (status === 400 || status === 422) return 'The database rejected this: ' + (msg || 'check the values.');
//     if (status === 404) return 'Table not found. Run schema.sql in Supabase first.';
//     return 'Request failed (' + status + ')' + (msg ? ': ' + msg : '');
//   }

//   function refresh() {
//     if (!session || !session.refresh_token) return Promise.reject(new Error('Session ended. Sign in again.'));
//     return fetch(cfg.supabaseUrl + '/auth/v1/token?grant_type=refresh_token', {
//       method: 'POST', headers: { apikey: cfg.publishableKey, 'Content-Type': 'application/json' },
//       body: JSON.stringify({ refresh_token: session.refresh_token })
//     }).then(function (r) { return r.json().then(function (b) { return { r: r, b: b }; }); })
//       .then(function (x) {
//         if (!x.r.ok || !x.b.access_token) { saveSession(null); throw new Error('Session ended. Sign in again.'); }
//         saveSession({ access_token: x.b.access_token, refresh_token: x.b.refresh_token, email: session.email });
//       });
//   }

//   function call(method, path, body, opts) {
//     opts = opts || {};
//     if (!configured()) return Promise.reject(new Error('Database is not configured (see config.js).'));
//     function go() {
//       var extra = {};
//       if (opts.returning) extra.Prefer = 'return=representation';
//       if (opts.upsert) extra.Prefer = 'resolution=merge-duplicates' + (opts.returning ? ',return=representation' : '');
//       return fetch(cfg.supabaseUrl + '/rest/v1/' + path, {
//         method: method, headers: authHeaders(extra), body: body === undefined ? undefined : JSON.stringify(body)
//       });
//     }
//     return go().then(function (r) {
//       if (r.status === 401 && signedIn()) {
//         return refresh().then(go);
//       }
//       return r;
//     }).then(function (r) {
//       if (r.status === 204) return [];
//       return r.text().then(function (t) {
//         var b = null; try { b = t ? JSON.parse(t) : null; } catch (e) {}
//         if (!r.ok) throw new Error(explain(r.status, b));
//         return b;
//       });
//     });
//   }

//   function clean(o) { /* drop empty strings so the database gets NULL instead of '' */
//     var out = {};
//     Object.keys(o).forEach(function (k) { var v = o[k]; if (v === '' || v === undefined) v = null; out[k] = v; });
//     return out;
//   }
//   function one(rows) { return Array.isArray(rows) ? rows[0] : rows; }
//   function nextCode(prefix, rows) {
//     var n = 0;
//     rows.forEach(function (r) { var m = new RegExp('^' + prefix + '(\\d+)$').exec(r.code || ''); if (m) n = Math.max(n, +m[1]); });
//     return prefix + (n + 1);
//   }

//   window.HL_STORE = {
//     configured: configured,
//     signedIn: signedIn,
//     email: function () { return session && session.email || ''; },

//     signIn: function (email, password) {
//       if (!configured()) return Promise.reject(new Error('Database is not configured (see config.js).'));
//       return fetch(cfg.supabaseUrl + '/auth/v1/token?grant_type=password', {
//         method: 'POST', headers: { apikey: cfg.publishableKey, 'Content-Type': 'application/json' },
//         body: JSON.stringify({ email: email, password: password })
//       }).then(function (r) { return r.json().then(function (b) { return { r: r, b: b }; }); })
//         .then(function (x) {
//           if (!x.r.ok || !x.b.access_token) throw new Error('Sign-in failed: wrong email or password.');
//           saveSession({ access_token: x.b.access_token, refresh_token: x.b.refresh_token, email: email });
//           /* Ask the database whether this account is a coordinator (the browser cannot fake this). */
//           return call('POST', 'rpc/is_coordinator', {}).then(function (ok) {
//             if (ok !== true) { saveSession(null); throw new Error('This account is not a coordinator.'); }
//             return true;
//           });
//         });
//     },
//     isCoordinator: function () { return call('POST', 'rpc/is_coordinator', {}).then(function (ok) { return ok === true; }); },
//     signOut: function () { saveSession(null); return Promise.resolve(); },

//     /* ---- public (no sign-in) ---- */
//     listPublic: function () {
//       return Promise.all([
//         call('GET', 'farmers?select=id,code,display_name,farm,town,region,since,bio&order=created_at.asc'),
//         call('GET', 'listings?select=id,farmer_id,variety,crates,price,ready,notes,status&status=eq.active&order=ready.asc')
//       ]).then(function (a) { return { farmers: a[0], listings: a[1] }; });
//     },
//     sendEnquiry: function (e) {
//       /* No "return" asked for: the public key may insert but may not read enquiries back.
//          The database refuses the row unless contact_consent is true and a phone number is present (schema-2.sql). */
//       return call('POST', 'enquiries', clean({
//         listing_id: e.listingId, buyer_name: e.buyerName, buyer_phone: e.buyerPhone, crates: e.crates,
//         intent: e.intent, message: e.message, contact_consent: e.consent === true
//       }));
//     },
//     recordPhoneSession: function (s) {
//       /* One line per attempt on the phone simulation. Insert only: the public key cannot read these back. */
//       var d = s.draft || {};
//       return call('POST', 'phone_sessions', clean({
//         farmer_code: s.farmerCode, channel: s.channel, duration_s: s.durationS, reached_post: !!s.reachedPost, completed: !!s.completed,
//         invalid_count: s.invalid, back_count: s.back, steps: s.steps,
//         variety: d.variety, crates: d.crates, price: d.price, ready: d.ready
//       }));
//     },

//     /* ---- coordinator ---- */
//     loadAll: function () {
//       var t = [['farmers', 'created_at.asc'], ['farmer_private', 'farmer_id.asc'], ['listings', 'created_at.asc'], ['buyers', 'created_at.asc'],
//                ['responses', 'created_at.asc'], ['follow_ups', 'created_at.asc'], ['enquiries', 'created_at.asc'], ['phone_sessions', 'created_at.asc']];
//       var needs2 = false;
//       return Promise.all(t.map(function (x) {
//         return call('GET', x[0] + '?select=*&order=' + x[1]).catch(function (err) {
//           /* schema-2.sql not run yet: keep the rest of the page working and say so */
//           if (x[0] === 'phone_sessions' && /not found|Table/.test(err.message)) { needs2 = true; return []; }
//           throw err;
//         });
//       })).then(function (r) { var o = {}; t.forEach(function (x, i) { o[x[0]] = r[i]; }); o.needsSchema2 = needs2; return o; });
//     },
//     setEnquiryHandled: function (id, handled) {
//       return call('PATCH', 'enquiries?id=eq.' + encodeURIComponent(id), { handled: !!handled }, { returning: true }).then(one);
//     },
//     setSessionNote: function (id, note) {
//       return call('PATCH', 'phone_sessions?id=eq.' + encodeURIComponent(id), clean({ note: note }), { returning: true }).then(one);
//     },
//     linkSessionListing: function (id, listingId) {
//       return call('PATCH', 'phone_sessions?id=eq.' + encodeURIComponent(id), { listing_id: listingId }, { returning: true }).then(one);
//     },
//     addFarmer: function (f, existing) {
//       var code = nextCode('F', existing);
//       return call('POST', 'farmers', clean({
//         code: code, display_name: f.displayName, farm: f.farm, town: f.town, region: f.region,
//         consent_given: !!f.consent, consent_note: f.consentNote
//       }), { returning: true }).then(function (rows) {
//         var farmer = one(rows);
//         return call('POST', 'farmer_private', clean({ farmer_id: farmer.id, full_name: f.fullName, phone: f.phone })).then(function () { return farmer; });
//       });
//     },
//     addListing: function (l) {
//       return call('POST', 'listings', clean({
//         farmer_id: l.farmerId, variety: l.variety, crates: +l.crates, price: +l.price, ready: l.ready,
//         notes: l.notes, posted_by: l.postedBy || 'coordinator'
//       }), { returning: true }).then(one);
//     },
//     setListingStatus: function (id, status) {
//       return call('PATCH', 'listings?id=eq.' + encodeURIComponent(id), { status: status }, { returning: true }).then(one);
//     },
//     addBuyer: function (b, existing) {
//       var code = nextCode('B', existing);
//       return call('POST', 'buyers', clean({
//         code: code, kind: b.kind, town: b.town, full_name: b.fullName, phone: b.phone,
//         consent_given: !!b.consent, consent_note: b.consentNote
//       }), { returning: true }).then(one);
//     },
//     addResponse: function (r) {
//       return call('POST', 'responses', clean({
//         listing_id: r.listingId, buyer_id: r.buyerId, answer: r.answer,
//         crates: r.crates ? +r.crates : null, price: r.price ? +r.price : null,
//         needed_on: r.neededOn, reason: r.reason
//       }), { returning: true }).then(one);
//     },
//     saveFollowUp: function (f) {
//       var row = clean({
//         listing_id: f.listingId, harvested_on: f.harvestedOn,
//         on_time: f.onTime === '' || f.onTime == null ? null : f.onTime === true || f.onTime === 'yes',
//         days_off: f.daysOff === '' || f.daysOff == null ? null : +f.daysOff,
//         sold_crates: f.sold === '' || f.sold == null ? null : +f.sold,
//         rejected_crates: f.rejected === '' || f.rejected == null ? null : +f.rejected,
//         cheap_crates: f.cheap === '' || f.cheap == null ? null : +f.cheap,
//         would_use_again: f.wouldUseAgain, change_wanted: f.changeWanted
//       });
//       return call('POST', 'follow_ups?on_conflict=listing_id', row, { upsert: true, returning: true }).then(one);
//     }
//   };
// })();
