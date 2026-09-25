'use strict';
const CACHE = 'husband-salary-notebook-v1';
const CORE = ['./','./index.html','./style.css','./app.js','./parser.js','./manifest.webmanifest','./assets/mascot.svg','./assets/apple-touch-icon.png','./assets/icon-192.png','./assets/icon-512.png','./vendor/tesseract.min.js'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(CORE)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('husband-salary-notebook-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url), scope = new URL(self.registration.scope);
  if (event.request.method !== 'GET' || url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  const relative = url.pathname.slice(scope.pathname.length);
  const isVendor = relative.startsWith('vendor/');
  event.respondWith((async () => {
    const cache = await caches.open(CACHE), cached = await cache.match(event.request);
    if (cached && isVendor) return cached;
    try {
      const response = await fetch(event.request);
      if (response.ok && (isVendor || CORE.some(path => new URL(path, scope).pathname === url.pathname))) await cache.put(event.request, response.clone());
      if (isVendor && relative.endsWith('.traineddata.gz')) { const clients = await self.clients.matchAll(); clients.forEach(client => client.postMessage('ocr-cached')); }
      return response;
    } catch(error) {
      if (cached) return cached;
      if (event.request.mode === 'navigate') return await cache.match(new URL('./index.html', scope));
      throw error;
    }
  })());
});
