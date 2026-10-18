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
