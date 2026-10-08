import type { Knex } from 'knex'
import type { DadosIndicador, Indicador, Nivel } from './types.js'

export interface IndicadoresRepository {
  listar(): Promise<Indicador[]>
  buscar(id: number): Promise<Indicador | null>
  criar(d: DadosIndicador): Promise<Indicador>
  atualizar(id: number, d: Partial<DadosIndicador>): Promise<Indicador>
  /** Ativa ou desativa o indicador e o login dele. Ao desativar, derruba as sessões abertas. */
  definirAtivo(id: number, ativo: boolean): Promise<Indicador>
  /** Cria o login do indicador. Lança o erro do banco (23505) se o e-mail ou o indicador já tem acesso. */
  criarAcesso(indicadorId: number, d: { nome: string; email: string; senhaHash: string }): Promise<void>
  niveis(): Promise<Nivel[]>
  salvarNiveis(niveis: Nivel[], auto: boolean): Promise<void>
  niveisAuto(): Promise<boolean>
}

type Linha = {
  id: number; nome: string; whatsapp: string | null; chave_pix: string | null; pct: string; pct_manual: boolean; ativo: boolean
  operacoes: string; tem_acesso: boolean
}

const paraIndicador = (l: Linha): Indicador => ({
  id: l.id, nome: l.nome, whatsapp: l.whatsapp, chavePix: l.chave_pix, pct: Number(l.pct), pctManual: l.pct_manual, ativo: l.ativo,
  operacoes: Number(l.operacoes), temAcesso: l.tem_acesso,
})

const paraLinha = (d: Partial<DadosIndicador>) => {
  const l: Record<string, unknown> = {}
  if (d.nome !== undefined) l.nome = d.nome
  if (d.whatsapp !== undefined) l.whatsapp = d.whatsapp
  if (d.chavePix !== undefined) l.chave_pix = d.chavePix
  if (d.pct !== undefined) l.pct = d.pct
  if (d.pctManual !== undefined) l.pct_manual = d.pctManual
  return l
}

export function createIndicadoresRepository(db: Knex): IndicadoresRepository {
  const consulta = () =>
    db('indicadores as i').select<Linha[]>(
      'i.*',
      db.raw(`(select count(*) from vendas v where v.indicador_id = i.id and v.status <> 'CANCELADA')
            + (select count(*) from emprestimos e where e.indicador_id = i.id and e.status <> 'CANCELADA') as operacoes`),
      db.raw('exists (select 1 from users u where u.indicador_id = i.id) as tem_acesso'),
    )
  const buscar = async (id: number) => {
    const l = await consulta().where('i.id', id).first()
    return l ? paraIndicador(l) : null
  }

  return {
    async listar() {
      return (await consulta().orderByRaw('lower(i.nome), i.id')).map(paraIndicador)
    },
    buscar,
    async criar(d) {
      const [{ id }] = await db('indicadores').insert(paraLinha(d)).returning('id')
      return (await buscar(id))!
    },
    async atualizar(id, d) {
      await db('indicadores').where({ id }).update({ ...paraLinha(d), updated_at: db.fn.now() })
      return (await buscar(id))!
    },
    async definirAtivo(id, ativo) {
      await db.transaction(async (trx) => {
        await trx('indicadores').where({ id }).update({ ativo, updated_at: trx.fn.now() })
        const ids = await trx('users').where({ indicador_id: id }).update({ ativo, updated_at: trx.fn.now() }).returning('id')
        if (!ativo && ids.length) await trx('sessoes').whereIn('usuario_id', ids.map((u: { id: number }) => u.id)).whereNull('revogada_em').update({ revogada_em: trx.fn.now() })
      })
      return (await buscar(id))!
    },
    async criarAcesso(indicadorId, d) {
      await db('users').insert({ nome: d.nome, email: d.email.toLowerCase(), senha_hash: d.senhaHash, perfil: 'INDICADOR', indicador_id: indicadorId, senha_temporaria: true })
    },
    async niveis() {
      const ls = await db('niveis_indicador').orderBy('min_operacoes').select<{ id: string; nome: string; min_operacoes: number; pct: string }[]>('*')
      return ls.map((l) => ({ id: l.id, nome: l.nome, minOperacoes: l.min_operacoes, pct: Number(l.pct) }))
    },
    async salvarNiveis(niveis, auto) {
      await db.transaction(async (trx) => {
        // zera os mínimos antes (a coluna é única) para a troca de valores não bater no meio do caminho
        await trx('niveis_indicador').update({ min_operacoes: trx.raw('-1 - min_operacoes') })
        for (const n of niveis) await trx('niveis_indicador').where({ id: n.id }).update({ min_operacoes: n.minOperacoes, pct: n.pct })
        await trx('sistema_config').where({ chave: 'niveis_auto' }).update({ valor: JSON.stringify(auto), updated_at: trx.fn.now() })
      })
    },
    async niveisAuto() {
      const l = await db('sistema_config').where({ chave: 'niveis_auto' }).first<{ valor: unknown } | undefined>('valor')
      return l?.valor === true
    },
  }
}
