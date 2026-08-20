// service-worker.js
// Service worker MINIMAL untuk StockDental -- satu-satunya tujuannya
// memenuhi syarat "installability" Chrome (wajib ada service worker
// terdaftar + ada fetch handler). TIDAK melakukan caching atau mode
// offline apa pun -- semua request tetap diteruskan langsung ke network.
//
// Kalau nanti StockDental mau punya dukungan offline (misal: tetap
// bisa buka halaman terakhir walau sinyal hilang), logic caching bisa
// ditambahkan di dalam fetch handler di bawah -- tapi itu perubahan
// terpisah, di luar scope perbaikan ini.

self.addEventListener('install', function (event) {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', function (event) {
  event.respondWith(fetch(event.request));
});
