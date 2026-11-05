<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ErroApi } from '@/api/clientes'
import type { EmpresaApi } from '@/api/contratos'
import { contratosApi } from '@/api/recursos'
import { useApp } from '@/composables/useApp'
import { mascaraFone } from '@/domain/documentos'
import { moneyBR, numBR } from '@/domain/format'
import { TAXAS_PADRAO_PF } from '@/domain/taxasPadrao'
import Icon from './Icon.vue'

/** Dados da empresa (cabeçalho do contrato, recibos), logo, Pix da loja e taxas do contrato. Só o administrador. */
const { sessao } = useApp()

type Form = { nome: string; cnpj: string; endereco: string; email: string; atendente: string; telefone: string; cidade: string; uf: string; pixChave: string; avaria: string; reposicao: string; cancelamentoPct: string; recuperacao: string }
const form = ref<Form | null>(null)
const temLogo = ref(false)
const versaoLogo = ref(Date.now())
const erro = ref('')
const msg = ref('')
const salvando = ref(false)
const logoErro = ref('')
const logoMsg = ref('')
const trocandoLogo = ref(false)

const dinheiroTxt = (v: number | null) => (v === null ? '' : moneyBR(v))
const pctTxt = (v: number | null) => (v === null ? '' : String(v).replace('.', ','))
const num = (t: string) => (t.trim() === '' ? null : numBR(t))

async function abrir() {
  erro.value = ''
  try {
    const e: EmpresaApi = await contratosApi.empresa(sessao.value)
    temLogo.value = e.temLogo
    form.value = {
      nome: e.nome, cnpj: e.cnpj ?? '', endereco: e.endereco ?? '', email: e.email ?? '', atendente: e.atendente ?? '', telefone: e.telefone ? mascaraFone(e.telefone) : '', cidade: e.cidade ?? '', uf: e.uf ?? '', pixChave: e.pixChave ?? '',
      avaria: dinheiroTxt(e.avaria), reposicao: dinheiroTxt(e.reposicao), cancelamentoPct: pctTxt(e.cancelamentoPct), recuperacao: dinheiroTxt(e.recuperacao),
    }
  } catch (e) { erro.value = e instanceof ErroApi ? e.message : 'Não consegui abrir os dados.' }
}
onMounted(abrir)

/** Preenche as taxas com o padrão de mercado para pessoa física; só vale depois de Salvar. */
function usarPadraoMercado() {
  if (!form.value) return
  const t = TAXAS_PADRAO_PF
  Object.assign(form.value, { avaria: dinheiroTxt(t.avaria), reposicao: dinheiroTxt(t.reposicao), cancelamentoPct: pctTxt(t.cancelamentoPct), recuperacao: dinheiroTxt(t.recuperacao) })
  msg.value = 'Padrão de mercado preenchido. Revise os valores e toque em Salvar.'
}

async function salvar() {
  if (!form.value) return
  const f = form.value
  salvando.value = true; erro.value = ''; msg.value = ''
  try {
    await contratosApi.salvarEmpresa(sessao.value, {
      nome: f.nome, cnpj: f.cnpj.trim() || null, endereco: f.endereco.trim() || null, email: f.email.trim() || null, atendente: f.atendente.trim() || null,
      telefone: f.telefone.trim() || null, cidade: f.cidade.trim() || null, uf: f.uf.trim() || null, pixChave: f.pixChave.trim() || null,
      avaria: num(f.avaria), reposicao: num(f.reposicao), cancelamentoPct: num(f.cancelamentoPct), recuperacao: num(f.recuperacao),
    })
    await abrir(); msg.value = 'Dados da empresa e taxas salvos'
  } catch (e) { erro.value = e instanceof ErroApi ? e.message : 'Não consegui salvar.' } finally { salvando.value = false }
}

