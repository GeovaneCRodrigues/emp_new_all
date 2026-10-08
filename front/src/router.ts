import { createRouter, createWebHistory } from 'vue-router'
import { useAuth } from '@/composables/useAuth'
import Login from './views/Login.vue'
import Pagina from './views/Pagina.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: Login, meta: { publica: true } },
    { path: '/:secao?', component: Pagina },
  ],
})

router.beforeEach(async (to) => {
  const { iniciar, logado } = useAuth()
  await iniciar()
  if (!to.meta.publica && !logado.value) return { path: '/login', query: to.fullPath !== '/' ? { volta: to.fullPath } : {} }
  if (to.path === '/login' && logado.value) return '/'
})
