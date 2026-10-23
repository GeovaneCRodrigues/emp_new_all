import type { Sessao } from '@/domain/escopo'
import { arred2 } from '@/domain/format'
import { ErroApi } from './clientes'
import type { ContaIndicadorApi, ContasIndicadorApi, EntradaEnvio, LinhaContaApi, SaldoIndicadorApi, TipoLinhaContaApi } from './contaIndicador'
import type { IndicadoresApi } from './indicadores'

export type ContaIndicadorFake = ContasIndicadorApi & {
  _interno: {
    /** o dinheiro de um cliente ficou na conta do indicador (baixa confirmada com a marca) */
    cobrou(indicadorId: number, l: { data: string; valor: number; titulo: string; sub: string }): void
    /** um empréstimo foi pago com o dinheiro da conta do indicador */
    emprestou(indicadorId: number, l: { data: string; valor: number; titulo: string }): void
  }
}

type Reg = LinhaContaApi & { ind: number }

const dataValida = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(v + 'T12:00:00Z').toISOString().slice(0, 10) === v
const erro = (m: string) => new ErroApi(400, m)

export function criarContaIndicadorFake(dep: { indicadores: IndicadoresApi; hoje: () => string }): ContaIndicadorFake {
  let seq = 0
  const regs: Reg[] = []
  const adicionar = (ind: number, tipo: TipoLinhaContaApi, l: { data: string; valor: number; titulo: string; sub: string }) => {
    regs.push({ chave: `${tipo[0]}${++seq}`, ind, tipo, data: l.data, valor: arred2(l.valor), titulo: l.titulo, sub: l.sub })
  }
  // demonstração: o indicador 1 cobrou de um cliente e já enviou uma parte para a loja
  const mesAnterior = `${dep.hoje().slice(0, 7)}-05`
  adicionar(1, 'COBROU', { data: mesAnterior, valor: 1200, titulo: 'Carlos Henrique', sub: 'parcela 1/4' })
  adicionar(1, 'ENVIOU', { data: dep.hoje(), valor: 400, titulo: 'Enviou para a loja', sub: 'transferência' })

  const resumo = (ind: number) => {
    const soma = (t: TipoLinhaContaApi) => arred2(regs.filter((r) => r.ind === ind && r.tipo === t).reduce((s, r) => s + r.valor, 0))
    const cobrou = soma('COBROU'), enviou = soma('ENVIOU'), emprestou = soma('EMPRESTIMO')
    return { cobrou, enviou, emprestou, saldo: arred2(cobrou - enviou - emprestou) }
  }
  async function indicador(s: Sessao, id: number) {
    const i = (await dep.indicadores.listar({ perfil: 'ADMIN', usuarioId: 1 })).find((x) => x.id === id)
    if (!i) throw new ErroApi(404, 'Indicador não encontrado', 'NAO_ENCONTRADO')
    return i
  }
  async function montar(s: Sessao, id: number, pagina: number, limite: number): Promise<ContaIndicadorApi> {
    const i = await indicador(s, id)
    const dele = regs.filter((r) => r.ind === id).sort((a, b) => b.data.localeCompare(a.data) || b.chave.localeCompare(a.chave))
    const itens = dele.slice((pagina - 1) * limite, pagina * limite).map(({ ind: _ind, ...l }) => l)
    return { indicador: { id: i.id, nome: i.nome }, ...resumo(id), itens, total: dele.length, pagina, limite }
  }

  return {
    async saldos(s) {
      if (s.perfil !== 'ADMIN') throw new ErroApi(403, 'Só o administrador vê as contas dos indicadores', 'SEM_PERMISSAO')
      const lista = await dep.indicadores.listar(s)
      return lista.map((i): SaldoIndicadorApi => ({ indicador: { id: i.id, nome: i.nome, ativo: i.ativo }, saldo: resumo(i.id).saldo }))
    },
    async ver(s, id, q) {
      if (s.perfil === 'INDICADOR') {
        if (s.indicadorId !== id) throw new ErroApi(404, 'Indicador não encontrado', 'NAO_ENCONTRADO')
      } else if (s.perfil !== 'ADMIN') throw new ErroApi(403, 'Você não tem acesso à conta do indicador', 'SEM_PERMISSAO')
      return montar(s, id, Math.max(Math.trunc(q?.pagina ?? 1) || 1, 1), Math.min(Math.max(Math.trunc(q?.limite ?? 50) || 50, 1), 100))
    },
    async lancarEnvio(s, id, e: EntradaEnvio) {
      if (s.perfil !== 'ADMIN') throw new ErroApi(403, 'Só o administrador lança o envio do indicador', 'SEM_PERMISSAO')
      await indicador(s, id)
      if (typeof e.valor !== 'number' || !Number.isFinite(e.valor) || e.valor <= 0 || e.valor > 1e8) throw erro('Informe quanto o indicador enviou (maior que zero)')
      const hoje = dep.hoje()
      const data = e.data ?? hoje
      if (!dataValida(data)) throw erro('data precisa ser uma data válida (AAAA-MM-DD)')
      if (data > hoje) throw erro('A data do envio não pode ser no futuro')
      if (e.comprovante !== undefined && e.comprovante !== '' && (typeof e.comprovante !== 'string' || e.comprovante.trim().length > 120)) throw erro('comprovante: no máximo 120 letras')
      if (e.lado !== undefined && e.lado !== 'EMPRESTIMO' && e.lado !== 'IPHONE') throw erro('lado deve ser EMPRESTIMO ou IPHONE')
      adicionar(id, 'ENVIOU', { data, valor: e.valor, titulo: 'Enviou para a loja', sub: e.comprovante?.trim() || 'transferência' })
      return montar(s, id, 1, 50)
    },
    _interno: {
      cobrou: (ind, l) => adicionar(ind, 'COBROU', l),
      emprestou: (ind, l) => adicionar(ind, 'EMPRESTIMO', { ...l, sub: 'saiu da conta dele' }),
    },
  }
}
