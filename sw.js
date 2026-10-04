// Service Worker — מאפשר לאפליקציה לעבוד בלי אינטרנט, ומוודא שהיא תמיד מתעדכנת.
// The site stamps VERSION when it copies the app in (scripts/sync-english.sh in the site repo):
const VERSION = 'escape-1';
const CACHE = 'english-' + VERSION;
const PAGE_TIMEOUT = 3500;   // ms to wait for the page before opening the saved copy (weak signal)

// The page is cached under './' only. Inside the personal site (Vercel, cleanUrls) './index.html' answers
// with a 308 redirect to './'; a cached *redirected* response can't be used to answer a navigation, so the
// offline fallback would fail there. './' is a plain 200 on both GitHub Pages and the site.
// words.js?v=<hash> is the word library (thousands of words + sentences, see tools/data.mjs). Its name
// changes with its content, so a cached copy never needs checking: it is precached here with the page.
const DATA = './words.js?v=31be1ea2ea';
const CORE = ['./', './manifest.json',
              './icon-192.png', './icon-512.png', './apple-touch-icon.png', DATA];

self.addEventListener('install', e => {
  // מוריד את הגרסה החדשה ומיד תופס פיקוד — בלי להמתין לסגירת האפליקציה
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  // מוחק רק מטמונים ישנים של האפליקציה הזו (english-*). The personal site's own service worker keeps its
  // caches (yonatan-*) on the same origin — they must not be touched.
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('english-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // The site's storage API (cloud sync) must always hit the server — never answer it from the cache.
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) return;

  // The site's events list ("words from life"): fresh from the network, the last copy when offline.
  if (url.origin === self.location.origin && url.pathname === '/events.json') {
    e.respondWith(
      fetch(req)
        .then(res => { if (res.ok) { const cp = res.clone(); caches.open(CACHE).then(c => c.put(req, cp)).catch(() => {}); } return res; })
        .catch(() => caches.match(req))
    );
    return;
  }

  // הדף עצמו: קודם מהרשת (כדי שתמיד תקבל את הגרסה העדכנית), ורק אם אין חיבור — מהמטמון.
  // With a weak signal the network can hang for a long time: when a saved copy exists and the network
  // hasn't answered within PAGE_TIMEOUT, the saved copy opens (the fresh one is still saved for next time).
  const isPage = req.mode === 'navigate' || req.destination === 'document' ||
                 url.pathname.endsWith('/index.html');
  if (isPage) {
    const net = fetch(req).then(res => {
      // Only cache a clean 200 page (not an error page or a redirect) as the offline copy
      if (res.ok && !res.redirected) { const cp = res.clone(); caches.open(CACHE).then(c => c.put('./', cp)).catch(() => {}); }
      return res;
    });
    e.respondWith(caches.match('./').then(saved => {
      if (!saved) return net.catch(() => caches.match('./'));
      let timer;
      const slow = new Promise(resolve => { timer = setTimeout(() => resolve(saved), PAGE_TIMEOUT); });
      return Promise.race([net.then(res => { clearTimeout(timer); return res; }, () => { clearTimeout(timer); return saved; }), slow]);
    }));
    e.waitUntil(net.then(() => {}, () => {}));
    return;
  }

  // The word library: its address carries its content hash, so the saved copy is always right — no refresh.
  if (url.origin === self.location.origin && /\/words\.js$/.test(url.pathname) && url.searchParams.has('v')) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok && !res.redirected) { const cp = res.clone(); caches.open(CACHE).then(c => c.put(req, cp)).catch(() => {}); }
      return res;
    })));
    return;
  }

  // כל השאר (אייקונים, פונטים): קודם מהמטמון, וברקע מרעננים
  e.respondWith(
    caches.match(req).then(hit => {
      const net = fetch(req).then(res => {
        if (res && (res.ok || res.type === 'opaque')) {
          const cp = res.clone();
          caches.open(CACHE).then(c => c.put(req, cp)).catch(() => {});
        }
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
