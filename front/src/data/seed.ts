import { planoEmprestimo, faltaP } from '@/domain/calc'
import { somaMes } from '@/domain/datas'
import type { Bem, Cliente, Dados } from '@/domain/dados'
import type { Emprestimo, Indicador, ModalidadeEmp, Parcela, Periodicidade, RepasseIndicador, StatusContrato, Usuario, Venda } from '@/domain/types'

/** Dia fixo do protótipo, para os dados de exemplo baterem com as telas. */
export const HOJE_DEMO = '2026-10-08'

let seq = 100

function pagarDireto(p: Parcela, data: string, valor = p.valor) {
  p.pagos.push({ data, valor, forma: 'Pix', tx: ++seq })
  if (faltaP(p) <= 0.009) p.pago = data
}

const bens: Bem[] = [
  { id: 1, modelo: 'iPhone 13', gb: 128, cor: 'Meia-noite', bateria: 88, cond: 'Seminovo', imei: '352918114471203', custo: 2150, extras: 80, preco: 3600, estado: 'DISPONIVEL', desde: '2026-09-29', origem: 'COMPRA' },
  { id: 2, modelo: 'iPhone 14', gb: 128, cor: 'Azul', bateria: 91, cond: 'Seminovo', imei: '356771093382117', custo: 2900, extras: 60, preco: 4600, estado: 'DISPONIVEL', desde: '2026-09-18', origem: 'COMPRA' },
  { id: 3, modelo: 'iPhone 15', gb: 128, cor: 'Rosa', bateria: 97, cond: 'Seminovo', imei: '359104227610458', custo: 3700, extras: 0, preco: 5700, estado: 'DISPONIVEL', desde: '2026-10-03', origem: 'COMPRA' },
  { id: 4, modelo: 'iPhone 15 Pro', gb: 256, cor: 'Titânio natural', bateria: 94, cond: 'Seminovo', imei: '350912648827093', custo: 4900, extras: 120, preco: 7400, estado: 'DISPONIVEL', desde: '2026-08-21', origem: 'COMPRA' },
  { id: 5, modelo: 'iPhone 12', gb: 64, cor: 'Branco', bateria: 83, cond: 'Seminovo', imei: '353304115520668', custo: 1300, extras: 150, preco: 2400, estado: 'DISPONIVEL', desde: '2026-08-30', origem: 'TROCA' },
  { id: 6, modelo: 'iPhone 16', gb: 128, cor: 'Preto', bateria: 100, cond: 'Novo', imei: '357340221198734', custo: 5100, extras: 0, preco: 7600, estado: 'DISPONIVEL', desde: '2026-10-06', origem: 'COMPRA' },
  { id: 7, modelo: 'iPhone 16 Pro', gb: 256, cor: 'Titânio preto', bateria: 100, cond: 'Novo', imei: '', custo: 7300, extras: 0, preco: 10200, estado: 'ENCOMENDADO', desde: '2026-10-05', origem: 'COMPRA', paraCliente: 9 },
  { id: 8, modelo: 'iPhone 13', gb: 128, cor: 'Estelar', bateria: 86, cond: 'Seminovo', imei: '352918110093341', custo: 2100, extras: 0, preco: 3600, estado: 'VENDIDO', desde: '2026-07-02', origem: 'COMPRA' },
  { id: 9, modelo: 'iPhone 14', gb: 128, cor: 'Meia-noite', bateria: 90, cond: 'Seminovo', imei: '356771091120495', custo: 2950, extras: 50, preco: 4600, estado: 'VENDIDO', desde: '2026-07-28', origem: 'COMPRA' },
  { id: 10, modelo: 'iPhone 15', gb: 128, cor: 'Azul', bateria: 98, cond: 'Seminovo', imei: '359104221187730', custo: 3800, extras: 0, preco: 5900, estado: 'VENDIDO', desde: '2026-07-30', origem: 'COMPRA' },
  { id: 11, modelo: 'iPhone 15 Pro', gb: 256, cor: 'Titânio azul', bateria: 95, cond: 'Seminovo', imei: '350912640016622', custo: 4800, extras: 100, preco: 7400, estado: 'VENDIDO', desde: '2026-06-10', origem: 'COMPRA' },
  { id: 12, modelo: 'iPhone 13', gb: 256, cor: 'Verde', bateria: 87, cond: 'Seminovo', imei: '352918117730082', custo: 2400, extras: 0, preco: 4000, estado: 'VENDIDO', desde: '2026-08-14', origem: 'COMPRA' },
  { id: 14, modelo: 'iPhone 13 Pro', gb: 128, cor: 'Azul', bateria: 90, cond: 'Seminovo', imei: '352710338812046', custo: 3000, extras: 0, preco: 4800, estado: 'VENDIDO', desde: '2026-09-11', origem: 'COMPRA' },
  { id: 15, modelo: 'iPhone 12', gb: 128, cor: 'Preto', bateria: 85, cond: 'Seminovo', imei: '353304110071290', custo: 1500, extras: 50, preco: 2600, estado: 'VENDIDO', desde: '2026-02-12', origem: 'COMPRA' },
  { id: 16, modelo: 'iPhone 14', gb: 256, cor: 'Estelar', bateria: 93, cond: 'Seminovo', imei: '356771097740318', custo: 3200, extras: 0, preco: 5000, estado: 'VENDIDO', desde: '2026-09-25', origem: 'COMPRA' },
  { id: 13, modelo: 'iPhone 14 Pro', gb: 128, cor: 'Roxo-profundo', bateria: 89, cond: 'Seminovo', imei: '356990884410273', custo: 3900, extras: 0, preco: 6200, estado: 'VENDIDO', desde: '2026-08-20', origem: 'COMPRA' },
]

