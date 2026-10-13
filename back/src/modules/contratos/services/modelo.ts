import type { DadosVenda, Empresa } from '../models/types.js'

const arred = (v: number) => Math.round(v * 100) / 100
export const brl = (v: number) => 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const dmyA = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

export type Variavel = { chave: string; rotulo: string; grupo: string }
type Def = Variavel & { valor: (d: DadosVenda, e: Empresa) => string | null }

const taxa = (v: number | null) => (v === null ? null : brl(v))
const DEFS: Def[] = [
  { grupo: 'Contrato', chave: 'contrato_numero', rotulo: 'Número do contrato', valor: (d) => d.numero },
  { grupo: 'Contrato', chave: 'data_venda', rotulo: 'Data da venda', valor: (d) => dmyA(d.dataVenda) },
  { grupo: 'Contrato', chave: 'data_fim', rotulo: 'Fim previsto', valor: (d) => dmyA(d.parcelas.at(-1)?.vencimento ?? d.dataVenda) },
  { grupo: 'Contrato', chave: 'atendente', rotulo: 'Atendente', valor: (_d, e) => e.atendente },
  { grupo: 'Cliente', chave: 'cliente_nome', rotulo: 'Nome', valor: (d) => d.cliente.nome },
  { grupo: 'Cliente', chave: 'cliente_cpf', rotulo: 'CPF', valor: (d) => d.cliente.cpf && (d.cliente.cpf.length === 11 ? d.cliente.cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : d.cliente.cpf) },
  { grupo: 'Cliente', chave: 'cliente_telefone', rotulo: 'Telefone', valor: (d) => d.cliente.fone },
  { grupo: 'Cliente', chave: 'cliente_endereco', rotulo: 'Endereço', valor: (d) => d.cliente.endereco },
  { grupo: 'Aparelho', chave: 'aparelho_modelo', rotulo: 'Modelo', valor: (d) => d.aparelho.modelo },
  { grupo: 'Aparelho', chave: 'aparelho_capacidade', rotulo: 'Capacidade', valor: (d) => (d.aparelho.gb > 0 ? `${d.aparelho.gb} GB` : null) },
  { grupo: 'Aparelho', chave: 'aparelho_cor', rotulo: 'Cor', valor: (d) => (d.aparelho.cor === 'A DEFINIR' ? null : d.aparelho.cor) },
  { grupo: 'Aparelho', chave: 'aparelho_estado', rotulo: 'Estado', valor: (d) => d.aparelho.condicao },
  { grupo: 'Aparelho', chave: 'aparelho_imei', rotulo: 'IMEI', valor: (d) => d.aparelho.imei },
  { grupo: 'Pagamento', chave: 'entrada_valor', rotulo: 'Entrada (caução)', valor: (d) => brl(arred(d.entrada + d.troca)) },
  {
    grupo: 'Pagamento', chave: 'entrada_composicao', rotulo: 'Como foi a entrada',
    valor: (d) => (d.entrada && d.troca ? `${brl(d.entrada)} em dinheiro e um aparelho na troca, avaliado em ${brl(d.troca)}` : d.troca ? `aparelho na troca, avaliado em ${brl(d.troca)}` : d.entrada ? `${brl(d.entrada)} em dinheiro` : 'sem entrada'),
  },
  { grupo: 'Pagamento', chave: 'parcelas_qtd', rotulo: 'Nº de parcelas', valor: (d) => String(d.parcelas.length) },
  { grupo: 'Pagamento', chave: 'parcela_valor', rotulo: 'Valor da parcela', valor: (d) => (d.parcelas[0] ? brl(d.parcelas[0].valor) : 'não há parcelas') },
  { grupo: 'Pagamento', chave: 'primeiro_vencimento', rotulo: '1º vencimento', valor: (d) => (d.parcelas[0] ? dmyA(d.parcelas[0].vencimento) : 'não há parcelas') },
  { grupo: 'Pagamento', chave: 'valor_total', rotulo: 'Valor total', valor: (d) => brl(arred(d.entrada + d.troca + d.parcelas.reduce((s, p) => s + p.valor, 0))) },
  { grupo: 'Pagamento', chave: 'seguro_texto', rotulo: 'Seguro', valor: (d, e) => (d.seguro ? (e.seguro === null ? null : `contratado, ${brl(e.seguro)} por mês junto da parcela`) : 'não contratado pelo cliente') },
  { grupo: 'Empresa e taxas', chave: 'empresa_nome', rotulo: 'Razão social', valor: (_d, e) => e.nome },
  { grupo: 'Empresa e taxas', chave: 'empresa_cnpj', rotulo: 'CNPJ', valor: (_d, e) => e.cnpj },
  { grupo: 'Empresa e taxas', chave: 'empresa_endereco', rotulo: 'Endereço', valor: (_d, e) => e.endereco },
  { grupo: 'Empresa e taxas', chave: 'empresa_email', rotulo: 'E-mail', valor: (_d, e) => e.email },
  { grupo: 'Empresa e taxas', chave: 'taxa_avaria', rotulo: 'Taxa de avaria', valor: (_d, e) => taxa(e.avaria) },
  { grupo: 'Empresa e taxas', chave: 'taxa_reposicao', rotulo: 'Reposição (perda/roubo)', valor: (_d, e) => taxa(e.reposicao) },
  { grupo: 'Empresa e taxas', chave: 'taxa_cancelamento', rotulo: 'Multa de cancelamento', valor: (_d, e) => (e.cancelamentoPct === null ? null : `${String(e.cancelamentoPct).replace('.', ',')}%`) },
  { grupo: 'Empresa e taxas', chave: 'taxa_recuperacao', rotulo: 'Taxa de recuperação', valor: (_d, e) => taxa(e.recuperacao) },
]
const POR_CHAVE = new Map(DEFS.map((d) => [d.chave, d]))
export const VARIAVEIS: Variavel[] = DEFS.map(({ chave, rotulo, grupo }) => ({ chave, rotulo, grupo }))

