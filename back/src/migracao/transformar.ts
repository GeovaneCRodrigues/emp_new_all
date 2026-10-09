import { cpfValido, normalizarFone, soDigitos } from '../shared/documentos.js'
import type { ClienteAntigo, ClienteNovo, CodigoAviso, Convertido, IndicadorAntigo, IndicadorNovo } from './tipos.js'

const limpo = (v: string | null | undefined) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '')
const vazioParaNull = (v: string) => (v === '' ? null : v)

/** Corta no limite do campo novo e avisa (a conversão nunca derruba a linha por texto comprido). */
function cortar(v: string, max: number, aviso: CodigoAviso, avisos: CodigoAviso[]): string {
  if (v.length <= max) return v
  avisos.push(aviso)
  return v.slice(0, max).trimEnd()
}

/** O % de cada indicador: o mais usado nas operações dele (o % de cada operação já fica guardado nela). */
export function percentualDoIndicador(p: IndicadorAntigo['percentuais']): number | null {
  const usados = p.filter((x) => Number.isFinite(Number(x.pct)) && Number(x.pct) > 0 && Number(x.pct) <= 1)
  if (!usados.length) return null
  // mais operações ganha; em empate, o maior %
  const ordenado = [...usados].sort((a, b) => Number(b.qtd) - Number(a.qtd) || Number(b.pct) - Number(a.pct))
  return Math.round(Number(ordenado[0].pct) * 10000) / 10000
}

export function converterIndicador(a: IndicadorAntigo): Convertido<IndicadorNovo> {
  const avisos: CodigoAviso[] = []
  const nome = limpo(a.nome)
  if (!nome) return { novo: null, avisos, erro: 'indicador sem nome' }
  let whatsapp: string | null = null
  if (limpo(a.telefone)) {
    whatsapp = normalizarFone(a.telefone!)
    if (!whatsapp) avisos.push('whatsapp_invalido')
  }
  const pct = percentualDoIndicador(a.percentuais)
  if (pct === null) avisos.push('sem_percentual')
  const ativo = String(a.status).toUpperCase() === 'ATIVO'
  if (!ativo) avisos.push('indicador_inativo')
  return { novo: { legacyId: a.id, nome: cortar(nome, 160, 'nome_cortado', avisos), whatsapp, pct: pct ?? 0.5, pctManual: true, ativo }, avisos }
}

/** "Rua A, 10 - apto 2, Centro, Campinas/SP, CEP 13000-000": só entram as partes que existem. */
export function montarEndereco(a: Pick<ClienteAntigo, 'endereco' | 'numero' | 'complemento' | 'bairro' | 'cidade' | 'uf' | 'cep'>): string {
  const rua = limpo(a.endereco)
  const numero = limpo(a.numero)
  const compl = limpo(a.complemento)
  const bairro = limpo(a.bairro)
  const cidade = limpo(a.cidade)
  const uf = limpo(a.uf).toUpperCase()
  const digitosCep = soDigitos(a.cep ?? '')
  const cep = digitosCep.length === 8 ? `${digitosCep.slice(0, 5)}-${digitosCep.slice(5)}` : ''
  const logradouro = [rua, numero].filter(Boolean).join(', ') + (compl ? ` - ${compl}` : '')
  // a UF vem 'SP' por padrão mesmo sem endereço: só vale junto de uma cidade
  const local = cidade ? (uf ? `${cidade}/${uf}` : cidade) : ''
  return [logradouro.replace(/^ - /, ''), bairro, local, cep ? `CEP ${cep}` : ''].filter(Boolean).join(', ')
}

export function converterCliente(a: ClienteAntigo): Convertido<ClienteNovo> {
  const avisos: CodigoAviso[] = []
  const nome = limpo(a.nome)
  if (!nome) return { novo: null, avisos, erro: 'cliente sem nome' }

  // documento: CPF (11) ou CNPJ (14), só dígitos; outro tamanho não se adivinha
  let cpf: string | null = null
  const docBruto = limpo(a.cpf_cnpj)
  if (!docBruto) avisos.push('sem_documento')
  else {
    const d = soDigitos(docBruto)
    if (d.length === 11 || d.length === 14) {
      cpf = d
      if (d.length === 11 && !cpfValido(d)) avisos.push('cpf_digito_invalido') // entra mesmo assim: é o dado que a loja tem
    } else avisos.push('documento_tamanho_estranho')
  }

  // telefone: o 1º; se não presta, tenta o 2º; sem nenhum, fica vazio (= "sem telefone")
  let fone = ''
  const t1 = limpo(a.telefone1), t2 = limpo(a.telefone2)
  const n1 = t1 ? normalizarFone(t1) : null
  const n2 = t2 ? normalizarFone(t2) : null
  // telefone que o sistema novo não reconhece nunca se perde: vai anotado nas observações (o campo de telefone fica vazio)
  const anotacoes: string[] = []
  if (n1) fone = n1
  else if (n2) { fone = n2; avisos.push('telefone_do_segundo_campo'); if (t1) anotacoes.push(`Telefone no sistema antigo (não reconhecido): ${t1}`) }
  else if (t1 || t2) { avisos.push('telefone_invalido'); anotacoes.push(`Telefone no sistema antigo (não reconhecido): ${[t1, t2].filter(Boolean).join(' / ')}`) }
  else avisos.push('sem_telefone')

  let email: string | null = null
  const e = limpo(a.email).toLowerCase()
  if (e) { if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 255) email = e; else avisos.push('email_invalido') }

  const rg = vazioParaNull(cortar(limpo(a.rg), 20, 'rg_cortado', avisos))
  const endereco = vazioParaNull(cortar(montarEndereco(a), 500, 'endereco_cortado', avisos))
  const obs = [typeof a.obs === 'string' ? a.obs.trim() : '', ...anotacoes].filter(Boolean).join('\n')
  const observacoes = vazioParaNull(cortar(obs, 2000, 'observacao_cortada', avisos))
  if (String(a.status).toUpperCase() !== 'ATIVO') avisos.push('cliente_inativo')

  const quando = a.created_at ? new Date(a.created_at) : null
  return {
    novo: {
      legacyId: a.id, nome: cortar(nome, 160, 'nome_cortado', avisos), cpf, rg, fone, email, endereco, observacoes,
      indicadorLegacyId: a.indicador_id ?? null, desde: quando && !Number.isNaN(quando.getTime()) ? quando : null,
    },
    avisos,
  }
}
