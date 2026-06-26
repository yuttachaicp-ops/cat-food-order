// Service worker — ทำให้ติดตั้งเป็นแอป (PWA) + โหลดไฟล์หน้าเว็บเร็วขึ้น
const CACHE = 'catfood-v1';
const ASSETS = ['/', '/index.html', '/admin.html', '/style.css', '/icon-192.png', '/icon-512.png', '/manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // ข้อมูล (API/webhook) ต้องดึงสดเสมอ ไม่แคช
  if (url.pathname.startsWith('/api/') || url.pathname === '/line/webhook') return;
  if (e.request.method !== 'GET') return;
  // ไฟล์หน้าเว็บ: เอาจากเน็ตก่อน ถ้าออฟไลน์ค่อยใช้แคช
  e.respondWith(
    fetch(e.request).then(r => {
      const copy = r.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return r;
    }).catch(() => caches.match(e.request))
  );
});
