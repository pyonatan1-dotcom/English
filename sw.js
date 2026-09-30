// Service Worker — מאפשר לאפליקציה לעבוד בלי אינטרנט, ומוודא שהיא תמיד מתעדכנת.
// המחרוזת הבאה מוחלפת אוטומטית בכל העלאה ע"י deploy-english.sh:
const VERSION = 'one-address-1';
const CACHE = 'english-' + VERSION;

// The page is cached under './' only. Inside the personal site (Vercel, cleanUrls) './index.html' answers
// with a 308 redirect to './'; a cached *redirected* response can't be used to answer a navigation, so the
// offline fallback would fail there. './' is a plain 200 on both GitHub Pages and the Vercel proxy.
const CORE = ['./', './manifest.json',
              './icon-192.png', './icon-512.png', './apple-touch-icon.png'];

self.addEventListener('install', e => {
  // מוריד את הגרסה החדשה ומיד תופס פיקוד — בלי להמתין לסגירת האפליקציה
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  // מוחק כל מטמון של גרסה ישנה
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  // הדף עצמו: קודם מהרשת (כדי שתמיד תקבל את הגרסה העדכנית), ורק אם אין חיבור — מהמטמון
  const isPage = req.mode === 'navigate' || req.destination === 'document' ||
                 new URL(req.url).pathname.endsWith('/index.html');
  if (isPage) {
    e.respondWith(
      fetch(req)
        .then(res => {
          // Only cache a clean 200 page (not an error page or a redirect) as the offline copy
          if (res.ok && !res.redirected) { const cp = res.clone(); caches.open(CACHE).then(c => c.put('./', cp)).catch(() => {}); }
          return res;
        })
        .catch(() => caches.match('./'))
    );
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
