// Service worker do Mundo dos iPhones. Só guarda o visual do app (telas, ícones, fontes) para abrir rápido e deixar
// o navegador oferecer "Instalar". Os DADOS (/api) nunca passam pelo cache: saldo, cobrança e caixa vêm sempre do servidor.
const VERSAO = 'v1'
const CACHE = `mundo-iphones-${VERSAO}`

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((chaves) => Promise.all(chaves.filter((c) => c !== CACHE).map((c) => caches.delete(c)))).then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return

  // as telas: sempre a versão nova da rede; sem internet, a última que abriu (o app mostra o erro de conexão sozinho)
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then((r) => { const c = r.clone(); caches.open(CACHE).then((x) => x.put('/', c)); return r }).catch(() => caches.match('/').then((r) => r ?? Response.error())),
    )
    return
  }

  // arquivos com hash no nome (/assets) e ícones não mudam: cache primeiro
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    e.respondWith(
      caches.match(req).then((hit) => hit ?? fetch(req).then((r) => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then((x) => x.put(req, c)) } return r })),
    )
  }
})

// Aviso push (chega com o app fechado e aparece na tela bloqueada). O servidor só manda título e um resumo curto.
self.addEventListener('push', (e) => {
  let d = {}
  try { d = e.data ? e.data.json() : {} } catch { d = { body: e.data ? e.data.text() : '' } }
  e.waitUntil(self.registration.showNotification(d.title || 'Mundo dos iPhones', {
    body: d.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: d.tag || undefined,
    data: { url: typeof d.url === 'string' && d.url.startsWith('/') ? d.url : '/' },
  }))
})

// Tocar no aviso abre o app na tela certa (reaproveita a janela que já estiver aberta).
self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const alvo = new URL(e.notification.data?.url || '/', self.location.origin).href
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((janelas) => {
    const aberta = janelas.find((j) => 'focus' in j)
    if (aberta) return aberta.navigate(alvo).then((c) => (c || aberta).focus())
    return self.clients.openWindow(alvo)
  }))
})
