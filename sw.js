// Service Worker — מאפשר לאפליקציה לעבוד בלי אינטרנט, ומוודא שהיא תמיד מתעדכנת.
// המחרוזת הבאה מוחלפת אוטומטית בכל העלאה ע"י deploy-english.sh:
const VERSION = '9fa22bc5';
const CACHE = 'english-' + VERSION;

const CORE = ['./', './index.html', './manifest.json',
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
        .then(res => { const cp = res.clone(); caches.open(CACHE).then(c => c.put('./index.html', cp)); return res; })
        .catch(() => caches.match('./index.html').then(r => r || caches.match('./')))
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
