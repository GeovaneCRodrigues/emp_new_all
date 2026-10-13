export type StatusContrato = 'AGUARDANDO' | 'ENVIADO' | 'ASSINADO'

/** Quem pode ver/mexer: admin em tudo; vendedor só nas vendas dele (feitas por ele ou de clientes da carteira dele). */
export type EscopoContratos = { tipo: 'TODOS' } | { tipo: 'VENDEDOR'; usuarioId: number }

export type Empresa = {
  nome: string
  cnpj: string | null
  endereco: string | null
  email: string | null
  atendente: string | null
  /** taxas do contrato; null = ainda não cadastrada (o contrato não pode ser enviado) */
  avaria: number | null
  reposicao: number | null
  seguro: number | null
  cancelamentoPct: number | null
  recuperacao: number | null
}

/** Tudo o que o texto do contrato usa, tirado da venda. */
export type DadosVenda = {
  vendaId: number
  vendaStatus: string
  numero: string
  dataVenda: string
  cliente: { nome: string; cpf: string | null; fone: string; endereco: string | null }
  aparelho: { modelo: string; gb: number; cor: string; condicao: string; imei: string | null }
  entrada: number
  troca: number
  parcelas: { valor: number; vencimento: string }[]
  seguro: boolean
}

export type LinhaContrato = {
  id: number
  vendaId: number
  numero: string
  status: StatusContrato
  modeloVersao: number
  seguro: boolean
  geradoEm: string
  enviadoEm: string | null
  assinadoEm: string | null
  textoEnviado: string | null
  clienteNome: string
  aparelho: string
  dataVenda: string
  vendaStatus: string
}
