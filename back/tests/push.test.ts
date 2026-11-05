import { describe, expect, it } from 'vitest'
import { createNotificacoesService } from '../src/modules/notificacoes/services/notificacoes.service.js'
import type { NotificacoesRepository } from '../src/modules/notificacoes/models/repository.js'
import type { Inscricao, PushRepository } from '../src/modules/push/models/repository.js'
import { createPushService, endpointPermitido } from '../src/modules/push/services/push.service.js'

const FCM = 'https://fcm.googleapis.com/fcm/send/abc123'
const APPLE = 'https://web.push.apple.com/QGx1'

function repoEmMemoria() {
  let seq = 0
  const linhas: (Inscricao & { usuarioId: number })[] = []
  const repo: PushRepository = {
    async salvar(i) {
      const ja = linhas.find((l) => l.endpoint === i.endpoint)
      if (ja) { ja.usuarioId = i.usuarioId; ja.p256dh = i.p256dh; ja.auth = i.auth } else linhas.push({ id: ++seq, usuarioId: i.usuarioId, endpoint: i.endpoint, p256dh: i.p256dh, auth: i.auth })
    },
    async remover(usuarioId, endpoint) { const i = linhas.findIndex((l) => l.usuarioId === usuarioId && l.endpoint === endpoint); if (i >= 0) linhas.splice(i, 1) },
    async doUsuario(usuarioId) { return linhas.filter((l) => l.usuarioId === usuarioId) },
    async apagar(id) { const i = linhas.findIndex((l) => l.id === id); if (i >= 0) linhas.splice(i, 1) },
  }
  return { repo, linhas }
}

const chaves = { chavePublica: 'pub', chavePrivada: 'priv', assunto: 'mailto:a@b.com' }
const inscricao = (endpoint = FCM) => ({ endpoint, keys: { p256dh: 'k1', auth: 'k2' } })
const aviso = { titulo: 'Pagamento recebido', texto: 'Recebido R$ 300,00 de ANA.', rota: '/caixa', tag: 'aud:1' }

describe('endpoints de push aceitos', () => {
  it('só os serviços dos navegadores, em https', () => {
    expect(endpointPermitido(FCM)).toBe(true)
    expect(endpointPermitido(APPLE)).toBe(true)
    expect(endpointPermitido('https://updates.push.services.mozilla.com/wpush/v2/x')).toBe(true)
    expect(endpointPermitido('http://fcm.googleapis.com/x')).toBe(false)
    expect(endpointPermitido('https://exemplo.com/x')).toBe(false)
    expect(endpointPermitido('https://googleapis.com.evil.com/x')).toBe(false)
    expect(endpointPermitido('https://user:pw@fcm.googleapis.com/x')).toBe(false)
    expect(endpointPermitido('lixo')).toBe(false)
  })
})

