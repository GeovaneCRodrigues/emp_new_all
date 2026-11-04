export type StatusContrato = 'AGUARDANDO' | 'ENVIADO' | 'ASSINADO'

/** Quem pode ver/mexer: admin em tudo; vendedor só nas vendas dele (feitas por ele ou de clientes da carteira dele). */
export type EscopoContratos = { tipo: 'TODOS' } | { tipo: 'VENDEDOR'; usuarioId: number }

export type Empresa = {
  nome: string
  cnpj: string | null
  endereco: string | null
  email: string | null
  atendente: string | null
  /** só dígitos, com DDD */
  telefone: string | null
  cidade: string | null
  /** 2 letras */
  uf: string | null
  /** chave Pix da loja (como foi digitada) */
  pixChave: string | null
  /** a imagem em si sai por GET /api/empresa/logo (não vai junto, é pesada) */
  temLogo: boolean
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
  cliente: {
    nome: string; cpf: string | null; fone: string; email: string | null; rg: string | null
    endereco: string | null; numero: string | null; bairro: string | null; cidade: string | null; uf: string | null; cep: string | null
  }
  aparelho: { modelo: string; gb: number; cor: string; condicao: string; imei: string | null; serie: string | null }
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
  /** só dígitos, com DDD (para abrir o WhatsApp) */
  clienteFone: string
  aparelho: string
  dataVenda: string
  vendaStatus: string
}

/** O que o link de assinatura precisa saber de um contrato. */
export type ContratoDoLink = {
  linha: LinhaContrato
  /** CPF do cliente (só dígitos) para conferir quem assina */
  cpf: string | null
  expiraEm: Date | null
  tentativas: number
}

export type Assinatura = {
  imagem: string
  cpf: string
  textoHash: string
  ip: string | null
  userAgent: string | null
  assinadoEm: string
}
