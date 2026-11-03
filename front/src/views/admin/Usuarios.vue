<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ErroApi } from '@/api/clientes'
import type { PessoaApi } from '@/api/equipe'
import type { IndicadorApi } from '@/api/indicadores'
import { equipeApi, indicadoresApi } from '@/api/recursos'
import Icon from '@/components/Icon.vue'
import Sheet from '@/components/Sheet.vue'
import { useApp } from '@/composables/useApp'
import { useToast } from '@/composables/useToast'
import { dmy, iniciais } from '@/domain/format'

/** Quem tem acesso ao sistema: cria usuários por nível, edita, redefine senha, liga e desliga, e escolhe os indicadores do cobrador. */
const { sessao } = useApp()
const { mostrar } = useToast()

const pessoas = ref<PessoaApi[]>([])
const indicadores = ref<IndicadorApi[]>([])
const carregando = ref(true)
const erro = ref('')
const ocupado = ref<string | null>(null)

const NOME_NIVEL = { ADMIN: 'Administrador', COBRADOR: 'Cobrador', VENDEDOR: 'Vendedor', INDICADOR: 'Indicador' } as const
const msg = (e: unknown, padrao: string) => (e instanceof ErroApi ? e.message : padrao)
const primeiroNome = (p: PessoaApi) => p.nome.split(' ')[0]

async function carregar() {
  erro.value = ''
  try { pessoas.value = await equipeApi.listar(sessao.value) } catch (e) { erro.value = msg(e, 'Não consegui carregar os usuários.') } finally { carregando.value = false }
}
onMounted(() => { carregar(); indicadoresApi.listar(sessao.value).then((l) => { indicadores.value = l }).catch(() => undefined) })

async function executar(chave: string, fn: () => Promise<unknown>, ok: string) {
  if (ocupado.value) return
  ocupado.value = chave
  try { await fn(); mostrar(ok) } catch (e) { mostrar(msg(e, 'Algo deu errado. Tente de novo.')) } finally { ocupado.value = null; await carregar() }
}
async function copiar(t: string) {
  try { await navigator.clipboard.writeText(t); mostrar('Copiado.') } catch { mostrar('Não consegui copiar. Selecione e copie à mão.') }
}

// ---- senha temporária: aparece uma vez, no criar e no redefinir ----
const senhaMostrada = ref<{ titulo: string; email: string; senhaTemporaria: string } | null>(null)

// ---- novo usuário ----
const criando = ref(false)
const novo = reactive({ nome: '', email: '', fone: '', perfil: 'COBRADOR' as 'ADMIN' | 'VENDEDOR' | 'COBRADOR', confirmarAdmin: false })
const erroNovo = ref('')
function abrirNovo() { Object.assign(novo, { nome: '', email: '', fone: '', perfil: 'COBRADOR', confirmarAdmin: false }); erroNovo.value = ''; criando.value = true }
async function criar() {
  if (ocupado.value) return
  ocupado.value = 'novo'; erroNovo.value = ''
  try {
    const r = await equipeApi.convidar(sessao.value, { nome: novo.nome, email: novo.email, perfil: novo.perfil, fone: novo.fone || null, ...(novo.perfil === 'ADMIN' ? { confirmarAdmin: novo.confirmarAdmin } : {}) })
    criando.value = false
    senhaMostrada.value = { titulo: 'Acesso criado', email: r.email, senhaTemporaria: r.senhaTemporaria }
    await carregar()
  } catch (e) { erroNovo.value = msg(e, 'Não consegui criar o usuário.') } finally { ocupado.value = null }
}

// ---- editar ----
const editando = ref<PessoaApi | null>(null)
const edicao = reactive({ nome: '', email: '', fone: '', perfil: 'COBRADOR' as 'VENDEDOR' | 'COBRADOR' })
const erroEdicao = ref('')
const podeTrocarNivel = computed(() => !!editando.value && (editando.value.perfil === 'VENDEDOR' || editando.value.perfil === 'COBRADOR') && editando.value.id !== sessao.value.usuarioId)
function abrirEditar(p: PessoaApi) {
  editando.value = p; erroEdicao.value = ''
  Object.assign(edicao, { nome: p.nome, email: p.email, fone: p.fone ?? '', perfil: p.perfil === 'VENDEDOR' ? 'VENDEDOR' : 'COBRADOR' })
}
async function salvarEdicao() {
  const p = editando.value
  if (!p || ocupado.value) return
  ocupado.value = 'edicao'; erroEdicao.value = ''
  try {
    await equipeApi.atualizar(sessao.value, p.id, {
      nome: edicao.nome, email: edicao.email, fone: edicao.fone || null,
      ...(podeTrocarNivel.value && edicao.perfil !== p.perfil ? { perfil: edicao.perfil } : {}),
    })
    editando.value = null
    mostrar(`${primeiroNome(p)} atualizado.`)
    await carregar()
  } catch (e) { erroEdicao.value = msg(e, 'Não consegui salvar.') } finally { ocupado.value = null }
}

