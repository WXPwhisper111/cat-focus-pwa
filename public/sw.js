// Development worker: always use the network so source changes stay visible.
// The production build replaces this file with the versioned precache worker.
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('cat-focus-dev-')).map(key => caches.delete(key))))
    .then(() => self.clients.claim())
));
