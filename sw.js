/* ZHSE-A offline worker
   - Lets the board run offline (caches the app shell).
   - Serves an in-app / forced update after it is stored in the "zhse-update"
     cache under the key location.origin + "/__zhse_update__" (set by index.html).
   This is the web/PWA path; APK boards use the native ZHSE bridge instead and
   do not register this worker. */
var SHELL = 'zhse-shell-v1';
var ORIGIN = self.location.origin;
var UPKEY = ORIGIN + '/__zhse_update__';
var SCOPE = new URL(self.registration.scope).pathname;        // e.g. /ZHSE-alaz/
var DOC = SCOPE + 'index.html';

self.addEventListener('install', function (e) {
  self.skipWaiting();
  e.waitUntil(
    caches.open(SHELL).then(function (c) {
      return c.add(new Request(DOC, { cache: 'reload' })).catch(function () {});
    }).catch(function () {})
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil((async function () {
    try {
      var ks = await caches.keys();
      await Promise.all(ks.map(function (k) {
        if (k !== SHELL && k !== 'zhse-update' && k !== 'pdfjs-v1') return caches.delete(k);
      }));
    } catch (_) {}
    try { await self.clients.claim(); } catch (_) {}
  })());
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url;
  try { url = new URL(req.url); } catch (_) { return; }
  if (url.origin !== ORIGIN) return;                 // GeoGebra, fonts, ntfy, etc. -> network

  var isAppDoc = (url.pathname === SCOPE || url.pathname === DOC);

  // Other same-origin pages (adm/panel.html, send.html): network first, cache fallback.
  if (req.mode === 'navigate' && !isAppDoc) {
    e.respondWith(
      fetch(req).then(function (r) {
        try { caches.open(SHELL).then(function (c) { c.put(req, r.clone()); }); } catch (_) {}
        return r;
      }).catch(function () { return caches.match(req); })
    );
    return;
  }

  // The app document: a stored update wins; otherwise network-first, then cached shell.
  if (isAppDoc) {
    e.respondWith((async function () {
      try { var up = await caches.match(UPKEY); if (up) return up; } catch (_) {}
      try {
        var net = await fetch(new Request(DOC, { cache: 'no-store' }));
        if (net && net.ok) {
          try { var c = await caches.open(SHELL); c.put(DOC, net.clone()); } catch (_) {}
          return net;
        }
      } catch (_) {}
      var sh = await caches.match(DOC);
      return sh || new Response('<!doctype html><meta charset="utf-8"><title>Offline</title><body style="font:16px system-ui;padding:24px">Offline — reconnect once to load ZHSE-A.</body>', { headers: { 'content-type': 'text/html; charset=utf-8' } });
    })());
    return;
  }

  // version.json / admin.json and any ?query request must stay fresh -> network.
  if (url.pathname === SCOPE + 'version.json' || url.pathname === SCOPE + 'admin.json' || url.search) return;

  // Other static same-origin assets: cache-first, then network (and cache it).
  e.respondWith((async function () {
    var cached = await caches.match(req);
    if (cached) return cached;
    try {
      var net = await fetch(req);
      if (net && net.ok && net.type === 'basic') {
        try { var c = await caches.open(SHELL); c.put(req, net.clone()); } catch (_) {}
      }
      return net;
    } catch (_) { return cached || new Response('', { status: 504 }); }
  })());
});
