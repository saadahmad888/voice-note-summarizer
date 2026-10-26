// Voice Note Summarizer service worker — v{{VERSION}}
const SHELL = 'vns-shell-{{ASSET_V}}';
const SHELL_FILES = [
  '/app/',
  '/assets/css/base.css?v={{ASSET_V}}',
  '/assets/css/app.css?v={{ASSET_V}}',
  '/assets/js/config.js?v={{ASSET_V}}',
  '/assets/js/audio.js?v={{ASSET_V}}',
  '/assets/js/app.js?v={{ASSET_V}}',
  '/assets/vendor/capacitor.js?v={{ASSET_V}}',
  '/assets/fonts/bricolage.woff2',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('vns-shell-') && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;

  // A voice note shared to the installed web app (Android "Share" menu)
  if (e.request.method === 'POST' && url.pathname === '/share-target') {
    e.respondWith((async () => {
      try {
        const form = await e.request.formData();
        const files = form.getAll('audio').filter((f) => f && typeof f === 'object' && f.size);
        const cache = await caches.open('vns-shared');
        await Promise.all(files.map((f, i) => cache.put(`/__shared/${Date.now()}-${i}`,
          new Response(f, { headers: { 'content-type': f.type || 'audio/ogg', 'x-name': encodeURIComponent(f.name || 'Voice note') } }))));
        return Response.redirect(`/app/?shared=${files.length}`, 303);
      } catch {
        return Response.redirect('/app/', 303);
      }
    })());
    return;
  }

  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;

  // App page: network first, fall back to cache when offline
  if (e.request.mode === 'navigate' && url.pathname.startsWith('/app')) {
    e.respondWith(fetch(e.request).catch(() => caches.match('/app/')));
    return;
  }

  // Static assets: cache first
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(SHELL).then((c) => c.put(e.request, copy)); }
      return res;
    })));
  }
});