/** `ok`: veio do sistema · `falta`: campo sem cadastro · `desconhecido`: nome que não existe · `txt`: texto do modelo (ou contrato já enviado) */
export type Trecho = { tipo: 'txt' | 'ok' | 'falta' | 'desconhecido'; v: string }
export type Preenchido = { trechos: Trecho[]; /** rótulos dos campos que faltam cadastrar */ faltam: string[]; /** o texto final, com os campos que faltam em branco */ texto: string }

const CAMPO = /\{\{\s*(\w+)\s*\}\}/g

/** Chaves {{assim}} do texto que não existem. */
export const camposDesconhecidos = (texto: string): string[] => [...new Set([...texto.matchAll(CAMPO)].map((m) => m[1]).filter((k) => !POR_CHAVE.has(k)))]

export function preencher(texto: string, d: DadosVenda, e: Empresa): Preenchido {
  const trechos: Trecho[] = []
  const faltam = new Set<string>()
  let i = 0
  for (const m of texto.matchAll(CAMPO)) {
    if (m.index > i) trechos.push({ tipo: 'txt', v: texto.slice(i, m.index) })
    const def = POR_CHAVE.get(m[1])
    if (!def) trechos.push({ tipo: 'desconhecido', v: m[0] })
    else {
      const valor = def.valor(d, e)
      if (valor === null || valor === '') { faltam.add(def.rotulo); trechos.push({ tipo: 'falta', v: `${def.rotulo} não cadastrado` }) } else trechos.push({ tipo: 'ok', v: valor })
    }
    i = m.index + m[0].length
  }
  if (i < texto.length) trechos.push({ tipo: 'txt', v: texto.slice(i) })
  return { trechos, faltam: [...faltam], texto: trechos.map((t) => (t.tipo === 'falta' ? '' : t.v)).join('') }
}

export const MODELO_PADRAO = `CONTRATO DE LOCAÇÃO DE APARELHO CELULAR COM OPÇÃO DE COMPRA

CONTRATO Nº {{contrato_numero}}
INÍCIO: {{data_venda}}   FIM PREVISTO: {{data_fim}}
ATENDENTE: {{atendente}}

LOCADORA: {{empresa_nome}}, CNPJ {{empresa_cnpj}}
{{empresa_endereco}} · {{empresa_email}}

CLIENTE (LOCATÁRIO): {{cliente_nome}}
CPF: {{cliente_cpf}}   TELEFONE: {{cliente_telefone}}
ENDEREÇO: {{cliente_endereco}}

APARELHO: {{aparelho_modelo}} {{aparelho_capacidade}}, {{aparelho_cor}}
ESTADO: {{aparelho_estado}}   IMEI: {{aparelho_imei}}

CAUÇÃO (ENTRADA): {{entrada_valor}}, composta por {{entrada_composicao}}.
PAGAMENTO: {{parcelas_qtd}}x de {{parcela_valor}}, 1º vencimento em {{primeiro_vencimento}} e as demais no mesmo dia dos meses seguintes.
VALOR TOTAL DO CONTRATO: {{valor_total}}
SEGURO: {{seguro_texto}}.

CLÁUSULA PRIMEIRA: DO OBJETO
1.1. Locação do aparelho acima por prazo determinado. Pagas todas as parcelas, o aparelho passa a ser do LOCATÁRIO.

CLÁUSULA SEGUNDA: DAS TAXAS
2.1. Avaria do aparelho: {{taxa_avaria}}.
2.2. Reposição em caso de perda, furto ou roubo: {{taxa_reposicao}}.
2.3. Cancelamento antes do fim: multa de {{taxa_cancelamento}} sobre o saldo em aberto.
2.4. Recuperação do aparelho por falta de pagamento: {{taxa_recuperacao}}.

CLÁUSULA TERCEIRA: DO ATRASO
3.1. Com parcela em atraso, a LOCADORA pode bloquear e recuperar o aparelho, abatendo do saldo o que já foi pago, descontadas as taxas acima.

E, por estarem de acordo, as partes assinam eletronicamente.`
