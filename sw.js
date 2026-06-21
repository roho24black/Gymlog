const CACHE = 'gymlog-v6';

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(c => {
      const scope = self.registration.scope;
      return fetch(scope, {cache: 'reload'})
        .then(r => { if (r.ok) return c.put(scope, r); })
        .catch(() => {});
    })
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;

  const isPage = url.pathname.endsWith('/') || url.pathname.endsWith('.html');

  if (isPage) {
    // Network-first: всегда свежий HTML, кэш только как fallback оффлайн
    e.respondWith(
      fetch(e.request)
        .then(r => {
          if (r.ok) caches.open(CACHE).then(c => c.put(e.request, r.clone()));
          return r;
        })
        .catch(() => caches.match(e.request).then(c => c || caches.match(self.registration.scope)))
    );
  } else {
    // Иконка, манифест — сначала кэш
    e.respondWith(
      caches.match(e.request).then(r => r ||
        fetch(e.request).then(res => {
          if (res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone()));
          return res;
        }).catch(() => new Response('', {status: 408}))
      )
    );
  }
});
