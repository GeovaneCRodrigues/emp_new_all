<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ErroAuth } from '@/api/auth'
import { CONTAS_DEMO, SENHA_DEMO } from '@/api/auth.fake'
import { modoDemo, useAuth } from '@/composables/useAuth'

const router = useRouter()
const route = useRoute()
const { entrar } = useAuth()

const email = ref(modoDemo ? CONTAS_DEMO[0].email : '')
const senha = ref(modoDemo ? SENHA_DEMO : '')
const erro = ref('')
const enviando = ref(false)

async function enviar() {
  if (enviando.value) return
  erro.value = ''
  enviando.value = true
  try {
    await entrar(email.value, senha.value)
    const volta = typeof route.query.volta === 'string' && route.query.volta.startsWith('/') && !route.query.volta.startsWith('//') ? route.query.volta : '/'
    await router.replace(volta)
  } catch (e) {
    erro.value = e instanceof ErroAuth ? e.message : 'Algo deu errado. Tente de novo.'
  } finally {
    enviando.value = false
  }
}
</script>

<template>
  <main class="login">
    <form class="card pad login-box" @submit.prevent="enviar">
      <div class="login-marca">
        <span class="logo"><svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="6" y="2.5" width="12" height="19" rx="3.2" stroke="#fff" stroke-width="2" /><circle cx="12" cy="12" r="3.6" stroke="#b8e35a" stroke-width="1.6" /></svg></span>
        <div><div class="disp" style="font-size: 18px; color: var(--strong)">Mundo dos iPhones</div><div class="small">Entre para continuar</div></div>
      </div>

      <div class="field"><label for="email">E-mail</label><div class="inp"><input id="email" v-model="email" type="email" autocomplete="username" required autofocus /></div></div>
      <div class="field"><label for="senha">Senha</label><div class="inp"><input id="senha" v-model="senha" type="password" autocomplete="current-password" required /></div></div>

      <div v-if="erro" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad)">{{ erro }}</div>
      <button class="btn b-pri b-block" type="submit" :disabled="enviando">{{ enviando ? 'Entrando…' : 'Entrar' }}</button>

      <div v-if="modoDemo" class="demo">
        <div class="small"><b>Modo demonstração</b> · senha <span class="mono">{{ SENHA_DEMO }}</span>. Escolha um perfil:</div>
        <div class="pills">
          <button v-for="c in CONTAS_DEMO" :key="c.id" type="button" class="pill" :class="{ on: email === c.email }" @click="email = c.email">{{ c.perfil.charAt(0) + c.perfil.slice(1).toLowerCase() }}</button>
        </div>
      </div>
    </form>
  </main>
</template>

<style scoped>
.login { min-height: 100%; display: grid; place-items: center; padding: 24px 16px; background: var(--bg); }
.login-box { width: 100%; max-width: 380px; display: flex; flex-direction: column; gap: 14px; padding: 22px; }
.login-marca { display: flex; align-items: center; gap: 12px; margin-bottom: 4px; }
.demo { display: flex; flex-direction: column; gap: 8px; padding-top: 12px; border-top: 1px dashed var(--border); }
</style>
