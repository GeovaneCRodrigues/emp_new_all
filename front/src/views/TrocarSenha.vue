<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { ErroAuth } from '@/api/auth'
import { useAuth } from '@/composables/useAuth'

const router = useRouter()
const { trocarSenha, sair } = useAuth()

const atual = ref('')
const nova = ref('')
const repete = ref('')
const erro = ref('')
const enviando = ref(false)

async function enviar() {
  erro.value = ''
  if (nova.value.length < 10) return void (erro.value = 'A nova senha precisa ter ao menos 10 caracteres')
  if (nova.value !== repete.value) return void (erro.value = 'As duas senhas novas não são iguais')
  if (nova.value === atual.value) return void (erro.value = 'A nova senha precisa ser diferente da atual')
  enviando.value = true
  try {
    await trocarSenha(atual.value, nova.value)
    await router.replace('/')
  } catch (e) {
    erro.value = e instanceof ErroAuth ? e.message : 'Algo deu errado. Tente de novo.'
  } finally {
    enviando.value = false
  }
}
async function cancelar() { await sair(); await router.replace('/login') }
</script>

<template>
  <main class="login">
    <form class="card pad login-box" novalidate @submit.prevent="enviar">
      <div>
        <div class="disp" style="font-size: 18px; color: var(--strong)">Crie sua senha</div>
        <div class="small">Você entrou com uma senha temporária. Escolha uma senha só sua para continuar.</div>
      </div>
      <div class="field"><label for="atual">Senha temporária</label><div class="inp"><input id="atual" v-model="atual" type="password" autocomplete="current-password" required /></div></div>
      <div class="field"><label for="nova">Nova senha</label><div class="inp"><input id="nova" v-model="nova" type="password" autocomplete="new-password" required minlength="10" /></div><span class="small">Ao menos 10 caracteres.</span></div>
      <div class="field"><label for="repete">Repita a nova senha</label><div class="inp"><input id="repete" v-model="repete" type="password" autocomplete="new-password" required /></div></div>
      <div v-if="erro" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad)">{{ erro }}</div>
      <button class="btn b-pri b-block" type="submit" :disabled="enviando">{{ enviando ? 'Salvando…' : 'Salvar nova senha' }}</button>
      <button class="btn b-ghost" type="button" @click="cancelar">Sair</button>
    </form>
  </main>
</template>

<style scoped>
.login { min-height: 100%; display: grid; place-items: center; padding: 24px 16px; background: var(--bg); }
.login-box { width: 100%; max-width: 380px; display: flex; flex-direction: column; gap: 14px; padding: 22px; }
</style>
