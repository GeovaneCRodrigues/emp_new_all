import { createRouter, createWebHistory } from 'vue-router'
import { useAuth } from '@/composables/useAuth'
import Login from './views/Login.vue'
import TrocarSenha from './views/TrocarSenha.vue'
import Pagina from './views/Pagina.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: Login, meta: { publica: true } },
    { path: '/trocar-senha', component: TrocarSenha },
    { path: '/:secao?', component: Pagina },
  ],
})

router.beforeEach(async (to) => {
  const { iniciar, logado, precisaTrocarSenha } = useAuth()
  await iniciar()
  if (!to.meta.publica && !logado.value) return { path: '/login', query: to.fullPath !== '/' ? { volta: to.fullPath } : {} }
  // senha temporária: não sai da tela de troca até trocar
  if (logado.value && precisaTrocarSenha.value && to.path !== '/trocar-senha') return '/trocar-senha'
  if (logado.value && !precisaTrocarSenha.value && to.path === '/trocar-senha') return '/'
  if (to.path === '/login' && logado.value) return precisaTrocarSenha.value ? '/trocar-senha' : '/'
})