// ---- redefinir senha ----
const redefinindo = ref<PessoaApi | null>(null)
async function confirmarRedefinir() {
  const p = redefinindo.value
  if (!p || ocupado.value) return
  ocupado.value = 'senha'
  try {
    const r = await equipeApi.redefinirSenha(sessao.value, p.id)
    redefinindo.value = null
    senhaMostrada.value = { titulo: `Nova senha de ${primeiroNome(p)}`, email: r.email, senhaTemporaria: r.senhaTemporaria }
    await carregar()
  } catch (e) { redefinindo.value = null; mostrar(msg(e, 'Não consegui redefinir a senha.')) } finally { ocupado.value = null }
}

// ---- ativar / desativar ----
const alternar = (p: PessoaApi) => executar(`p${p.id}`, () => equipeApi.atualizar(sessao.value, p.id, { ativo: !p.ativo }), p.ativo ? `${primeiroNome(p)} não entra mais.` : `${primeiroNome(p)} voltou a entrar.`)

// ---- quais indicadores o cobrador atende ----
const atendendo = ref<PessoaApi | null>(null)
const marcados = ref<number[]>([])
const nomesAtendidos = (p: PessoaApi) => (p.indicadorIds ?? []).map((i) => indicadores.value.find((x) => x.id === i)?.nome).filter(Boolean).join(', ')
function abrirAtende(p: PessoaApi) { atendendo.value = p; marcados.value = [...(p.indicadorIds ?? [])] }
const alternarMarca = (i: number) => { marcados.value = marcados.value.includes(i) ? marcados.value.filter((x) => x !== i) : [...marcados.value, i] }
async function salvarAtende() {
  const p = atendendo.value
  if (!p) return
  atendendo.value = null
  await executar(`i${p.id}`, () => equipeApi.atualizar(sessao.value, p.id, { indicadorIds: marcados.value }), marcados.value.length ? `${primeiroNome(p)} atende ${marcados.value.length === 1 ? '1 indicador' : `${marcados.value.length} indicadores`}.` : `${primeiroNome(p)} não atende nenhum indicador (não vê nada).`)
}

const acesso = (p: PessoaApi) => (p.ultimoAcesso ? `Último acesso ${dmy(p.ultimoAcesso.slice(0, 10))}` : 'Nunca entrou')
</script>

