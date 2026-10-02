// Service worker "kill switch": versões antigas do app instalaram um service worker que
// ficou servindo arquivos velhos do cache. Como o navegador só troca um worker por outro
// (apagar o sw.js só faz o update falhar), este arquivo substitui o antigo, limpa todos os
// caches, se desinstala e recarrega as abas abertas. Não intercepta nenhuma requisição.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
    await self.registration.unregister();
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach((c) => c.navigate(c.url));
  })());
});
