import { computed, ref, shallowRef, watch } from 'vue'
import { criarApiFalsa } from '@/api/fake'
import { modoDemo } from '@/composables/useAuth'
import type { Api } from '@/api'
import { contasOp, investido } from '@/domain/calc'
import type { Contas } from '@/domain/calc'
import type { Dados } from '@/domain/dados'
import { permissoes } from '@/domain/escopo'
import type { Sessao } from '@/domain/escopo'
import type { Bem, Cliente, Operacao, Parcela } from '@/domain/types'

const CHAVE = 'mdi:sessao'

function lerSessao(): Sessao {
  try {
    const s = JSON.parse(localStorage.getItem(CHAVE) ?? 'null')
    if (s?.perfil) return s
  } catch { /* sem storage: usa o padrão */ }
  return { perfil: 'ADMIN', usuarioId: 1 }
}

/** Quem está "logado" em cada perfil, nos dados de exemplo. */
export const SESSOES: Record<Sessao['perfil'], Sessao> = {
  ADMIN: { perfil: 'ADMIN', usuarioId: 1 },
  INDICADOR: { perfil: 'INDICADOR', indicadorId: 1 },
  COBRADOR: { perfil: 'COBRADOR', usuarioId: 3 },
  VENDEDOR: { perfil: 'VENDEDOR', usuarioId: 2 },
}

let api: Api = criarApiFalsa()
/** Troca a implementação da API (ex.: a real, no lugar da falsa). */
export function usarApi(a: Api) { api = a; carregar() }

const sessao = ref<Sessao>(lerSessao())

/** Define quem está usando (vem do login). */
export function definirSessao(s: Sessao) { sessao.value = s }
const dados = shallowRef<Dados | null>(null)

async function carregar() {
  dados.value = await api.carregar(sessao.value)
}

watch(sessao, (s) => {
  try { localStorage.setItem(CHAVE, JSON.stringify(s)) } catch { /* ignora */ }
  carregar()
}, { deep: true })
carregar()

export interface ItemCobranca {
  op: Operacao
  p: Parcela
  /** nome do que foi vendido/emprestado */
  item: string
  c: Cliente
}

export const NOME_MOD = { PARCELADO: 'Empréstimo', JUROS: 'Empréstimo só juros', DIARIA: 'Diária' } as const

export function useApp() {
  const d = computed(() => dados.value)
  const pronto = computed(() => dados.value !== null)
  // na demonstração o dia é fixo (bate com os dados de exemplo); fora dela, é o dia de hoje de verdade
  const hoje = computed(() => (modoDemo ? dados.value?.hoje : null) ?? new Date().toISOString().slice(0, 10))
  const pode = computed(() => permissoes(sessao.value.perfil))

  const bens = computed(() => new Map((dados.value?.bens ?? []).map((b) => [b.id, b])))
  const clientes = computed(() => new Map((dados.value?.clientes ?? []).map((c) => [c.id, c])))
  const operacoes = computed<Operacao[]>(() => [...(dados.value?.vendas ?? []), ...(dados.value?.emprestimos ?? [])])

  const contas = (o: Operacao): Contas => contasOp(o, bens.value, hoje.value)
  const bemDe = (id: number): Bem => bens.value.get(id)!
  const clienteDe = (id: number): Cliente => clientes.value.get(id)!
  const nomeItem = (o: Operacao) => (o.tipo === 'EMP' ? NOME_MOD[o.mod] : bemDe(o.bemId).modelo)
  const investidoBem = investido

  const cobrancas = computed<ItemCobranca[]>(() =>
    operacoes.value
      .filter((o) => o.status !== 'RETOMADA')
      .flatMap((o) => o.parcelas.map((p) => ({ op: o, p, item: nomeItem(o), c: clienteDe(o.clienteId) }))),
  )

  return { sessao, d, pronto, hoje, pode, bens, clientes, operacoes, contas, bemDe, clienteDe, nomeItem, investidoBem, cobrancas }
}
