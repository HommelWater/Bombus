// Bombus P2P service worker — makes the app installable and loadable offline.
// Network-first: always prefer fresh code, fall back to cache when offline.
const CACHE = 'bombus-p2p-v1';

self.addEventListener('install', (e) => {
    self.skipWaiting();
});

self.addEventListener('activate', (e) => {
    e.waitUntil(clients.claim());
});

self.addEventListener('fetch', (e) => {
    const url = new URL(e.request.url);
    // Only handle same-origin GETs; let relay WebSockets and everything else
    // pass straight through.
    if (e.request.method !== 'GET' || url.origin !== location.origin) return;
    e.respondWith(
        fetch(e.request).then((res) => {
            if (res.ok) {
                const copy = res.clone();
                caches.open(CACHE).then((c) => c.put(e.request, copy));
            }
            return res;
        }).catch(() => caches.match(e.request))
    );
});