describe('serviço de push', () => {
  it('desligado sem as chaves: não envia nada e não mostra chave pública', async () => {
    const { repo } = repoEmMemoria()
    const chamadas: unknown[] = []
    const s = createPushService({ repo, chavePublica: null, chavePrivada: null, assunto: 'mailto:a@b.com', enviador: async (...a) => { chamadas.push(a) } })
    expect(s.ligado()).toBe(false)
    expect(s.chavePublica()).toBeNull()
    expect(await s.enviar(1, aviso)).toEqual({ enviados: 0, removidos: 0, falhas: 0 })
    expect(chamadas).toHaveLength(0)
  })

  it('inscreve, manda o texto certo a todos os aparelhos da pessoa e a de mais ninguém', async () => {
    const { repo } = repoEmMemoria()
    const enviados: { endpoint: string; corpo: Record<string, string> }[] = []
    const s = createPushService({ repo, ...chaves, enviador: async (sub, corpo) => { enviados.push({ endpoint: sub.endpoint, corpo: JSON.parse(corpo) }) } })
    await s.inscrever(1, inscricao(FCM), 'Android')
    await s.inscrever(1, inscricao(APPLE), 'iPhone')
    await s.inscrever(2, inscricao('https://fcm.googleapis.com/fcm/send/outra'), null)
    const r = await s.enviar(1, aviso)
    expect(r).toEqual({ enviados: 2, removidos: 0, falhas: 0 })
    expect(enviados.map((e) => e.endpoint).sort()).toEqual([APPLE, FCM].sort())
    expect(enviados[0].corpo).toEqual({ title: 'Pagamento recebido', body: 'Recebido R$ 300,00 de ANA.', url: '/caixa', tag: 'aud:1' })
  })

  it('rejeita inscrição incompleta ou de endereço que não é de serviço de push', async () => {
    const s = createPushService({ repo: repoEmMemoria().repo, ...chaves })
    await expect(s.inscrever(1, { endpoint: FCM }, null)).rejects.toMatchObject({ status: 400 })
    await expect(s.inscrever(1, inscricao('https://exemplo.com/x'), null)).rejects.toMatchObject({ status: 400 })
    await expect(s.inscrever(1, { endpoint: FCM, keys: { p256dh: 'x'.repeat(3000), auth: 'a' } }, null)).rejects.toMatchObject({ status: 400 })
  })

  it('o aparelho passa para quem entrou nele por último', async () => {
    const { repo, linhas } = repoEmMemoria()
    const s = createPushService({ repo, ...chaves, enviador: async () => {} })
    await s.inscrever(1, inscricao(), null)
    await s.inscrever(2, inscricao(), null)
    expect(linhas).toHaveLength(1)
    expect((await s.enviar(1, aviso)).enviados).toBe(0)
    expect((await s.enviar(2, aviso)).enviados).toBe(1)
  })

  it('apaga a inscrição que o serviço diz que não existe mais (404/410) e só conta falha nas outras', async () => {
    const { repo, linhas } = repoEmMemoria()
    const logs: string[] = []
    const s = createPushService({
      repo, ...chaves, log: (m) => logs.push(m),
      enviador: async (sub) => { if (sub.endpoint === FCM) throw Object.assign(new Error('gone'), { statusCode: 410 }); throw Object.assign(new Error('boom'), { statusCode: 500 }) },
    })
    await s.inscrever(1, inscricao(FCM), null)
    await s.inscrever(1, inscricao(APPLE), null)
    expect(await s.enviar(1, aviso)).toEqual({ enviados: 0, removidos: 1, falhas: 1 })
    expect(linhas.map((l) => l.endpoint)).toEqual([APPLE])
    expect(logs).toHaveLength(1)
  })

  it('cancelar só mexe no aparelho da própria pessoa', async () => {
    const { repo, linhas } = repoEmMemoria()
    const s = createPushService({ repo, ...chaves })
    await s.inscrever(1, inscricao(), null)
    await s.cancelar(2, FCM)
    expect(linhas).toHaveLength(1)
    await s.cancelar(1, FCM)
    expect(linhas).toHaveLength(0)
    await expect(s.cancelar(1, '')).rejects.toMatchObject({ status: 400 })
  })
})

describe('sino manda push só quando o aviso é novo', () => {
  function repoDoSino(): NotificacoesRepository {
    const chaves = new Set<string>()
    let cursor: number | null = 0
    return {
      contrato: async () => ({ numero: '2026-0104', cliente: 'ANA' }),
      clienteDaOperacao: async () => 'ANA',
      usuariosAtivos: async () => [{ id: 7, perfil: 'ADMIN' }],
      inserir: async (n) => { const k = `${n.usuarioId}:${n.chave}`; if (chaves.has(k)) return false; chaves.add(k); return true },
      listar: async () => [], naoLidas: async () => 0, marcarLida: async () => true, marcarTodas: async () => 0,
      estado: async () => cursor, gravarEstado: async (_c, v) => { cursor = v }, ultimaAuditoria: async () => 0,
      auditoriaApos: async (id) => (id === 0 ? [{ id: 5, acao: 'CONTRATO_ASSINADO_ZAPSIGN', entidade: 'contrato', entidadeId: 1, usuarioId: null, depois: null }] : []),
    } as unknown as NotificacoesRepository
  }

  it('manda uma vez por aviso e o de atraso do dia não repete na rodada seguinte', async () => {
    const mandados: { usuarioId: number; titulo: string; texto: string; rota: string }[] = []
    const s = createNotificacoesService({
      repo: repoDoSino(), hoje: () => '2026-11-06', atrasos: async () => ({ atrasadas: 2, hoje: 0 }),
      aoCriar: async (usuarioId, a) => { mandados.push({ usuarioId, titulo: a.titulo, texto: a.texto, rota: a.rota }) },
    })
    await s.sincronizar()
    await s.sincronizar()
    expect(mandados).toEqual([
      { usuarioId: 7, titulo: 'Contrato assinado', texto: 'Contrato 2026-0104 assinado por ANA.', rota: '/contratos' },
      { usuarioId: 7, titulo: 'Parcelas atrasadas', texto: '2 parcelas atrasadas para cobrar.', rota: '/cobrancas' },
    ])
  })

  it('um push que quebra não impede o aviso nem as outras rodadas', async () => {
    const erros: string[] = []
    const s = createNotificacoesService({
      repo: repoDoSino(), hoje: () => '2026-11-06', atrasos: async () => ({ atrasadas: 1, hoje: 1 }),
      aoCriar: async () => { throw new Error('sem rede') }, log: (m) => erros.push(m),
    })
    await expect(s.sincronizar()).resolves.toBeUndefined()
    expect(erros.length).toBe(3)
  })
})