const LIMITE = 280_000 // o servidor aceita até 300 KB
/** Lê a imagem, reduz para caber (logo não precisa de mais que isso) e devolve um data URL PNG (ou JPEG se o PNG ficar pesado). */
async function prepararLogo(arq: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(arq.type)) throw new Error('Use uma imagem PNG, JPEG ou WEBP.')
  if (arq.size > 8_000_000) throw new Error('A imagem é grande demais (máximo 8 MB).')
  const url = URL.createObjectURL(arq)
  try {
    const img = await new Promise<HTMLImageElement>((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('Não consegui abrir essa imagem.')); i.src = url })
    const escala = Math.min(1, 480 / Math.max(img.naturalWidth, img.naturalHeight))
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(img.naturalWidth * escala)); c.height = Math.max(1, Math.round(img.naturalHeight * escala))
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
    const tam = (d: string) => Math.floor((d.length - d.indexOf(',') - 1) * 0.75)
    let out = c.toDataURL('image/png')
    if (tam(out) > LIMITE) out = c.toDataURL('image/jpeg', 0.85)
    if (tam(out) > LIMITE) throw new Error('A imagem ficou pesada demais. Tente uma logo mais simples.')
    return out
  } finally { URL.revokeObjectURL(url) }
}
async function escolherLogo(ev: Event) {
  const el = ev.target as HTMLInputElement
  const arq = el.files?.[0]
  el.value = ''
  if (!arq) return
  trocandoLogo.value = true; logoErro.value = ''; logoMsg.value = ''
  try {
    const e = await contratosApi.salvarLogo(sessao.value, await prepararLogo(arq))
    temLogo.value = e.temLogo; versaoLogo.value = Date.now(); logoMsg.value = 'Logo salva'
  } catch (e) { logoErro.value = e instanceof Error ? e.message : 'Não consegui salvar a logo.' } finally { trocandoLogo.value = false }
}
async function removerLogo() {
  trocandoLogo.value = true; logoErro.value = ''; logoMsg.value = ''
  try { const e = await contratosApi.removerLogo(sessao.value); temLogo.value = e.temLogo; logoMsg.value = 'Logo removida' } catch (e) { logoErro.value = e instanceof ErroApi ? e.message : 'Não consegui remover.' } finally { trocandoLogo.value = false }
}
</script>

