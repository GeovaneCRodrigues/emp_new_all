import type { Sessao } from '@/domain/escopo'
import { arred2 } from '@/domain/format'
import { nomeEmprestimo } from '@/domain/emprestimo'
import { ErroApi } from './clientes'
import type { ContaIndicadorApi, ContasIndicadorApi, EntradaEnvio, LinhaContaApi, SaldoIndicadorApi, TipoLinhaContaApi } from './contaIndicador'
import type { RegistroEmprestimo } from './emprestimos.fake'
import type { IndicadoresApi } from './indicadores'
import type { Transacao } from './vendas.fake'

export type ContaIndicadorFake = ContasIndicadorApi & {
  _interno: {
    /** os envios lançados (o Caixa da demonstração os conta como entrada, igual ao back) */
    envios(): Promise<{ id: number; indicadorId: number; nome: string; data: string; valor: number; lado: 'EMPRESTIMO' | 'IPHONE' | null }[]>
  }
}

/** Lançamento guardado aqui: os envios e o saldo de abertura da demonstração. O resto vem das transações e dos empréstimos, como no back. */
type Reg = LinhaContaApi & { ind: number; lado?: 'EMPRESTIMO' | 'IPHONE' | null }

const dataValida = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(v + 'T12:00:00Z').toISOString().slice(0, 10) === v
const erro = (m: string) => new ErroApi(400, m)

