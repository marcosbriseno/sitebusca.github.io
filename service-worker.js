/* ═══════════════════════════════════════════════
   SERVICE WORKER — SupportBase PWA
   Estratégia:
   • App shell (html/css/js/ícones): network-first
     (sempre tenta baixar a versão nova; usa cache só offline)
   • Firebase / Google APIs: NUNCA intercepta
     (precisa de tempo real, não pode ser cacheado)
   ═══════════════════════════════════════════════ */

const CACHE_NAME = 'supportbase-v16';

// Arquivos essenciais para funcionar offline
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './firebase-config.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];

// Domínios que NUNCA devem passar pelo cache (tempo real)
const BYPASS = [
  'firebaseio.com',
  'firestore.googleapis.com',
  'googleapis.com',
  'gstatic.com',
  'firebaseapp.com',
  'identitytoolkit',
  'securetoken',
  'firebasestorage'
];

// Instala: pré-carrega o app shell
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

// Ativa: limpa caches antigos
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Intercepta requisições
self.addEventListener('fetch', event => {
  const url = event.request.url;

  // Não interceptar Firebase/Google (deixa passar direto pra rede)
  if (BYPASS.some(d => url.includes(d))) return;

  // Só lida com GET
  if (event.request.method !== 'GET') return;

  // Network-first: tenta a rede, cai pro cache se offline
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // guarda uma cópia atualizada no cache
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy).catch(() => {}));
        return response;
      })
      .catch(() =>
        caches.match(event.request).then(cached => cached || caches.match('./index.html'))
      )
  );
});