<template>
  <div v-if="erro && !form" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad)">{{ erro }}</div>
  <form v-if="form" style="display: flex; flex-direction: column; gap: 14px" data-testid="ct-empresa" @submit.prevent="salvar">
    <div class="card pad" style="display: flex; flex-direction: column; gap: 12px">
      <div><div class="val">Logo da empresa</div><div class="small">Aparece na página de assinatura do cliente e no contrato impresso. PNG, JPEG ou WEBP.</div></div>
      <div class="row" style="gap: 14px; align-items: center; flex-wrap: wrap">
        <div class="logo-prev" data-testid="logo-previa"><img v-if="temLogo" :src="contratosApi.logoSrc(versaoLogo)" alt="Logo da empresa" /><span v-else class="small">sem logo</span></div>
        <div style="display: flex; flex-direction: column; gap: 8px">
          <label class="btn b-out b-sm" :class="{ 'is-off': trocandoLogo }" style="cursor: pointer"><Icon name="plus" small />{{ temLogo ? 'Trocar logo' : 'Enviar logo' }}<input type="file" accept="image/png,image/jpeg,image/webp" hidden data-testid="logo-arquivo" :disabled="trocandoLogo" @change="escolherLogo" /></label>
          <button v-if="temLogo" class="btn b-ghost b-sm" type="button" :disabled="trocandoLogo" data-testid="logo-remover" @click="removerLogo">Remover logo</button>
        </div>
      </div>
      <div v-if="logoErro" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad)" data-testid="logo-erro">{{ logoErro }}</div>
      <div v-if="logoMsg" class="small" role="status" style="color: var(--ok)" data-testid="logo-msg">{{ logoMsg }}</div>
    </div>

    <div class="card pad" style="display: flex; flex-direction: column; gap: 12px">
      <div><div class="val">Dados da empresa</div><div class="small">Saem no cabeçalho de todo contrato e nos recibos.</div></div>
      <div class="duo">
        <div class="field"><label for="eNome">Razão social</label><div class="inp"><input id="eNome" v-model="form.nome" maxlength="120" /></div></div>
        <div class="field"><label for="eCnpj">CNPJ</label><div class="inp"><input id="eCnpj" v-model="form.cnpj" inputmode="numeric" maxlength="18" placeholder="00.000.000/0001-00" /></div></div>
        <div class="field"><label for="eEmail">E-mail</label><div class="inp"><input id="eEmail" v-model="form.email" type="email" maxlength="120" /></div></div>
        <div class="field"><label for="eTel">Telefone / WhatsApp</label><div class="inp"><input id="eTel" v-model="form.telefone" inputmode="tel" placeholder="(11) 3333-4444" @input="form.telefone = mascaraFone(form.telefone)" /></div></div>
        <div class="field"><label for="eAtend">Atendente que assina</label><div class="inp"><input id="eAtend" v-model="form.atendente" maxlength="80" /></div></div>
      </div>
      <div class="field"><label for="eEnd">Endereço</label><div class="inp"><input id="eEnd" v-model="form.endereco" maxlength="200" /></div></div>
      <div class="duo">
        <div class="field"><label for="eCidade">Cidade</label><div class="inp"><input id="eCidade" v-model="form.cidade" maxlength="100" /></div><div class="small">Vai na data e no foro do contrato.</div></div>
        <div class="field"><label for="eUf">UF</label><div class="inp"><input id="eUf" v-model="form.uf" maxlength="2" placeholder="SP" style="text-transform: uppercase" /></div></div>
      </div>
    </div>

    <div class="card pad" style="display: flex; flex-direction: column; gap: 12px">
      <div><div class="val">Pix da loja</div><div class="small">A chave que o cliente usa para pagar a loja (CNPJ, e-mail, telefone ou chave aleatória).</div></div>
      <div class="field"><label for="ePix">Chave Pix</label><div class="inp"><input id="ePix" v-model="form.pixChave" maxlength="77" autocomplete="off" data-testid="pix-chave" /></div></div>
    </div>

    <div class="card pad" style="display: flex; flex-direction: column; gap: 12px">
        <div><div class="val">Taxas do contrato</div><div class="small">Valem para os próximos contratos. Deixe em branco o que não se aplica: o contrato só sai com todos os campos preenchidos.</div></div>
        <button class="btn b-block" type="button" data-testid="taxas-padrao" @click="usarPadraoMercado">Usar padrão de mercado (pessoa física)</button>
        <div class="duo">
          <div class="field"><label for="tAvaria">Avaria do aparelho</label><div class="inp"><span>R$</span><input id="tAvaria" v-model="form.avaria" inputmode="decimal" /></div><div class="small">Cobrada se o aparelho voltar danificado.</div></div>
          <div class="field"><label for="tRepo">Reposição (perda, furto ou roubo)</label><div class="inp"><span>R$</span><input id="tRepo" v-model="form.reposicao" inputmode="decimal" /></div><div class="small">Valor para repor o aparelho.</div></div>
          <div class="field"><label for="tCanc">Multa de cancelamento</label><div class="inp"><input id="tCanc" v-model="form.cancelamentoPct" inputmode="decimal" /><span>%</span></div><div class="small">Sobre o saldo em aberto, se o cliente desistir.</div></div>
          <div class="field"><label for="tRecup">Recuperação por atraso</label><div class="inp"><span>R$</span><input id="tRecup" v-model="form.recuperacao" inputmode="decimal" /></div><div class="small">Quando é preciso ir buscar o aparelho.</div></div>
        </div>
      </div>
    <div v-if="erro" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad)" data-testid="ct-empresa-erro">{{ erro }}</div>
    <div v-if="msg" class="small" role="status" style="color: var(--ok)" data-testid="ct-empresa-msg">{{ msg }}</div>
    <button class="btn b-pri b-block" type="submit" :disabled="salvando || !form.nome.trim()" data-testid="ct-salvar-empresa"><Icon name="check" small />Salvar</button>
  </form>
</template>

<style scoped>
.logo-prev { width: 120px; height: 80px; border: 1.5px dashed var(--border); border-radius: 12px; display: grid; place-items: center; background: #fff; overflow: hidden; }
.logo-prev img { max-width: 100%; max-height: 100%; object-fit: contain; }
.is-off { opacity: 0.6; pointer-events: none; }
</style>
