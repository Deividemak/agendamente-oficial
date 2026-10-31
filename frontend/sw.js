const CACHE_NAME = 'agendamente-cache-v2';
const ASSETS_TO_CACHE = [
  '/',
  '/admin-login',
  '/css/style.css',
  '/app_logo.png',
  '/manifest.json'
];

// Instalação do Service Worker
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Caching arquivos estáticos...');
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

// Ativação do Service Worker e limpeza de caches antigos
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('[Service Worker] Deletando cache antigo:', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Intercepta requisições de rede
self.addEventListener('fetch', (event) => {
  // Ignora rotas que não sejam GET, sejam da API, ou sejam de arquivos de mídia grandes (que necessitam de suporte a Range Requests)
  if (
    event.request.url.includes('/api/') || 
    event.request.url.endsWith('.mp4') ||
    event.request.url.endsWith('.mp3') ||
    !event.request.url.startsWith(self.location.origin) ||
    event.request.method !== 'GET'
  ) {
    return;
  }

  // ESTRATÉGIA NETWORK-FIRST PARA NAVEGAÇÕES (PÁGINAS HTML)
  const acceptHeader = event.request.headers.get('accept');
  if (event.request.mode === 'navigate' || (acceptHeader && acceptHeader.includes('text/html'))) {
    event.respondWith(
      fetch(event.request).then((response) => {
        if (response && response.status === 200) {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return response;
      }).catch(() => {
        // Se estiver offline, serve a página do cache
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          // Fallback se não encontrar a página específica no cache
          return caches.match('/admin-login');
        });
      })
    );
    return;
  }

  // ESTRATÉGIA CACHE-FIRST PARA ATIVOS ESTÁTICOS (CSS, IMAGENS, MANIFEST)
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return response;
      });
    })
  );
});