<template>
  <div v-if="erro" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad); justify-content: space-between"><span>{{ erro }}</span><button class="btn b-ghost b-sm" @click="carregar()">Tentar de novo</button></div>
  <div v-else-if="carregando" class="empty">Carregando…</div>

  <template v-else>
    <div class="row" style="justify-content: space-between"><h3 class="sec">Usuários · {{ pessoas.length }}</h3><button class="btn b-pri" data-testid="usuario-novo" @click="abrirNovo"><Icon name="plus" small />Novo usuário</button></div>
    <div class="small" style="margin: -4px 0 8px">Cada nível enxerga uma parte do sistema: o administrador vê tudo, o vendedor e o cobrador só o que é deles, e o indicador só as operações que indicou.</div>

    <section data-testid="usuarios">
      <div v-for="p in pessoas" :key="p.id" class="card pad item" :style="{ opacity: p.ativo ? 1 : 0.6 }" data-testid="usuario" :data-id="p.id">
        <div class="row" style="gap: 10px; align-items: flex-start">
          <span class="ini">{{ iniciais(p.nome) }}</span>
          <div style="flex: 1; min-width: 0">
            <div class="val">{{ p.nome }} <span class="chip c-neu" data-testid="usuario-nivel">{{ NOME_NIVEL[p.perfil] }}</span><span v-if="!p.ativo" class="chip c-bad">sem acesso</span><span v-if="p.bloqueado" class="chip c-bad" data-testid="usuario-bloqueado">conta travada</span><span v-if="p.senhaTemporaria" class="chip c-warn" data-testid="usuario-temporaria">senha temporária</span></div>
            <div class="small">{{ p.email }}<template v-if="p.fone"> · {{ p.fone }}</template></div>
            <div class="small">{{ acesso(p) }}</div>
            <div v-if="p.perfil === 'COBRADOR'" class="small" data-testid="atende">
              <template v-if="p.indicadorIds?.length">Atende: <b>{{ nomesAtendidos(p) }}</b></template>
              <span v-else style="color: var(--warn)">Não atende nenhum indicador: por enquanto ele não vê nenhuma cobrança.</span>
              <button type="button" class="btn b-ghost b-sm" style="margin-left: 6px" :disabled="!!ocupado" data-testid="atende-editar" @click="abrirAtende(p)">Escolher indicadores</button>
            </div>
            <div class="row" style="gap: 6px; flex-wrap: wrap; margin-top: 8px">
              <button v-if="p.perfil !== 'INDICADOR'" class="btn b-out b-sm" :disabled="!!ocupado" data-testid="usuario-editar" @click="abrirEditar(p)">Editar</button>
              <button v-if="p.id !== sessao.usuarioId" class="btn b-out b-sm" :disabled="!!ocupado" data-testid="usuario-senha" @click="redefinindo = p">Redefinir senha</button>
              <button v-if="p.id !== sessao.usuarioId" class="btn b-ghost b-sm" :disabled="!!ocupado" data-testid="usuario-ativo" @click="alternar(p)">{{ p.ativo ? 'Desativar' : 'Reativar' }}</button>
            </div>
          </div>
        </div>
      </div>
    </section>
  </template>

  <!-- novo usuário -->
  <Sheet :aberto="criando" @fechar="criando = false">
    <h3>Novo usuário</h3>
    <form style="display: flex; flex-direction: column; gap: 14px; margin-top: 12px" novalidate data-testid="usuario-form" @submit.prevent="criar">
      <div class="field"><label for="uNome">Nome</label><div class="inp maiusc"><input id="uNome" v-model="novo.nome" autocomplete="off" /></div></div>
      <div class="field"><label for="uEmail">E-mail (é o login)</label><div class="inp"><input id="uEmail" v-model="novo.email" type="email" autocomplete="off" /></div></div>
      <div class="field"><label for="uFone">Telefone (opcional)</label><div class="inp"><input id="uFone" v-model="novo.fone" inputmode="tel" placeholder="(11) 98812-4410" /></div></div>
      <div class="field">
        <label>Nível</label>
        <div class="pills" role="group" aria-label="Nível">
          <button type="button" class="pill" :class="{ on: novo.perfil === 'COBRADOR' }" data-nivel="COBRADOR" @click="novo.perfil = 'COBRADOR'">Cobrador</button>
          <button type="button" class="pill" :class="{ on: novo.perfil === 'VENDEDOR' }" data-nivel="VENDEDOR" @click="novo.perfil = 'VENDEDOR'">Vendedor</button>
          <button type="button" class="pill" :class="{ on: novo.perfil === 'ADMIN' }" data-nivel="ADMIN" @click="novo.perfil = 'ADMIN'">Administrador</button>
        </div>
        <div class="small">O indicador ganha o acesso em <b>Indicadores e repasses</b>.</div>
      </div>
      <label v-if="novo.perfil === 'ADMIN'" class="row" style="gap: 8px; cursor: pointer; align-items: flex-start" data-testid="usuario-confirma-admin">
        <input v-model="novo.confirmarAdmin" type="checkbox" style="margin-top: 3px" />
        <span class="small"><b>Acesso total.</b> Esta pessoa vai ver e mudar tudo: caixa, lucro, estoque, equipe e usuários. Só marque se tiver certeza.</span>
      </label>
      <div v-if="erroNovo" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad)">{{ erroNovo }}</div>
      <button class="btn b-pri b-block" type="submit" :disabled="ocupado === 'novo' || (novo.perfil === 'ADMIN' && !novo.confirmarAdmin)">{{ ocupado === 'novo' ? 'Criando…' : 'Criar acesso' }}</button>
    </form>
  </Sheet>

  <!-- editar -->
  <Sheet :aberto="editando !== null" @fechar="editando = null">
    <template v-if="editando">
      <h3>Editar {{ primeiroNome(editando) }}</h3>
      <form style="display: flex; flex-direction: column; gap: 14px; margin-top: 12px" novalidate data-testid="usuario-editar-form" @submit.prevent="salvarEdicao">
        <div class="field"><label for="eNome">Nome</label><div class="inp maiusc"><input id="eNome" v-model="edicao.nome" autocomplete="off" /></div></div>
        <div class="field"><label for="eEmail">E-mail (é o login)</label><div class="inp"><input id="eEmail" v-model="edicao.email" type="email" autocomplete="off" /></div></div>
        <div class="field"><label for="eFone">Telefone</label><div class="inp"><input id="eFone" v-model="edicao.fone" inputmode="tel" /></div></div>
        <div v-if="podeTrocarNivel" class="field">
          <label>Nível</label>
          <div class="pills" role="group" aria-label="Nível">
            <button type="button" class="pill" :class="{ on: edicao.perfil === 'COBRADOR' }" data-nivel="COBRADOR" @click="edicao.perfil = 'COBRADOR'">Cobrador</button>
            <button type="button" class="pill" :class="{ on: edicao.perfil === 'VENDEDOR' }" data-nivel="VENDEDOR" @click="edicao.perfil = 'VENDEDOR'">Vendedor</button>
          </div>
          <div v-if="edicao.perfil !== editando.perfil" class="small" style="color: var(--warn)">Ao trocar o nível, {{ primeiroNome(editando) }} sai do sistema e entra de novo com o menu novo.</div>
        </div>
        <div v-if="erroEdicao" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad)">{{ erroEdicao }}</div>
        <button class="btn b-pri b-block" type="submit" :disabled="ocupado === 'edicao'">{{ ocupado === 'edicao' ? 'Salvando…' : 'Salvar' }}</button>
      </form>
    </template>
  </Sheet>

  <!-- redefinir senha: confirma, depois mostra a nova uma vez -->
  <Sheet :aberto="redefinindo !== null" @fechar="redefinindo = null">
    <template v-if="redefinindo">
      <h3>Redefinir a senha de {{ primeiroNome(redefinindo) }}?</h3>
      <p class="small">Vai ser gerada uma senha temporária nova. A senha de agora deixa de valer, ele sai de onde estiver logado e troca a senha no próximo acesso. Se a conta estiver travada, ela destrava.</p>
      <div class="row" style="gap: 8px; margin-top: 14px"><button class="btn b-out" style="flex: 1" @click="redefinindo = null">Cancelar</button><button class="btn b-pri" style="flex: 1" :disabled="ocupado === 'senha'" data-testid="usuario-senha-confirmar" @click="confirmarRedefinir">Redefinir</button></div>
    </template>
  </Sheet>

  <Sheet :aberto="senhaMostrada !== null" @fechar="senhaMostrada = null">
    <template v-if="senhaMostrada">
      <h3>{{ senhaMostrada.titulo }}</h3>
      <p class="small">Passe estes dados para a pessoa. A senha só aparece agora; no primeiro acesso ela escolhe uma nova.</p>
      <div class="card pad" style="margin-top: 12px; background: var(--elevated)" data-testid="senha-temporaria">
        <div class="lbl">E-mail</div><div class="val">{{ senhaMostrada.email }}</div>
        <div class="lbl" style="margin-top: 8px">Senha temporária</div><div class="val mono">{{ senhaMostrada.senhaTemporaria }}</div>
      </div>
      <div class="row" style="gap: 8px; margin-top: 14px"><button class="btn b-out" style="flex: 1" @click="copiar(senhaMostrada.senhaTemporaria)">Copiar senha</button><button class="btn b-pri" style="flex: 1" @click="senhaMostrada = null">Pronto</button></div>
    </template>
  </Sheet>

  <!-- indicadores do cobrador -->
  <Sheet :aberto="atendendo !== null" @fechar="atendendo = null">
    <template v-if="atendendo">
      <h3>Indicadores de {{ primeiroNome(atendendo) }}</h3>
      <div class="small">Ele só vai ver as cobranças, os recibos e os clientes que vêm dos indicadores marcados. Sem nenhum marcado, não vê nada.</div>
      <form style="display: flex; flex-direction: column; gap: 4px; margin-top: 14px" data-testid="atende-form" @submit.prevent="salvarAtende">
        <label v-for="i in indicadores" :key="i.id" class="between" style="gap: 8px; padding: 8px 0; cursor: pointer" :data-indicador="i.id">
          <span>{{ i.nome }}<span v-if="!i.ativo" class="small"> (inativo)</span></span>
          <input type="checkbox" :checked="marcados.includes(i.id)" @change="alternarMarca(i.id)" />
        </label>
        <div v-if="!indicadores.length" class="small">Nenhum indicador cadastrado ainda.</div>
        <button class="btn b-pri b-block" type="submit" style="margin-top: 10px" data-testid="atende-salvar">Salvar</button>
      </form>
    </template>
  </Sheet>
</template>
