import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'
import './styles/app.css'

createApp(App).use(router).mount('#app')

// App instalável (PWA): só na versão publicada. No desenvolvimento e na demonstração o service worker atrapalharia.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => undefined) })
}
