import { HttpError } from '../../../shared/errors.js'

/** O que o contrato pede ao ZapSign. O resto (idioma, pasta, lembretes) o cliente decide. */
export type PedidoDocumento = {
  nome: string
  numero: string
  pdf: Buffer
  signatario: { nome: string; email: string | null; foneDigitos: string | null; cpf: string | null }
}
export type DocumentoZapsign = {
  token: string
  status: 'pending' | 'signed' | 'refused' | string
  externalId: string | null
  signerToken: string | null
  signUrl: string | null
  arquivoAssinado: string | null
  assinadoEm: string | null
}

export interface ZapsignClient {
  /** `true` = os documentos nascem em modo teste (sem validade jurídica, sem consumir assinatura). */
  readonly sandbox: boolean
  criarDocumento(p: PedidoDocumento): Promise<DocumentoZapsign>
  obterDocumento(token: string): Promise<DocumentoZapsign>
}

const BASE = 'https://api.zapsign.com.br/api/v1'
const so = (v: unknown) => (typeof v === 'string' && v ? v : null)

function doc(j: any): DocumentoZapsign {
  const s = Array.isArray(j?.signers) ? j.signers[0] : null
  return {
    token: String(j?.token ?? ''), status: String(j?.status ?? 'pending'), externalId: so(j?.external_id),
    signerToken: so(s?.token), signUrl: so(s?.sign_url), arquivoAssinado: so(j?.signed_file),
    assinadoEm: so(s?.signed_at) ?? so(j?.last_update_at),
  }
}

/** Cliente da API do ZapSign. O token fica só no servidor (nunca vai para o front nem para o log). */
export function criarZapsignClient(o: { token: string; sandbox: boolean; fetch?: typeof fetch }): ZapsignClient {
  const f = o.fetch ?? fetch
  async function chamar(caminho: string, init: RequestInit = {}) {
    let r: Response
    try {
      r = await f(`${BASE}${caminho}`, { ...init, signal: AbortSignal.timeout(30_000), headers: { Authorization: `Bearer ${o.token}`, Accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}) } })
    } catch {
      throw new HttpError(502, 'Não consegui falar com o ZapSign. Tente de novo em instantes.', 'ZAPSIGN_INDISPONIVEL')
    }
    const corpo: any = await r.json().catch(() => ({}))
    if (!r.ok) {
      let msg = String(corpo?.detail ?? corpo?.message ?? 'O ZapSign recusou o pedido.')
      if (/plano de api|modo produ/i.test(msg)) msg = 'A conta do ZapSign não tem o Plano de API para enviar em produção.'
      throw new HttpError(r.status === 401 || r.status === 403 ? 502 : 422, msg, 'ZAPSIGN_RECUSOU')
    }
    return corpo
  }
  return {
    sandbox: o.sandbox,
    async criarDocumento(p) {
      const s = p.signatario
      const corpo: Record<string, unknown> = {
        name: p.nome, base64_pdf: p.pdf.toString('base64'), lang: 'pt-br', external_id: p.numero, folder_path: '/contratos/',
        disable_signer_emails: true, reminder_every_n_days: 3,
        signers: [{
          name: s.nome, ...(s.email ? { email: s.email, lock_email: true } : {}),
          ...(s.foneDigitos ? { phone_country: '55', phone_number: s.foneDigitos.replace(/^55(?=\d{10,11}$)/, '') } : {}),
          // com e-mail, o cliente também confirma por um código enviado a ele; sem e-mail, só assina na tela
          auth_mode: s.email ? 'assinaturaTela-tokenEmail' : 'assinaturaTela', send_automatic_email: false, send_automatic_whatsapp: false, lock_name: true,
          ...(s.cpf ? { require_cpf: true, cpf: s.cpf } : {}),
        }],
        ...(o.sandbox ? { sandbox: true } : {}),
      }
      return doc(await chamar('/docs/', { method: 'POST', body: JSON.stringify(corpo) }))
    },
    async obterDocumento(token) {
      if (!/^[A-Za-z0-9-]{8,80}$/.test(token)) throw new HttpError(400, 'Token de documento inválido', 'ZAPSIGN_RECUSOU')
      return doc(await chamar(`/docs/${token}/`))
    },
  }
}
