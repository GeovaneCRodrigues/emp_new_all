import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { criarZapsignClient } from '../src/modules/contratos/services/zapsign.client.js'
import { gerarPdfDoContrato } from '../src/modules/contratos/services/pdf.js'

const resposta = (status: number, corpo: unknown) => new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } })
const pedido = { nome: 'Contrato 2026-0001', numero: '2026-0001', pdf: Buffer.from('%PDF-1.4 teste'), signatario: { nome: 'ANA SOUZA', email: 'ana@x.com', foneDigitos: '11988124410', cpf: '52998224725' } }

describe('cliente do ZapSign', () => {
  it('cria o documento: manda o PDF, o signatário e o CPF, com o token só no cabeçalho', async () => {
    let url = '', init: RequestInit = {}
    const c = criarZapsignClient({ token: 'TOKEN-SECRETO', sandbox: true, fetch: (async (u: string, i: RequestInit) => { url = u; init = i; return resposta(200, { token: 'doc1', status: 'pending', external_id: '2026-0001', signers: [{ token: 's1', sign_url: 'https://app.zapsign.com.br/verificar/s1' }] }) }) as never })
    const d = await c.criarDocumento(pedido)
    expect(d).toMatchObject({ token: 'doc1', status: 'pending', externalId: '2026-0001', signerToken: 's1', signUrl: 'https://app.zapsign.com.br/verificar/s1' })
    expect(url).toBe('https://api.zapsign.com.br/api/v1/docs/')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer TOKEN-SECRETO')
    const corpo = JSON.parse(init.body as string)
    expect(corpo).toMatchObject({ sandbox: true, lang: 'pt-br', external_id: '2026-0001', name: 'Contrato 2026-0001' })
    expect(Buffer.from(corpo.base64_pdf, 'base64').toString()).toBe('%PDF-1.4 teste')
    expect(corpo.signers[0]).toMatchObject({ name: 'ANA SOUZA', email: 'ana@x.com', phone_country: '55', phone_number: '11988124410', cpf: '52998224725', require_cpf: true, auth_mode: 'assinaturaTela-tokenEmail' })
    expect(JSON.stringify(corpo)).not.toContain('TOKEN-SECRETO')
  })
  it('fora do modo teste não manda sandbox; sem e-mail assina só na tela', async () => {
    let corpo: any
    const c = criarZapsignClient({ token: 't', sandbox: false, fetch: (async (_u: string, i: RequestInit) => { corpo = JSON.parse(i.body as string); return resposta(200, { token: 'd', status: 'pending', signers: [] }) }) as never })
    await c.criarDocumento({ ...pedido, signatario: { ...pedido.signatario, email: null } })
    expect(corpo.sandbox).toBeUndefined(); expect(corpo.signers[0].auth_mode).toBe('assinaturaTela'); expect(corpo.signers[0].email).toBeUndefined()
  })
  it('fone com 55 na frente não duplica o código do país', async () => {
    let corpo: any
    const c = criarZapsignClient({ token: 't', sandbox: true, fetch: (async (_u: string, i: RequestInit) => { corpo = JSON.parse(i.body as string); return resposta(200, { token: 'd', status: 'pending', signers: [] }) }) as never })
    await c.criarDocumento({ ...pedido, signatario: { ...pedido.signatario, foneDigitos: '5511988124410' } })
    expect(corpo.signers[0].phone_number).toBe('11988124410')
  })
  it('lê o documento e o arquivo assinado', async () => {
    const c = criarZapsignClient({ token: 't', sandbox: false, fetch: (async () => resposta(200, { token: 'doc1', status: 'signed', external_id: 'X', signed_file: 'https://s3/arquivo.pdf', signers: [{ token: 's', signed_at: '2026-11-05T10:00:00Z' }] })) as never })
    expect(await c.obterDocumento('doc12345')).toMatchObject({ status: 'signed', arquivoAssinado: 'https://s3/arquivo.pdf', assinadoEm: '2026-11-05T10:00:00Z' })
  })
  it('erros viram mensagem clara, sem vazar o token', async () => {
    const quer = (status: number, corpo: unknown) => criarZapsignClient({ token: 'TOKEN-SECRETO', sandbox: false, fetch: (async () => resposta(status, corpo)) as never })
    await expect(quer(403, { detail: 'Invalid token TOKEN-SECRETO' }).obterDocumento('doc12345')).rejects.toMatchObject({ status: 502, code: 'ZAPSIGN_RECUSOU' })
    await expect(quer(400, { detail: 'Seu plano de API não permite modo produção' }).criarDocumento(pedido)).rejects.toThrow(/Plano de API/)
    const rede = criarZapsignClient({ token: 't', sandbox: true, fetch: (async () => { throw new Error('ECONNRESET') }) as never })
    await expect(rede.obterDocumento('doc12345')).rejects.toMatchObject({ status: 502, code: 'ZAPSIGN_INDISPONIVEL' })
  })
  it('token de documento torto não vai para a URL', async () => {
    const c = criarZapsignClient({ token: 't', sandbox: true, fetch: (async () => { throw new Error('não devia chamar') }) as never })
    for (const t of ['../../x', 'a b', '', 'x'.repeat(200)]) await expect(c.obterDocumento(t)).rejects.toMatchObject({ status: 400 })
  })
})

describe('PDF do contrato', () => {
  it('gera um PDF de verdade, com várias páginas quando o texto é grande', async () => {
    const texto = Array.from({ length: 200 }, (_, i) => `CLÁUSULA ${i}: o LOCATÁRIO pagará à LOCADORA, às 18h, o valor de R$ 960,00 – “aspas”, ação e coração.`).join('\n')
    const pdf = await gerarPdfDoContrato('Contrato 2026-0001', texto)
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    expect((await PDFDocument.load(pdf)).getPageCount()).toBeGreaterThan(3)
  })
  it('caractere que a fonte não tem (emoji) não derruba a geração', async () => {
    await expect(gerarPdfDoContrato('T', 'ok ✔ 😀 fim')).resolves.toBeInstanceOf(Buffer)
  })
  it('palavra gigante (um link) é cortada e não estoura a página', async () => {
    await expect(gerarPdfDoContrato('T', 'x'.repeat(5000))).resolves.toBeInstanceOf(Buffer)
  })
  it('texto vazio ainda gera um PDF válido', async () => {
    expect((await gerarPdfDoContrato('T', '')).subarray(0, 5).toString()).toBe('%PDF-')
  })
})
