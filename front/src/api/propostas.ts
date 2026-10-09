import type { Sessao } from '@/domain/escopo'

export type TipoProposta = 'VENDA' | 'EMPRESTIMO'
export type StatusProposta = 'PENDENTE' | 'ACEITA' | 'RECUSADA' | 'CANCELADA'

/** A intenção do indicador sobre um cliente dele. A loja só aceita ou recusa e cadastra a venda/empréstimo. */
export interface PropostaApi {
  id: number
  indicador: { id: number; nome: string }
  cliente: { id: number; nome: string; fone: string }
  tipo: TipoProposta
  /** o que o cliente quer, em texto */
  interesse: string | null
  aparelho: { id: number; modelo: string; gb: number; cor: string } | null
  valor: number | null
  parcelas: number | null
  obs: string | null
  status: StatusProposta
  motivoRecusa: string | null
  respondidoPor: string | null
  respondidoEm: string | null
  /** a venda ou o empréstimo que a loja cadastrou a partir da proposta */
  operacao: { tipo: TipoProposta; id: number } | null
  criadaEm: string
}

export interface EntradaProposta {
  clienteId: number
  tipo: TipoProposta
  interesse?: string
  aparelhoId?: number
  valor?: number
  parcelas?: number
  obs?: string
}

export interface ListaPropostas { itens: PropostaApi[]; total: number; pendentes: number; pagina: number; limite: number }

export interface PropostasApi {
  criar(s: Sessao, e: EntradaProposta): Promise<PropostaApi>
  listar(s: Sessao, q: { status?: StatusProposta; indicadorId?: number; pagina?: number; limite?: number }): Promise<ListaPropostas>
  obter(s: Sessao, id: number): Promise<PropostaApi>
  /** Só o administrador. Se a venda/empréstimo já foi cadastrado, liga a proposta a ele. */
  aceitar(s: Sessao, id: number, e?: { vendaId?: number; emprestimoId?: number }): Promise<PropostaApi>
  recusar(s: Sessao, id: number, e?: { motivo?: string }): Promise<PropostaApi>
  /** O indicador desiste de uma proposta que ainda não foi respondida. */
  cancelar(s: Sessao, id: number): Promise<PropostaApi>
}
