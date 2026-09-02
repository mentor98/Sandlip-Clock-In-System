// Minimal offline-queue service worker.
// Caches the app shell and, when a clock-in/out POST fails due to no network,
// stores it in IndexedDB via the Background Sync API and replays it once
// connectivity returns.

const CACHE_NAME = 'oasis-clockin-v1';
const SHELL = ['/', 'index.html', 'style.css', 'app.js', 'manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Queue failed attendance POSTs for background sync.
  if (request.method === 'POST' && request.url.includes('/api/attendance/')) {
    event.respondWith(
      fetch(request.clone()).catch(async () => {
        const body = await request.clone().json();
        await queueRequest({ url: request.url, method: 'POST', headers: [...request.headers], body });
        if ('sync' in self.registration) {
          await self.registration.sync.register('oasis-attendance-sync');
        }
        return new Response(
          JSON.stringify({ queued: true, message: 'Saved offline — will sync automatically.' }),
          { status: 202, headers: { 'Content-Type': 'application/json' } }
        );
      })
    );
    return;
  }

  event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
});

self.addEventListener('sync', (event) => {
  if (event.tag === 'oasis-attendance-sync') event.waitUntil(flushQueue());
});

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('oasis-offline', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('queue', { autoIncrement: true });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function queueRequest(entry) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('queue', 'readwrite');
    tx.objectStore('queue').add(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function flushQueue() {
  const db = await openDB();
  const tx = db.transaction('queue', 'readwrite');
  const store = tx.objectStore('queue');
  const all = await new Promise((res) => {
    const items = [];
    store.openCursor().onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        items.push({ key: cursor.key, value: cursor.value });
        cursor.continue();
      } else res(items);
    };
  });

  for (const { key, value } of all) {
    try {
      await fetch(value.url, {
        method: value.method,
        headers: Object.fromEntries(value.headers),
        body: JSON.stringify(value.body),
      });
      store.delete(key);
    } catch {
      // still offline — leave it queued
    }
  }
}
