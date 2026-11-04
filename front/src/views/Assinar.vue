<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ErroApi } from '@/api/clientes'
import type { ContratoParaAssinarApi } from '@/api/contratos'
import { assinarApi, contratosApi } from '@/api/recursos'
import AssinaturaCampo from '@/components/AssinaturaCampo.vue'
import { mascaraCpf } from '@/domain/documentos'
import { dmyA } from '@/domain/format'

/** Página pública (sem login): o cliente lê o contrato, confirma o CPF, assina com o dedo e pronto. */
const route = useRoute()
const token = String(route.params.token ?? '')

const c = ref<ContratoParaAssinarApi | null>(null)
const carregando = ref(true)
const bloqueio = ref('')
const cpf = ref('')
const aceito = ref(false)
const tem = ref(false)
const erro = ref('')
const enviando = ref(false)
const feito = ref<{ numero: string } | null>(null)
const campo = ref<InstanceType<typeof AssinaturaCampo> | null>(null)
/** a logo da loja (se não tiver, a imagem falha e some) */
const logo = contratosApi.logoSrc()
const logoOk = ref(!!logo)

onMounted(async () => {
  // o endereço do link é segredo: não vai em cabeçalho de origem nem para buscadores
  for (const [name, content] of [['robots', 'noindex, nofollow'], ['referrer', 'no-referrer']]) {
    const m = document.createElement('meta'); m.name = name; m.content = content; document.head.appendChild(m)
  }
  try { c.value = await assinarApi.ver(token) } catch (e) { bloqueio.value = e instanceof ErroApi ? e.message : 'Não consegui abrir o contrato. Tente de novo.' } finally { carregando.value = false }
})

const cpfCompleto = computed(() => cpf.value.replace(/\D/g, '').length === 11)
const pronto = computed(() => cpfCompleto.value && aceito.value && tem.value && !enviando.value)

async function assinar() {
  if (!pronto.value || !campo.value) return
  enviando.value = true; erro.value = ''
  try {
    const r = await assinarApi.assinar(token, { cpf: cpf.value, aceito: aceito.value, assinatura: campo.value.exportar() })
    feito.value = { numero: r.numero }
  } catch (e) {
    const msg = e instanceof ErroApi ? e.message : 'Não consegui enviar. Tente de novo.'
    // link vencido, bloqueado ou já assinado: a tela vira o aviso; erro de CPF ou de assinatura continua no formulário
    if (e instanceof ErroApi && (e.status === 410 || e.status === 404)) bloqueio.value = msg
    else erro.value = msg
  } finally { enviando.value = false }
}
</script>

<template>
  <main class="assinar">
    <div class="assinar-box">
      <div class="login-marca">
        <img v-if="logoOk" class="logo-loja" :src="logo" alt="" data-testid="assinar-logo" @error="logoOk = false" />
        <span v-else class="logo"><svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="6" y="2.5" width="12" height="19" rx="3.2" stroke="#fff" stroke-width="2" /><circle cx="12" cy="12" r="3.6" stroke="#b8e35a" stroke-width="1.6" /></svg></span>
        <div><div class="disp" style="font-size: 18px; color: var(--strong)">{{ c?.empresa ?? 'Mundo dos iPhones' }}</div><div class="small">Assinatura do contrato</div></div>
      </div>

      <div v-if="carregando" class="card pad" data-testid="assinar-carregando">Carregando o contrato…</div>
      <div v-else-if="feito" class="card pad" role="status" data-testid="assinar-feito">
        <h2 style="margin: 0 0 6px">Contrato assinado ✔</h2>
        <p style="margin: 0">Obrigado! O contrato <b>{{ feito.numero }}</b> foi assinado e já está com a loja. Você pode fechar esta página.</p>
      </div>
      <div v-else-if="bloqueio" class="aviso" role="alert" data-testid="assinar-bloqueio" style="background: var(--bad-soft); color: var(--bad)">{{ bloqueio }}</div>
      <template v-else-if="c">
        <div class="card pad">
          <div class="small">Contrato {{ c.numero }} · {{ c.aparelho }}</div>
          <div class="val" style="font-size: 17px">{{ c.clienteNome }}</div>
          <div class="small">Leia o contrato abaixo. O link vale até {{ dmyA(c.expiraEm.slice(0, 10)) }}.</div>
        </div>
        <div class="papel" tabindex="0" data-testid="assinar-texto">{{ c.texto }}</div>

        <form class="card pad assinar-form" novalidate @submit.prevent="assinar">
          <div class="field">
            <label for="aCpf">Seu CPF (para confirmar que é você)</label>
            <div class="inp"><input id="aCpf" v-model="cpf" inputmode="numeric" autocomplete="off" placeholder="000.000.000-00" data-testid="assinar-cpf" @input="cpf = mascaraCpf(cpf)" /></div>
          </div>
          <div class="field"><label>Sua assinatura</label><AssinaturaCampo ref="campo" @mudou="tem = $event" /></div>
          <label class="row" style="gap: 10px; align-items: flex-start; font-size: 14px"><input v-model="aceito" type="checkbox" data-testid="assinar-aceito" style="margin-top: 3px" />Li o contrato e concordo com todos os termos.</label>
          <div v-if="erro" class="aviso" role="alert" data-testid="assinar-erro" style="background: var(--bad-soft); color: var(--bad)">{{ erro }}</div>
          <button class="btn b-pri b-block" type="submit" data-testid="assinar-enviar" :disabled="!pronto">{{ enviando ? 'Enviando…' : 'Assinar contrato' }}</button>
          <div class="small">Ao assinar, ficam registrados a data, o horário e o aparelho que você usou, como prova da assinatura eletrônica.</div>
        </form>
      </template>
    </div>
  </main>
</template>

<style scoped>
.assinar { min-height: 100%; padding: 20px 16px 40px; background: var(--bg); display: flex; justify-content: center; }
.assinar-box { width: 100%; max-width: 640px; display: flex; flex-direction: column; gap: 14px; }
.login-marca { display: flex; align-items: center; gap: 12px; }
.logo-loja { max-height: 44px; max-width: 120px; object-fit: contain; }
.assinar-form { display: flex; flex-direction: column; gap: 14px; }
.papel { max-height: 55dvh; }
</style>