export function criarContaIndicadorFake(dep: { indicadores: IndicadoresApi; hoje: () => string; transacoes: () => Transacao[]; emprestimos: () => RegistroEmprestimo[] }): ContaIndicadorFake {
  let seq = 0
  const proprios: Reg[] = []
  // demonstração: o indicador 1 já cobrou de um cliente e já enviou uma parte para a loja
  proprios.push({ chave: `C0`, ind: 1, tipo: 'COBROU', data: `${dep.hoje().slice(0, 7)}-05`, valor: 1200, titulo: 'Carlos Henrique', sub: 'parcela 1/4' })
  proprios.push({ chave: `T${++seq}`, ind: 1, tipo: 'ENVIOU', data: dep.hoje(), valor: 400, titulo: 'Enviou para a loja', sub: 'transferência', lado: 'EMPRESTIMO' })

  /** Todos os lançamentos de todos os indicadores: o que ficou com eles (transações marcadas), o que enviaram e os empréstimos pagos com a conta deles. */
  function todos(): Reg[] {
    const hoje = dep.hoje()
    const cobrados: Reg[] = dep.transacoes()
      .filter((t) => t.cobradoPorIndicadorId !== undefined && !t.desfeita && t.data <= hoje)
      .map((t) => ({ chave: `C${t.id}`, ind: t.cobradoPorIndicadorId!, tipo: 'COBROU', data: t.data, valor: t.valor, titulo: t.clienteNome, sub: t.resumo?.referencia ?? 'recebimento' }))
    const emprestados: Reg[] = dep.emprestimos()
      .filter((r) => r.saiuDaConta && r.status !== 'CANCELADA' && r.dataEmprestimo <= hoje)
      .map((r) => ({ chave: `E${r.id}`, ind: r.saiuDaConta!.indicadorId, tipo: 'EMPRESTIMO', data: r.dataEmprestimo, valor: r.saiuDaConta!.valor, titulo: `Empréstimo · ${r.cliente.nome}`, sub: nomeEmprestimo(r.modalidade, r.periodicidade) }))
    return [...proprios.filter((r) => r.data <= hoje), ...cobrados, ...emprestados]
  }
  const resumo = (ind: number) => {
    const meus = todos().filter((r) => r.ind === ind)
    const soma = (t: TipoLinhaContaApi) => arred2(meus.filter((r) => r.tipo === t).reduce((s, r) => s + r.valor, 0))
    const cobrou = soma('COBROU'), enviou = soma('ENVIOU'), emprestou = soma('EMPRESTIMO')
    return { cobrou, enviou, emprestou, saldo: arred2(cobrou - enviou - emprestou) }
  }
  async function indicador(id: number) {
    const i = (await dep.indicadores.listar({ perfil: 'ADMIN', usuarioId: 1 })).find((x) => x.id === id)
    if (!i) throw new ErroApi(404, 'Indicador não encontrado', 'NAO_ENCONTRADO')
    return i
  }
  async function montar(id: number, pagina: number, limite: number): Promise<ContaIndicadorApi> {
    const i = await indicador(id)
    const dele = todos().filter((r) => r.ind === id).sort((a, b) => b.data.localeCompare(a.data) || b.chave.localeCompare(a.chave))
    const itens = dele.slice((pagina - 1) * limite, pagina * limite).map(({ ind: _ind, lado: _lado, ...l }) => l)
    return { indicador: { id: i.id, nome: i.nome }, ...resumo(id), itens, total: dele.length, pagina, limite }
  }

  return {
    async saldos(s) {
      if (s.perfil !== 'ADMIN') throw new ErroApi(403, 'Só o administrador vê as contas dos indicadores', 'SEM_PERMISSAO')
      const lista = await dep.indicadores.listar(s)
      return lista.map((i): SaldoIndicadorApi => ({ indicador: { id: i.id, nome: i.nome, ativo: i.ativo }, saldo: resumo(i.id).saldo }))
    },
    async ver(s: Sessao, id, q) {
      if (s.perfil === 'INDICADOR') {
        if (s.indicadorId !== id) throw new ErroApi(404, 'Indicador não encontrado', 'NAO_ENCONTRADO')
      } else if (s.perfil !== 'ADMIN') throw new ErroApi(403, 'Você não tem acesso à conta do indicador', 'SEM_PERMISSAO')
      return montar(id, Math.max(Math.trunc(q?.pagina ?? 1) || 1, 1), Math.min(Math.max(Math.trunc(q?.limite ?? 50) || 50, 1), 100))
    },
    async lancarEnvio(s, id, e: EntradaEnvio) {
      if (s.perfil !== 'ADMIN') throw new ErroApi(403, 'Só o administrador lança o envio do indicador', 'SEM_PERMISSAO')
      await indicador(id)
      if (typeof e.valor !== 'number' || !Number.isFinite(e.valor) || e.valor <= 0 || e.valor > 1e8) throw erro('Informe quanto o indicador enviou (maior que zero)')
      const hoje = dep.hoje()
      const data = e.data ?? hoje
      if (!dataValida(data)) throw erro('data precisa ser uma data válida (AAAA-MM-DD)')
      if (data > hoje) throw erro('A data do envio não pode ser no futuro')
      if (e.comprovante !== undefined && e.comprovante !== null && e.comprovante !== '' && (typeof e.comprovante !== 'string' || e.comprovante.trim().length > 120)) throw erro('comprovante: no máximo 120 letras')
      if (e.lado !== undefined && e.lado !== null && e.lado !== 'EMPRESTIMO' && e.lado !== 'IPHONE') throw erro('lado deve ser EMPRESTIMO ou IPHONE')
      proprios.push({ chave: `T${++seq}`, ind: id, tipo: 'ENVIOU', data, valor: arred2(e.valor), titulo: 'Enviou para a loja', sub: e.comprovante?.trim() || 'transferência', lado: e.lado ?? null })
      return montar(id, 1, 50)
    },
    _interno: {
      envios: async () => {
        const nomes = new Map((await dep.indicadores.listar({ perfil: 'ADMIN', usuarioId: 1 })).map((i) => [i.id, i.nome]))
        return proprios.filter((r) => r.tipo === 'ENVIOU' && r.data <= dep.hoje()).map((r) => ({ id: Number(r.chave.slice(1)), indicadorId: r.ind, nome: nomes.get(r.ind) ?? 'indicador', data: r.data, valor: r.valor, lado: r.lado ?? null }))
      },
    },
  }
}
