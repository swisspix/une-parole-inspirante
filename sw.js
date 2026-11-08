// Fait fonctionner le site hors ligne et affiche les notifications.

importScripts('citation.js');

const CACHE = 'parole-v1';
const SHELL = [
  './',
  'app.css',
  'app.js',
  'citation.js',
  'versets.json',
  'manifest.webmanifest',
  'fonts/barlow-500.woff2',
  'fonts/barlow-600.woff2',
  'fonts/barlow-700.woff2',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/badge-96.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

// Le réseau d'abord, pour que le site soit toujours à jour ; la dernière version connue sinon.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(caches.open(CACHE).then((cache) => cache.put(request, copy)));
        }
        return response;
      })
      .catch(async () => (await caches.match(request, { ignoreSearch: true })) ?? (request.mode === 'navigate' ? caches.match('./') : Response.error())),
  );
});

async function showLatest() {
  let title = 'Une parole inspirante';
  let options = { body: "Ta parole du jour t'attend." };
  try {
    const citation = await currentCitation();
    title = citation.reference;
    // Le navigateur exige une notification à chaque push : ce tag évite les doublons pour une même publication.
    options = { body: citation.text, tag: publicationId(citation) };
  } catch {
    // Lecture impossible : le texte de secours reste.
  }
  await self.registration.showNotification(title, { ...options, icon: 'icons/icon-192.png', badge: 'icons/badge-96.png' });
  const windows = await self.clients.matchAll({ type: 'window' });
  windows.forEach((client) => client.postMessage('citation'));
}

self.addEventListener('push', (event) => event.waitUntil(showLatest()));

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (windows[0]) return windows[0].focus();
    return self.clients.openWindow('./');
  })());
});
