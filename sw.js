const CACHE = 'gymlog-v5';

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
    // Stale-while-revalidate: сразу из кэша + обновляем в фоне
    e.respondWith(
      caches.open(CACHE).then(c =>
        c.match(e.request).then(cached => {
          const networkFetch = fetch(e.request)
            .then(r => {
              if (r.ok) c.put(e.request, r.clone());
              return r;
            })
            .catch(() => cached || c.match(self.registration.scope));
          // Если есть кэш — отдаём сразу, обновляем фоном
          return cached ? (networkFetch.catch(() => {}), cached) : networkFetch;
        })
      )
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