const desde = ['2025-11-03', '2026-01-20', '2026-02-14', '2025-08-09', '2026-03-02', '2025-12-11', '2025-06-30', '2026-02-28', '2026-07-19']
const resp = [2, 2, 3, 3, 2, 3, 1, 3, 2]
const clientes: Cliente[] = [
  ['Juliana Prado', '(11) 98812-4410'], ['Lucas Martins', '(11) 97761-2209'], ['Fernanda Almeida', '(11) 99102-7744'],
  ['Carlos Henrique Souza', '(11) 98450-1132'], ['Mariana Lopes', '(11) 99633-0921'], ['Ana Paula Ribeiro', '(11) 97320-5518'],
  ['Ricardo Nunes', '(11) 98027-6650'], ['João Batista Freitas', '(11) 99877-3304'], ['Patrícia Gomes', '(11) 98144-9027'],
].map(([nome, fone], i) => ({ id: i + 1, nome, fone, desde: desde[i], responsavelId: resp[i] }))

const indicadores: Indicador[] = [
  { id: 1, nome: 'Roberto Indicações', pct: 0.5 },
  { id: 2, nome: 'Loja Ponto Cell', pct: 0.3 },
]
const pctDe = (id: number) => indicadores.find((i) => i.id === id)?.pct ?? 0

function criarVenda(a: { bemId: number; clienteId: number; data: string; entrada: number; troca?: number; n: number; valorParc: number; dia: number; indicadorId?: number; pagas?: number; contrato?: StatusContrato }): Venda {
  const { n, valorParc, dia, data, pagas = 0 } = a
  const parcelas: Parcela[] = Array.from({ length: n }, (_, i) => {
    const venc = somaMes(data, i + 1, dia)
    const paga = i < pagas
    return { n: i + 1, venc, valor: valorParc, pago: paga ? venc : null, pagos: paga ? [{ data: venc, valor: valorParc, forma: 'Pix', tx: ++seq }] : [], desconto: 0 }
  })
  const indicadorId = a.indicadorId ?? 0
  return { tipo: 'VENDA', id: ++seq, bemId: a.bemId, clienteId: a.clienteId, data, entrada: a.entrada, troca: a.troca ?? 0, parcelas, indicadorId, pct: pctDe(indicadorId), contrato: a.contrato ?? 'ASSINADO', status: 'ATIVA' }
}

