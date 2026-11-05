import { createApp } from 'vue'
import App from './App.vue'
import { alturaDoApp } from './domain/alturaApp'
import { router } from './router'
import './styles/app.css'

createApp(App).use(router).mount('#app')

// App instalável (PWA): só na versão publicada. No desenvolvimento e na demonstração o service worker atrapalharia.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => undefined) })
}

// iPhone com o app instalado: a página fica ~60px mais curta que a tela (faixa embaixo do menu). Aqui o app recebe a altura real da tela.
function ajustarAltura() {
  const h = alturaDoApp({
    instalado: window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true,
    ios: /iphone|ipad|ipod/i.test(navigator.userAgent),
    emPe: window.matchMedia('(orientation: portrait)').matches,
    telaAltura: window.screen.height, janelaAltura: window.innerHeight,
  })
  if (h) document.documentElement.style.setProperty('--altura-tela', `${h}px`)
  else document.documentElement.style.removeProperty('--altura-tela')
}
ajustarAltura()
window.addEventListener('resize', ajustarAltura)
window.addEventListener('orientationchange', ajustarAltura)
