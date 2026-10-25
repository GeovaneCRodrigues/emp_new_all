import { addDia, diasEntre } from '@/domain/datas'
import type { Sessao } from '@/domain/escopo'
import { arred2 } from '@/domain/format'
import { todasAsPaginas } from './paginar'
import { ErroApi } from './clientes'
import type { CaixaApi, FiltroLadoCaixa } from './caixa'
import type { CaixaFechamentosApi, FechamentoLojaApi, PreviaFechamentoApi } from './caixaFechamentos'

const LADOS: FiltroLadoCaixa[] = ['EMPRESTIMO', 'IPHONE', 'SEM_LADO']
const LIMITE_ITENS = 300
const erro = (m: string) => new ErroApi(400, m)
const exigirAdmin = (s: Sessao) => { if (s.perfil !== 'ADMIN') throw new ErroApi(403, 'Só o administrador fecha o caixa da loja', 'SEM_PERMISSAO') }
const anterior = (ultimo: string) => new ErroApi(409, `O caixa já foi fechado até ${ultimo.split('-').reverse().join('/')}. Escolha esse dia ou um depois dele.`, 'DIA_ANTERIOR_AO_FECHADO')

/**
 * Versão de demonstração: as mesmas regras do backend. O resumo sai do próprio extrato do Caixa da demonstração.
 * Começa com um fechamento de alguns dias atrás, para a tela mostrar o alerta de "dias sem fechar".
 */
export function criarCaixaFechamentosFake(dep: { caixa: CaixaApi; hoje: string }): CaixaFechamentosApi {
  const { hoje } = dep
  let seq = 1
  const registros: FechamentoLojaApi[] = [{ id: seq++, dia: addDia(hoje, -3), obs: null, por: 'Administrador', criadoEm: `${addDia(hoje, -2)}T11:00:00.000Z` }]
  const ultimo = () => registros[registros.length - 1] ?? null

  function diaValido(v: unknown): string {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw erro('dia precisa ser AAAA-MM-DD')
    if (new Date(v + 'T12:00:00Z').toISOString().slice(0, 10) !== v) throw erro('dia inválido')
    if (v < '2000-01-01') throw erro('dia muito antigo')
    if (v > hoje) throw erro('Não dá para fechar um dia no futuro')
    return v
  }

  return {
    async listar(s) {
      exigirAdmin(s)
      const u = ultimo()
      return { hoje, ultimo: u ? { ...u } : null, diasSemFechar: u ? Math.max(diasEntre(u.dia, addDia(hoje, -1)), 0) : null, itens: [...registros].reverse().slice(0, 30).map((r) => ({ ...r })) }
    },

    async previa(s, dia): Promise<PreviaFechamentoApi> {
      exigirAdmin(s)
      const ate = diaValido(dia)
      const u = ultimo()
      if (u && ate < u.dia) throw anterior(u.dia)
      const de = u && u.dia < ate ? addDia(u.dia, 1) : ate
      const todos = await todasAsPaginas((p) => dep.caixa.ver(s, { pagina: p, limite: 100 }))
      const doPeriodo = todos.filter((m) => m.data >= de && m.data <= ate)
      const porLado = Object.fromEntries(LADOS.map((l) => {
        const xs = doPeriodo.filter((m) => (m.lado ?? 'SEM_LADO') === l)
        return [l, { entrou: arred2(xs.filter((m) => m.entrada).reduce((t, m) => t + m.valor, 0)), saiu: arred2(xs.filter((m) => !m.entrada).reduce((t, m) => t + m.valor, 0)) }]
      })) as PreviaFechamentoApi['porLado']
      const entrou = arred2(LADOS.reduce((t, l) => t + porLado[l].entrou, 0))
      const saiu = arred2(LADOS.reduce((t, l) => t + porLado[l].saiu, 0))
      return { de, ate, entrou, saiu, saldo: arred2(entrou - saiu), porLado, itens: doPeriodo.slice(0, LIMITE_ITENS), cortado: doPeriodo.length > LIMITE_ITENS }
    },

    async fechar(s, e) {
      exigirAdmin(s)
      const dia = diaValido(e.dia)
      if (e.obs !== undefined && typeof e.obs !== 'string') throw erro('obs precisa ser texto')
      const obs = e.obs?.trim() || null
      if (obs && obs.length > 200) throw erro('obs: no máximo 200 letras')
      const u = ultimo()
      if (u && dia < u.dia) throw anterior(u.dia)
      const f: FechamentoLojaApi = { id: seq++, dia, obs, por: 'Administrador', criadoEm: new Date().toISOString() }
      registros.push(f)
      return { ...f }
    },

    async desfazer(s, id) {
      exigirAdmin(s)
      const f = registros.find((r) => r.id === id)
      if (!f) throw new ErroApi(404, 'Fechamento não encontrado', 'NAO_ENCONTRADO')
      if (ultimo()?.id !== id) throw new ErroApi(409, 'Só o último fechamento se desfaz', 'NAO_E_O_ULTIMO')
      registros.pop()
    },
  }
}