const vendas: Venda[] = [
  criarVenda({ bemId: 8, clienteId: 1, data: '2026-07-20', entrada: 600, n: 12, valorParc: 250, dia: 20, pagas: 2 }),
  criarVenda({ bemId: 9, clienteId: 2, data: '2026-08-10', entrada: 1000, n: 12, valorParc: 300, dia: 10, indicadorId: 1, pagas: 1 }),
  criarVenda({ bemId: 10, clienteId: 3, data: '2026-08-12', entrada: 1500, troca: 900, n: 10, valorParc: 350, dia: 5 }),
  criarVenda({ bemId: 11, clienteId: 4, data: '2026-07-02', entrada: 1400, n: 12, valorParc: 500, dia: 5, pagas: 1 }),
  criarVenda({ bemId: 12, clienteId: 5, data: '2026-09-01', entrada: 800, n: 10, valorParc: 320, dia: 15, indicadorId: 2 }),
  criarVenda({ bemId: 13, clienteId: 6, data: '2026-09-05', entrada: 2000, n: 12, valorParc: 350, dia: 8, contrato: 'AGUARDANDO' }),
  criarVenda({ bemId: 15, clienteId: 8, data: '2026-03-10', entrada: 500, n: 6, valorParc: 350, dia: 10, indicadorId: 1, pagas: 6 }),
  criarVenda({ bemId: 14, clienteId: 7, data: '2026-10-02', entrada: 1200, n: 12, valorParc: 300, dia: 2 }),
  criarVenda({ bemId: 16, clienteId: 9, data: '2026-10-06', entrada: 2000, n: 10, valorParc: 300, dia: 6, indicadorId: 1, contrato: 'AGUARDANDO' }),
]
pagarDireto(vendas[0].parcelas[2], '2026-10-02')
pagarDireto(vendas[1].parcelas[1], '2026-10-07')
pagarDireto(vendas[2].parcelas[0], '2026-09-10', 150) // Fernanda pagou só uma parte da 1ª

function criarEmp(a: { clienteId: number; data: string; capital: number; mod: ModalidadeEmp; taxa: number; n: number; indicadorId?: number; pagarAte: string; freq?: Periodicidade }): Emprestimo {
  const freq: Periodicidade = a.mod === 'DIARIA' ? 'DIARIA' : a.freq ?? 'MENSAL'
  const parcelas: Parcela[] = planoEmprestimo(a).map((x, i) => ({ n: i + 1, venc: x.venc, valor: x.valor, pago: null, pagos: [], desconto: 0 }))
  for (const p of parcelas) if (p.venc <= a.pagarAte) pagarDireto(p, p.venc)
  const indicadorId = a.indicadorId ?? 0
  return { tipo: 'EMP', id: ++seq, clienteId: a.clienteId, data: a.data, capital: a.capital, mod: a.mod, taxa: a.taxa, freq, parcelas, indicadorId, pct: pctDe(indicadorId), status: 'ATIVA' }
}

const emprestimos: Emprestimo[] = [
  criarEmp({ clienteId: 7, data: '2026-06-25', capital: 5000, mod: 'PARCELADO', taxa: 60, n: 6, pagarAte: '2026-09-30' }),
  criarEmp({ clienteId: 6, data: '2026-05-10', capital: 3000, mod: 'JUROS', taxa: 12, n: 6, pagarAte: '2026-09-30' }),
  criarEmp({ clienteId: 8, data: '2026-09-24', capital: 1000, mod: 'DIARIA', taxa: 20, n: 24, pagarAte: '2026-10-06' }),
  criarEmp({ clienteId: 5, data: '2026-05-15', capital: 2000, mod: 'PARCELADO', taxa: 32, n: 4, pagarAte: '2026-09-30' }),
  criarEmp({ clienteId: 2, data: '2026-10-01', capital: 600, mod: 'DIARIA', taxa: 20, n: 20, indicadorId: 1, pagarAte: '2026-10-07' }),
  criarEmp({ clienteId: 9, data: '2026-08-01', capital: 4000, mod: 'PARCELADO', taxa: 100, n: 10, indicadorId: 1, pagarAte: '2026-08-31' }),
]

const usuarios: Usuario[] = [
  { id: 1, nome: 'Geovane Cataneo', perfil: 'ADMIN', fone: '(11) 99000-1100' },
  { id: 2, nome: 'Bruna Teixeira', perfil: 'VENDEDOR', fone: '(11) 98123-4455' },
  { id: 3, nome: 'Diego Ramos', perfil: 'COBRADOR', fone: '(11) 97788-2201' },
]

const repasses: RepasseIndicador[] = [{ indicadorId: 1, data: '2026-07-10', valor: 120, forma: 'Pix' }]

/** Fotografia completa dos dados de exemplo (sem filtro de perfil). */
export function criarSeed(): Dados {
  return structuredClone({
    hoje: HOJE_DEMO,
    bens, clientes, indicadores, vendas, emprestimos, usuarios, repasses,
    juros: { pct: 10, maxParcelas: 10 },
  })
}
