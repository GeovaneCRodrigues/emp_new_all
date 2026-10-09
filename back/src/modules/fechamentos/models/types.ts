export type StatusFechamento = 'PENDENTE' | 'CONFERIDO'

export type Fechamento = {
  id: number
  usuario: { id: number; nome: string }
  data: string
  totalDinheiro: number
  totalPix: number
  totalCartao: number
  total: number
  status: StatusFechamento
  conferidoPor: string | null
  conferidoEm: string | null
}

export type Totais = { dinheiro: number; pix: number; cartao: number }

export type RecebimentoDoDia = { transacaoId: number; numero: string; cliente: string; valor: number; forma: 'PIX' | 'DINHEIRO' | 'CARTAO'; referencia: string }

export type CaixaDoDia = Totais & { data: string; total: number; fechamento: Fechamento | null; recebimentos: RecebimentoDoDia[] }
