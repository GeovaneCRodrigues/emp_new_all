# Conta corrente do indicador — Etapa 1 (back + administrador) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O administrador marca que um recebimento "caiu na conta do indicador", lança o envio do indicador para a loja, marca num empréstimo novo que o dinheiro "saiu da conta do indicador", e vê a conta corrente (saldo + extrato) de cada indicador.

**Architecture:** O saldo **não é gravado**: é a soma de três fontes que já existem ou ganham uma coluna (`transacoes_recebimento.cobrado_por_indicador_id`, `movimentacoes_caixa` tipo `TRANSFERENCIA_INDICADOR`, `emprestimos.saiu_da_conta_*`). Um módulo novo `conta-indicador` (rotas, serviço, repositório) só lê e lança envios. O Caixa já ignora o que o indicador cobrou e já conta a transferência como entrada; só a linha do empréstimo precisa descontar a parte que saiu da conta dele.

**Tech Stack:** Back: Fastify + TypeScript + Knex + Postgres + vitest (testes de integração com Postgres real via `bancoDeTeste()`). Front: Vue 3 + Vite + TS, vitest (ambiente `node`), Playwright (projetos `computador` e `celular`, modo demonstração com fakes).

**Spec:** `docs/superpowers/specs/2026-10-23-conta-corrente-indicador-design.md`. Esta é a **etapa 1** (seção 9 da spec). A etapa 2 (telas do indicador, tabela `envios_indicador` com confirmação) terá plano próprio.

## Global Constraints

- Idioma de textos, mensagens de erro e nomes de domínio: **português**. O Geovane fala português, informal.
- Dinheiro sempre com máscara BRL (`4.000,00`) nas telas; `numeric(15,2)` no banco; `arred2` do back para arredondar.
- Nunca commitar segredos nem `.env`. Commits terminam com a linha `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; PRs terminam com `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- Trabalhar em branch e abrir PR. **Não fazer merge sem o OK explícito do Geovane.**
- O MySQL antigo é só leitura. **Não gravar no banco de produção sem pedido explícito** do Geovane (a migração deste plano roda em produção só depois do OK dele, via `docker compose run --rm back npm run migrate`).
- macOS: `sed -i ''`. Vitest do front roda em ambiente `node` (sem `document`).
- Padrão do back: MVC por módulo (`routes.ts`, `controllers/`, `services/`, `models/`), dependências opcionais em `Deps` do `app.ts` (`if (deps.x) await app.register(...)`), erros por `requisicaoInvalida`/`naoEncontrado`/`semPermissao`/`HttpError`.
- Padrão do front: cada recurso tem `x.ts` (tipos + interface), `x.http.ts`, `x.fake.ts`, ligados em `src/api/recursos.ts`. O fake tem de se comportar como o back (mesmas validações e mensagens).
- Comandos de teste: back `cd back && npx vitest run <arquivo>`; front `cd front && npx vitest run <arquivo>`, `npx vue-tsc --noEmit`, `npx playwright test <arquivo>`.

## Review Focus

Entradas e condições que a spec deixa implícitas e que mais podem morder quem usa:

1. **Desfazer um recebimento que estava na conta do indicador** → o saldo dele cai sozinho (Task 5 testa).
2. **Empréstimo cancelado que usou a conta dele** → o valor volta ao saldo (Task 5 testa).
3. **`saiuDaConta.valor` maior que o capital, zero, negativo, texto, ou indicador inexistente/inativo** → 400 e nada gravado (Task 3 testa).
4. **Indicador tentando ver a conta de outro indicador** → 404 (não 403, para não revelar que existe); cobrador/vendedor → 403 (Task 5 testa).
5. **Envio com valor zero/negativo/texto/data no futuro** → 400; **envio acima do saldo** → aceito (vira crédito dele) (Task 5 testa).
6. **Confirmar a baixa marcando "na conta do indicador" quando a quitação vem do aviso "quitou"** → a transação da quitação também fica marcada e fora do Caixa (Task 4 testa).
7. **Baixa confirmada sem marcar** → continua entrando no Caixa como hoje (regressão; Task 4 testa).

---

## File Structure

**Back (criar)**
- `back/src/db/migrations/20261023120000_conta_corrente_indicador.ts` — colunas em `emprestimos`.
- `back/src/modules/conta-indicador/models/types.ts` — tipos do extrato/saldo.
- `back/src/modules/conta-indicador/models/repository.ts` — SQL do extrato, dos saldos e do lançamento de envio.
- `back/src/modules/conta-indicador/services/conta-indicador.service.ts` — permissões, validação, auditoria.
- `back/src/modules/conta-indicador/controllers/conta-indicador.controller.ts` e `routes.ts`.
- `back/tests/helpers/conta-mundo.ts` — monta app + dados de teste usados por todos os testes novos.
- `back/tests/conta-indicador.test.ts` — testes de integração das tasks 1–5.

**Back (modificar)**
- `back/src/modules/caixa/models/repository.ts` — linha `E` do empréstimo desconta `saiu_da_conta_valor`.
- `back/src/modules/emprestimos/{models/types.ts,models/repository.ts,services/emprestimos.service.ts}` — aceitar `saiuDaConta`.
- `back/src/modules/aprovacoes/{models/types.ts,models/repository.ts,services/aprovacoes.service.ts}` — `naContaDoIndicador` no aviso de baixa.
- `back/src/modules/recebimentos/{models/repository.ts,services/recebimentos.service.ts}` — gravar `cobrado_por_indicador_id` ao confirmar.
- `back/src/app.ts`, `back/src/server.ts` — ligar o módulo novo.

**Front (criar)**
- `front/src/api/contaIndicador.ts`, `contaIndicador.http.ts`, `contaIndicador.fake.ts`, `contaIndicador.fake.test.ts`.
- `front/src/components/LancarEnvioForm.vue` — sheet "Lançar envio".
- `front/src/components/ContaIndicadorFicha.vue` — sheet com saldo e extrato de um indicador.
- `front/e2e/conta-indicador.spec.ts`.

**Front (modificar)**
- `front/src/api/emprestimos.ts`, `emprestimos.fake.ts` — `saiuDaConta`.
- `front/src/api/aprovacoes.ts`, `equipe.fake.ts` — `naContaDoIndicador`.
- `front/src/api/recursos.ts` — ligar o fake/http novo.
- `front/src/components/EmprestimoForm.vue` — campo "De onde sai o dinheiro?".
- `front/src/views/admin/Equipe.vue`, `front/src/components/ReceberSheet.vue` — caixa de marcação "Caiu na conta do indicador".
- `front/src/views/admin/Indicadores.vue` — aba "Conta corrente".

---

### Task 1: Migração e mundo de teste

**Files:**
- Create: `back/src/db/migrations/20261023120000_conta_corrente_indicador.ts`
- Create: `back/tests/helpers/conta-mundo.ts`
- Create: `back/tests/conta-indicador.test.ts`

**Interfaces:**
- Produces (usado por todas as tasks de back): em `emprestimos`, colunas `saiu_da_conta_indicador_id integer null references indicadores(id)` e `saiu_da_conta_valor numeric(15,2) not null default 0`, com check `saiu_da_conta_valor >= 0 and saiu_da_conta_valor <= capital and (saiu_da_conta_valor = 0 or saiu_da_conta_indicador_id is not null)`.
- Produces: `montarMundo(k: Knex, hojeInicial?: string): Promise<Mundo>` onde `Mundo = { app: FastifyInstance; t: Record<string,string>; id: Record<string,number>; req(metodo:'GET'|'POST'|'PATCH'|'DELETE', url:string, papel?:string, payload?:object): ReturnType<FastifyInstance['inject']>; setHoje(d:string): void; limpar(): Promise<void>; emprestimo(corpo?: object): Promise<number> }`. Papéis em `t`: `admin`, `cobrador`, `indicador` (Roberto), `indicador2` (Carla). Ids em `id`: `admin`, `cobrador`, `indicador`, `indicador2` (usuários), `roberto`, `carla` (indicadores), `ana` (cliente).
- O `montarMundo` deste task monta o app **sem** `contaIndicador` e **sem** `caixa`; a Task 2 adiciona `caixa`, a Task 5 adiciona `contaIndicador` (cada uma altera o helper no passo indicado).

- [ ] **Step 1: Escrever o teste que falha (as colunas novas existem)**

`back/tests/conta-indicador.test.ts`:

```ts
import type { Knex } from 'knex'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { bancoDeTeste } from './helpers/db.js'
import { montarMundo, type Mundo } from './helpers/conta-mundo.js'

const db: Knex | null = await bancoDeTeste()

describe.skipIf(!db)('conta corrente do indicador (Postgres de verdade)', () => {
  let m: Mundo
  beforeAll(async () => { m = await montarMundo(db!) })
  beforeEach(async () => { await m.limpar() })
  afterAll(async () => { await m?.app.close(); await db?.destroy() })

  describe('o banco', () => {
    it('empréstimo guarda de onde saiu o dinheiro; o check recusa valor maior que o capital ou sem indicador', async () => {
      const [e] = await db!('emprestimos').insert({ cliente_id: m.id.ana, data_emprestimo: '2026-10-01', capital: 1000, modalidade: 'PARCELADO', taxa: 10, periodicidade: 'MENSAL', saiu_da_conta_indicador_id: m.id.roberto, saiu_da_conta_valor: 600 }).returning('id')
      expect(Number((await db!('emprestimos').where({ id: e.id }).first()).saiu_da_conta_valor)).toBe(600)
      const base = { cliente_id: m.id.ana, data_emprestimo: '2026-10-01', capital: 1000, modalidade: 'PARCELADO', taxa: 10, periodicidade: 'MENSAL' }
      await expect(db!('emprestimos').insert({ ...base, saiu_da_conta_indicador_id: m.id.roberto, saiu_da_conta_valor: 1000.01 })).rejects.toThrow()
      await expect(db!('emprestimos').insert({ ...base, saiu_da_conta_indicador_id: null, saiu_da_conta_valor: 10 })).rejects.toThrow()
      await expect(db!('emprestimos').insert({ ...base, saiu_da_conta_valor: 0 })).resolves.toBeDefined()
    })
  })
})
```

- [ ] **Step 2: Criar o helper `conta-mundo.ts` (monta app e dados)**

`back/tests/helpers/conta-mundo.ts`:

```ts
import type { FastifyInstance } from 'fastify'
import type { Knex } from 'knex'
import { buildApp } from '../../src/app.js'
import { createAprovacoesRepository } from '../../src/modules/aprovacoes/models/repository.js'
import { createAprovacoesService } from '../../src/modules/aprovacoes/services/aprovacoes.service.js'
import { createAuditoriaRepository } from '../../src/modules/auditoria/models/repository.js'
import { createSessoesRepository, createUsuariosRepository } from '../../src/modules/auth/models/repository.js'
import { createAuthService } from '../../src/modules/auth/services/auth.service.js'
import { hashSenha } from '../../src/modules/auth/services/password.js'
import { createTokensService } from '../../src/modules/auth/services/tokens.js'
import { createConfigRepository } from '../../src/modules/config/models/repository.js'
import { createConfigService } from '../../src/modules/config/services/config.service.js'
import { createEmprestimosRepository } from '../../src/modules/emprestimos/models/repository.js'
import { createEmprestimosService } from '../../src/modules/emprestimos/services/emprestimos.service.js'
import { createEstoqueRepository } from '../../src/modules/estoque/models/repository.js'
import { createEstoqueService } from '../../src/modules/estoque/services/estoque.service.js'
import { createIndicadoresRepository } from '../../src/modules/indicadores/models/repository.js'
import { createIndicadoresService } from '../../src/modules/indicadores/services/indicadores.service.js'
import { createRecebimentosRepository } from '../../src/modules/recebimentos/models/repository.js'
import { createRecebimentosService } from '../../src/modules/recebimentos/services/recebimentos.service.js'
import { createVendasRepository } from '../../src/modules/vendas/models/repository.js'
import { createVendasService } from '../../src/modules/vendas/services/vendas.service.js'
import { limparBanco } from './db.js'

export const SENHA = 'senha-forte-123'

export type Mundo = {
  app: FastifyInstance
  t: Record<string, string>
  id: Record<string, number>
  req: (metodo: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, papel?: string, payload?: object) => ReturnType<FastifyInstance['inject']>
  setHoje: (d: string) => void
  /** apaga o que cada teste cria (operações, recebimentos, caixa); usuários, indicadores e o cliente ficam */
  limpar: () => Promise<void>
  /** empréstimo parcelado do cliente Ana com o indicador Roberto (capital 1.000, taxa 30, 2 parcelas); `corpo` sobrescreve campos */
  emprestimo: (corpo?: object) => Promise<number>
}

export async function montarMundo(k: Knex, hojeInicial = '2026-10-08'): Promise<Mundo> {
  let hoje = hojeInicial
  await limparBanco(k)
  const hash = await hashSenha(SENHA)
  const id: Record<string, number> = {}
  for (const [chave, nome] of [['roberto', 'Roberto'], ['carla', 'Carla']] as const) {
    const [i] = await k('indicadores').insert({ nome, pct: 0.5, pct_manual: true }).returning('id'); id[chave] = i.id
  }
  for (const [chave, perfil, extra] of [['admin', 'ADMIN', {}], ['cobrador', 'COBRADOR', {}], ['indicador', 'INDICADOR', { indicador_id: id.roberto }], ['indicador2', 'INDICADOR', { indicador_id: id.carla }]] as const) {
    const [u] = await k('users').insert({ nome: `${chave} Silva`, email: `${chave}@t.com`, senha_hash: hash, perfil, ...extra }).returning('id'); id[chave] = u.id
  }
  const [c] = await k('clientes').insert({ nome: 'Ana Souza', fone: '11988124410' }).returning('id'); id.ana = c.id

  const tokens = createTokensService('x'.repeat(40), '15m')
  const auth = createAuthService(createUsuariosRepository(k), createSessoesRepository(k), tokens)
  const audit = createAuditoriaRepository(k)
  const indicadores = createIndicadoresService(createIndicadoresRepository(k), audit)
  const config = createConfigRepository(k)
  const recebimentos = createRecebimentosService({ repo: createRecebimentosRepository(k), auditoria: audit, hoje: () => hoje })
  const app = await buildApp({
    env: { NODE_ENV: 'test', CORS_ORIGIN: [] }, db: { ping: async () => {} }, tokens, auth, usuarios: {} as never, indicadores,
    clientes: {} as never,
    estoque: createEstoqueService(createEstoqueRepository(k), audit), config: createConfigService(config),
    vendas: createVendasService({ vendas: createVendasRepository(k), config, auditoria: audit, sincronizarNiveis: () => indicadores.sincronizarNiveis(), hoje: () => hoje }),
    emprestimos: createEmprestimosService({ emprestimos: createEmprestimosRepository(k), auditoria: audit, sincronizarNiveis: () => indicadores.sincronizarNiveis(), hoje: () => hoje }),
    recebimentos,
    aprovacoes: createAprovacoesService({ repo: createAprovacoesRepository(k), auditoria: audit, hoje: () => hoje, baixas: { confirmar: (s, pid, e) => recebimentos.confirmarBaixa(s, pid, e) } }),
    fechamentos: {} as never, equipe: {} as never,
    limites: { vendasPorMinuto: 100_000, recebimentosPorMinuto: 100_000 },
  })
  const t: Record<string, string> = {}
  for (const papel of ['admin', 'cobrador', 'indicador', 'indicador2']) {
    t[papel] = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: `${papel}@t.com`, senha: SENHA } })).json().accessToken
  }
  const req: Mundo['req'] = (metodo, url, papel, payload) => app.inject({ method: metodo, url, payload, headers: papel ? { authorization: `Bearer ${t[papel]}` } : {} })
  return {
    app, t, id, req,
    setHoje: (d) => { hoje = d },
    limpar: async () => {
      hoje = hojeInicial
      for (const tb of ['aprovacoes', 'recebimentos', 'transacoes_recebimento', 'movimentacoes_caixa', 'auditoria', 'emprestimo_parcelas', 'emprestimos']) await k(tb).del()
    },
    emprestimo: async (corpo = {}) => {
      const r = await req('POST', '/api/emprestimos', 'admin', { clienteId: id.ana, modalidade: 'PARCELADO', capital: 1000, taxa: 30, parcelas: 2, indicadorId: id.roberto, ...corpo })
      if (r.statusCode !== 201) throw new Error(`empréstimo não criado: ${r.statusCode} ${r.body}`)
      return r.json().id
    },
  }
}
```

- [ ] **Step 3: Rodar o teste e ver falhar**

Run: `cd back && npx vitest run tests/conta-indicador.test.ts`
Expected: FAIL — `column "saiu_da_conta_indicador_id" of relation "emprestimos" does not exist`.

- [ ] **Step 4: Escrever a migração**

`back/src/db/migrations/20261023120000_conta_corrente_indicador.ts`:

```ts
import type { Knex } from 'knex'

/**
 * Conta corrente do indicador com a loja (etapa 1). O saldo não é gravado: é calculado de
 *  - `transacoes_recebimento.cobrado_por_indicador_id` (o dinheiro ficou com o indicador),
 *  - `movimentacoes_caixa` tipo TRANSFERENCIA_INDICADOR (ele enviou à loja),
 *  - `emprestimos.saiu_da_conta_*` (o empréstimo foi pago com o dinheiro que está na conta dele).
 * O Caixa não tira da loja a parte do empréstimo que saiu da conta do indicador.
 */
export async function up(knex: Knex) {
  await knex.schema.alterTable('emprestimos', (t) => {
    t.integer('saiu_da_conta_indicador_id').references('id').inTable('indicadores')
    t.decimal('saiu_da_conta_valor', 15, 2).notNullable().defaultTo(0)
  })
  await knex.raw(`alter table emprestimos add constraint emprestimos_saiu_da_conta_ck
    check (saiu_da_conta_valor >= 0 and saiu_da_conta_valor <= capital and (saiu_da_conta_valor = 0 or saiu_da_conta_indicador_id is not null))`)
}

export async function down(knex: Knex) {
  await knex.raw('alter table emprestimos drop constraint if exists emprestimos_saiu_da_conta_ck')
  await knex.schema.alterTable('emprestimos', (t) => {
    t.dropColumn('saiu_da_conta_valor')
    t.dropColumn('saiu_da_conta_indicador_id')
  })
}
```

- [ ] **Step 5: Rodar o teste e ver passar**

Run: `cd back && npx vitest run tests/conta-indicador.test.ts`
Expected: PASS (1 teste). O helper `bancoDeTeste()` já aplica as migrações novas.

- [ ] **Step 6: Commit**

```bash
git checkout -b conta-corrente-indicador-etapa-1
git add back/src/db/migrations/20261023120000_conta_corrente_indicador.ts back/tests/helpers/conta-mundo.ts back/tests/conta-indicador.test.ts
git commit -m "Conta corrente do indicador: colunas do empréstimo e mundo de teste

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: O Caixa desconta a parte que saiu da conta do indicador

**Files:**
- Modify: `back/src/modules/caixa/models/repository.ts` (linha `E` dentro de `UNIAO`, ~linhas 72-76)
- Modify: `back/tests/helpers/conta-mundo.ts` (adicionar `caixa` ao `buildApp`)
- Test: `back/tests/conta-indicador.test.ts`

**Interfaces:**
- Consumes: `emprestimos.saiu_da_conta_valor` (Task 1); `createCaixaService({ repo, auditoria, hoje })` e `createCaixaRepository(k)`.
- Produces: o extrato do Caixa (`GET /api/caixa`) passa a mostrar, na linha `E<id>` (categoria `EMPRESTIMO`), `valor = capital(+acordos) − saiu_da_conta_valor`; a linha some se o resultado for ≤ 0; `sub` ganha o trecho `R$ 600,00 da conta do indicador` quando `saiu_da_conta_valor > 0`.

- [ ] **Step 1: Escrever os testes que falham**

Acrescentar dentro do `describe` principal de `back/tests/conta-indicador.test.ts` (antes do `})` final), e adicionar o import no topo: nada novo além do já importado.

```ts
  describe('o Caixa', () => {
    const caixa = async () => (await m.req('GET', '/api/caixa', 'admin')).json() as { saldo: number; itens: { chave: string; valor: number; entrada: boolean; categoria: string; sub: string }[] }
    const saidaDoEmprestimo = async (e: number) => (await caixa()).itens.find((i) => i.chave === `E${e}`)

    it('empréstimo pago só pelo Caixa: sai o capital todo (como sempre)', async () => {
      const e = await m.emprestimo()
      expect(await saidaDoEmprestimo(e)).toMatchObject({ valor: 1000, entrada: false, categoria: 'EMPRESTIMO' })
    })
    it('empréstimo pago em parte pela conta do indicador: o Caixa só perde o resto, e o extrato diz de quem foi o dinheiro', async () => {
      const e = await m.emprestimo()
      await db!('emprestimos').where({ id: e }).update({ saiu_da_conta_indicador_id: m.id.roberto, saiu_da_conta_valor: 600 })
      const linha = await saidaDoEmprestimo(e)
      expect(linha).toMatchObject({ valor: 400, entrada: false })
      expect(linha!.sub).toContain('R$ 600,00 da conta do indicador')
    })
    it('empréstimo pago todo pela conta do indicador: não aparece no Caixa', async () => {
      const e = await m.emprestimo()
      await db!('emprestimos').where({ id: e }).update({ saiu_da_conta_indicador_id: m.id.roberto, saiu_da_conta_valor: 1000 })
      expect(await saidaDoEmprestimo(e)).toBeUndefined()
      expect((await caixa()).saldo).toBe(0)
    })
  })
```

- [ ] **Step 2: Adicionar o `caixa` ao helper**

Em `back/tests/helpers/conta-mundo.ts`, acrescentar os imports e o campo no `buildApp`:

```ts
import { createCaixaRepository } from '../../src/modules/caixa/models/repository.js'
import { createCaixaService } from '../../src/modules/caixa/services/caixa.service.js'
```

e, dentro de `buildApp({ ... })`, depois de `recebimentos,`:

```ts
    caixa: createCaixaService({ repo: createCaixaRepository(k), auditoria: audit, hoje: () => hoje }),
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `cd back && npx vitest run tests/conta-indicador.test.ts -t "o Caixa"`
Expected: FAIL — o 2º teste recebe `valor: 1000` (e o 3º ainda acha a linha).

- [ ] **Step 4: Implementar**

Em `back/src/modules/caixa/models/repository.ts`, logo acima de `const UNIAO`, acrescentar a formatação BRL em SQL:

```ts
/** "R$ 1.234,50" escrito no banco, para o extrato dizer quanto veio da conta do indicador. */
const BRL_SQL = (col: string) => `'R$ ' || replace(replace(replace(to_char(${col}, 'FM999,999,999,990.00'), ',', '#'), '.', ','), '#', '.')`
```

Trocar a linha `E` da `UNIAO`. Antes:

```sql
  select 'E' || e.id, e.data_emprestimo, e.capital + coalesce((select sum(a.capital_cedido - a.capital_adicional - a.capital_herdado) from acordos a where a.emprestimo_id = e.id), 0), false, 'EMPRESTIMO', 'Empréstimo liberado · ' || c.nome, ${NOME_EMPRESTIMO_SQL}, null, 'EMPRESTIMO'
  from emprestimos e join clientes c on c.id = e.cliente_id where e.status <> 'CANCELADA' and e.data_emprestimo <= :hoje
    and e.capital + coalesce((select sum(a.capital_cedido - a.capital_adicional - a.capital_herdado) from acordos a where a.emprestimo_id = e.id), 0) > 0
```

Depois (o valor desconta `saiu_da_conta_valor` e o `sub` ganha o trecho da conta do indicador):

```sql
  select 'E' || e.id, e.data_emprestimo,
    e.capital + coalesce((select sum(a.capital_cedido - a.capital_adicional - a.capital_herdado) from acordos a where a.emprestimo_id = e.id), 0) - e.saiu_da_conta_valor,
    false, 'EMPRESTIMO', 'Empréstimo liberado · ' || c.nome,
    concat_ws(' · ', ${NOME_EMPRESTIMO_SQL}, case when e.saiu_da_conta_valor > 0 then ${BRL_SQL('e.saiu_da_conta_valor')} || ' da conta do indicador' end), null, 'EMPRESTIMO'
  from emprestimos e join clientes c on c.id = e.cliente_id where e.status <> 'CANCELADA' and e.data_emprestimo <= :hoje
    and e.capital + coalesce((select sum(a.capital_cedido - a.capital_adicional - a.capital_herdado) from acordos a where a.emprestimo_id = e.id), 0) - e.saiu_da_conta_valor > 0
```

- [ ] **Step 5: Rodar e ver passar (e a suíte do Caixa inteira)**

Run: `cd back && npx vitest run tests/conta-indicador.test.ts tests/caixa.test.ts`
Expected: PASS em todos (os testes antigos do Caixa não mudam: `saiu_da_conta_valor` é 0 por padrão).

- [ ] **Step 6: Commit**

```bash
git add back/src/modules/caixa/models/repository.ts back/tests/helpers/conta-mundo.ts back/tests/conta-indicador.test.ts
git commit -m "Caixa: empréstimo pago com a conta do indicador só tira o resto do caixa

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Empréstimo novo aceita "saiu da conta do indicador"

**Files:**
- Modify: `back/src/modules/emprestimos/models/types.ts` (tipo `NovoEmprestimo`, ~linha 50)
- Modify: `back/src/modules/emprestimos/models/repository.ts` (`criar`, ~linha 88)
- Modify: `back/src/modules/emprestimos/services/emprestimos.service.ts` (`criar`, ~linhas 64-135)
- Test: `back/tests/conta-indicador.test.ts`

**Interfaces:**
- Consumes: colunas da Task 1; `tx.indicadorAtivo(id)` (já existe no `EmprestimosTx`).
- Produces: `POST /api/emprestimos` aceita `saiuDaConta?: { indicadorId: number; valor: number }`. Regras: `valor` é número > 0 e ≤ `capital`; `indicadorId` é inteiro de indicador **ativo**; qualquer outra forma → 400. `NovoEmprestimo.saiuDaConta: { indicadorId: number; valor: number } | null`. A auditoria `EMPRESTIMO_CRIADO` inclui `saiuDaConta`.

- [ ] **Step 1: Escrever os testes que falham**

Dentro do `describe` principal de `back/tests/conta-indicador.test.ts`:

```ts
  describe('empréstimo novo "saiu da conta do indicador"', () => {
    const criar = (extra: object) => m.req('POST', '/api/emprestimos', 'admin', { clienteId: m.id.ana, modalidade: 'PARCELADO', capital: 1000, taxa: 30, parcelas: 2, ...extra })

    it('grava de onde saiu o dinheiro (de qualquer indicador, não só o do empréstimo) e audita', async () => {
      const r = await criar({ indicadorId: m.id.roberto, saiuDaConta: { indicadorId: m.id.carla, valor: 600 } })
      expect(r.statusCode, r.body).toBe(201)
      const l = await db!('emprestimos').where({ id: r.json().id }).first()
      expect(l.saiu_da_conta_indicador_id).toBe(m.id.carla)
      expect(Number(l.saiu_da_conta_valor)).toBe(600)
      const a = await db!('auditoria').where({ acao: 'EMPRESTIMO_CRIADO', entidade_id: r.json().id }).first()
      expect(a.depois.saiuDaConta).toEqual({ indicadorId: m.id.carla, valor: 600 })
    })
    it('sem saiuDaConta, tudo como antes (zero, sem indicador)', async () => {
      const r = await criar({})
      const l = await db!('emprestimos').where({ id: r.json().id }).first()
      expect(l.saiu_da_conta_indicador_id).toBeNull(); expect(Number(l.saiu_da_conta_valor)).toBe(0)
    })
    it('o valor pode ser o capital todo', async () => {
      expect((await criar({ saiuDaConta: { indicadorId: m.id.roberto, valor: 1000 } })).statusCode).toBe(201)
    })
    it.each([
      ['valor maior que o capital', { indicadorId: 1, valor: 1000.01 }], ['valor zero', { indicadorId: 1, valor: 0 }], ['valor negativo', { indicadorId: 1, valor: -5 }],
      ['valor como texto', { indicadorId: 1, valor: '300' }], ['sem valor', { indicadorId: 1 }], ['sem indicador', { valor: 300 }], ['indicador quebrado', { indicadorId: 1.5, valor: 300 }],
      ['indicador inexistente', { indicadorId: 999999, valor: 300 }], ['não é objeto', 'sim'],
    ])('recusa %s (400) e não grava nada', async (_nome, saiuDaConta) => {
      const corpo = typeof saiuDaConta === 'object' && saiuDaConta && 'indicadorId' in saiuDaConta && saiuDaConta.indicadorId === 1 ? { ...saiuDaConta, indicadorId: m.id.roberto } : saiuDaConta
      const r = await criar({ saiuDaConta: corpo })
      expect(r.statusCode, r.body).toBe(400)
      expect(Number((await db!('emprestimos').count('* as n').first() as { n: string }).n)).toBe(0)
    })
    it('indicador desativado não serve', async () => {
      await db!('indicadores').where({ id: m.id.carla }).update({ ativo: false })
      try { expect((await criar({ saiuDaConta: { indicadorId: m.id.carla, valor: 100 } })).statusCode).toBe(400) }
      finally { await db!('indicadores').where({ id: m.id.carla }).update({ ativo: true }) }
    })
  })
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd back && npx vitest run tests/conta-indicador.test.ts -t "saiu da conta do indicador"`
Expected: FAIL — o 1º teste acha `saiu_da_conta_indicador_id` nulo (o campo é ignorado) e as recusas voltam 201.

- [ ] **Step 3: Implementar — tipos**

Em `back/src/modules/emprestimos/models/types.ts`, no tipo `NovoEmprestimo`, acrescentar o campo (junto dos outros, por exemplo depois de `modoDivisao`):

```ts
  /** o dinheiro (ou parte dele) saiu da conta de um indicador, não do Caixa da loja */
  saiuDaConta: { indicadorId: number; valor: number } | null
```

- [ ] **Step 4: Implementar — repositório**

Em `back/src/modules/emprestimos/models/repository.ts`, no `criar` do `tx`, acrescentar duas colunas ao `insert`:

```ts
              capital: d.capital, modalidade: d.modalidade, taxa: d.taxa, periodicidade: d.periodicidade, pula_domingo: d.pulaDomingo, observacoes: d.observacoes, modo_divisao: d.modoDivisao,
              saiu_da_conta_indicador_id: d.saiuDaConta?.indicadorId ?? null, saiu_da_conta_valor: d.saiuDaConta?.valor ?? 0,
```

(substituindo a linha que termina em `modo_divisao: d.modoDivisao,` pelas duas linhas acima).

- [ ] **Step 5: Implementar — serviço**

Em `back/src/modules/emprestimos/services/emprestimos.service.ts`, no `criar`, **depois** da linha `const capital = arred2(e.capital)` acrescentar a leitura/validação:

```ts
      // de onde saiu o dinheiro: do Caixa da loja (padrão) ou, em parte ou todo, da conta de um indicador
      let saiuDaConta: { indicadorId: number; valor: number } | null = null
      if (e.saiuDaConta !== undefined && e.saiuDaConta !== null) {
        const s0 = e.saiuDaConta as Record<string, unknown>
        if (typeof s0 !== 'object' || Array.isArray(s0)) throw requisicaoInvalida('saiuDaConta deve ter o indicador e o valor')
        const indId = inteiro(s0.indicadorId, 'saiuDaConta.indicadorId', 1, 2 ** 31 - 1)
        if (typeof s0.valor !== 'number' || !Number.isFinite(s0.valor) || s0.valor <= 0) throw requisicaoInvalida('saiuDaConta.valor precisa ser maior que zero')
        const valor = arred2(s0.valor)
        if (valor > capital) throw requisicaoInvalida('O que saiu da conta do indicador não pode passar do valor emprestado')
        saiuDaConta = { indicadorId: indId, valor }
      }
```

Dentro do `emTransacao`, logo depois do bloco que busca o `indicador` (o `if (indicadorId !== null) { ... }`), acrescentar:

```ts
        if (saiuDaConta && !(await tx.indicadorAtivo(saiuDaConta.indicadorId))) throw requisicaoInvalida('O indicador da conta não foi encontrado ou está desativado')
```

No `tx.criar({ ... })`, acrescentar `saiuDaConta,` ao objeto (por exemplo depois de `modoDivisao,`):

```ts
          pct: indicador?.pct ?? 0, dataEmprestimo: data, capital, modalidade, taxa, periodicidade, pulaDomingo, observacoes, modoDivisao, saiuDaConta,
```

E na auditoria `EMPRESTIMO_CRIADO`, no objeto `depois`, acrescentar `saiuDaConta,` (depois de `modoDivisao,`).

- [ ] **Step 6: Rodar e ver passar**

Run: `cd back && npx vitest run tests/conta-indicador.test.ts tests/emprestimos.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add back/src/modules/emprestimos back/tests/conta-indicador.test.ts
git commit -m "Empréstimo novo aceita saiuDaConta (dinheiro que saiu da conta de um indicador)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Confirmar a baixa "na conta do indicador"

**Files:**
- Modify: `back/src/modules/aprovacoes/models/types.ts` (campo `baixa`)
- Modify: `back/src/modules/aprovacoes/models/repository.ts` (`criarBaixa`)
- Modify: `back/src/modules/aprovacoes/services/aprovacoes.service.ts` (`pedirBaixa`)
- Modify: `back/src/modules/recebimentos/models/repository.ts` (`baixaDoPedido`, `criarTransacao` e a interface `RecebimentosTx`)
- Modify: `back/src/modules/recebimentos/services/recebimentos.service.ts` (`Contexto`, `registrarCore`, `confirmarBaixa`)
- Test: `back/tests/conta-indicador.test.ts`

**Interfaces:**
- Produces: `POST /api/aprovacoes` (tipo `BAIXA`) aceita `naContaDoIndicador?: boolean` (guardado em `dados`); `Aprovacao.baixa.naContaDoIndicador?: boolean`. `POST /api/aprovacoes/:id/aprovar` aceita `{ naContaDoIndicador?: boolean }`, que **vale mais** que o aviso; se o resultado for `true`, a transação recebe `cobrado_por_indicador_id` = o indicador do usuário que avisou. Funciona também junto de `quitar: true`.
- `RecebimentosTx.criarTransacao(d)` ganha `cobradoPorIndicadorId?: number | null`. `baixaDoPedido(id)` ganha `indicadorId: number | null` e `naConta: boolean`.

- [ ] **Step 1: Escrever os testes que falham**

Dentro do `describe` principal de `back/tests/conta-indicador.test.ts`:

```ts
  describe('confirmar a baixa "na conta do indicador"', () => {
    const avisar = (corpo: object = {}, papel = 'indicador', op?: number) => m.req('POST', '/api/aprovacoes', papel, { tipo: 'BAIXA', alvo: 'EMPRESTIMO', operacaoId: op, parcela: 1, valor: 650, forma: 'PIX', ...corpo })
    const confirmar = (pid: number, corpo: object = {}) => m.req('POST', `/api/aprovacoes/${pid}/aprovar`, 'admin', corpo)
    const ultimaTransacao = async () => db!('transacoes_recebimento').orderBy('id', 'desc').first()
    const caixa = async () => (await m.req('GET', '/api/caixa', 'admin')).json() as { itens: { chave: string }[] }

    it('o aviso guarda a marca; a loja confirma sem mexer e a transação fica no nome do indicador, FORA do Caixa', async () => {
      const e = await m.emprestimo()
      const a = await avisar({ naContaDoIndicador: true }, 'indicador', e)
      expect(a.statusCode, a.body).toBe(201)
      expect(a.json().baixa.naContaDoIndicador).toBe(true)
      expect((await confirmar(a.json().id)).statusCode).toBe(200)
      const t = await ultimaTransacao()
      expect(t.cobrado_por_indicador_id).toBe(m.id.roberto)
      expect((await caixa()).itens.some((i) => i.chave === `R${t.id}`)).toBe(false)
    })
    it('a loja pode DESMARCAR na confirmação (o dinheiro foi para a loja): entra no Caixa como sempre', async () => {
      const e = await m.emprestimo()
      const a = await avisar({ naContaDoIndicador: true }, 'indicador', e)
      expect((await confirmar(a.json().id, { naContaDoIndicador: false })).statusCode).toBe(200)
      const t = await ultimaTransacao()
      expect(t.cobrado_por_indicador_id).toBeNull()
      expect((await caixa()).itens.some((i) => i.chave === `R${t.id}`)).toBe(true)
    })
    it('a loja pode MARCAR na confirmação mesmo que o indicador não tenha marcado', async () => {
      const e = await m.emprestimo()
      const a = await avisar({}, 'indicador', e)
      expect((await confirmar(a.json().id, { naContaDoIndicador: true })).statusCode).toBe(200)
      expect((await ultimaTransacao()).cobrado_por_indicador_id).toBe(m.id.roberto)
    })
    it('sem marcar nada, continua igual a hoje: entra no Caixa, sem indicador na transação', async () => {
      const e = await m.emprestimo()
      const a = await avisar({}, 'indicador', e)
      expect((await confirmar(a.json().id)).statusCode).toBe(200)
      const t = await ultimaTransacao()
      expect(t.cobrado_por_indicador_id).toBeNull()
      expect((await caixa()).itens.some((i) => i.chave === `R${t.id}`)).toBe(true)
    })
    it('quitação vinda do aviso "quitou" + na conta do indicador: a transação da quitação também fica fora do Caixa', async () => {
      const e = await m.emprestimo()
      const total = (await db!('emprestimo_parcelas').where({ emprestimo_id: e })).reduce((s: number, p: { valor: string }) => s + Number(p.valor), 0)
      const a = await avisar({ quitou: true, valor: total, naContaDoIndicador: true }, 'indicador', e)
      expect(a.statusCode, a.body).toBe(201)
      const r = await confirmar(a.json().id, { quitar: true, valor: total })
      expect(r.statusCode, r.body).toBe(200)
      expect((await ultimaTransacao()).cobrado_por_indicador_id).toBe(m.id.roberto)
    })
    it('naContaDoIndicador precisa ser verdadeiro/falso (400) no aviso e na confirmação', async () => {
      const e = await m.emprestimo()
      expect((await avisar({ naContaDoIndicador: 'sim' }, 'indicador', e)).statusCode).toBe(400)
      const a = await avisar({}, 'indicador', e)
      expect((await confirmar(a.json().id, { naContaDoIndicador: 'sim' })).statusCode).toBe(400)
      expect((await db!('aprovacoes').where({ id: a.json().id }).first()).status).toBe('PENDENTE')
    })
  })
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd back && npx vitest run tests/conta-indicador.test.ts -t "confirmar a baixa"`
Expected: FAIL — `baixa.naContaDoIndicador` indefinido e `cobrado_por_indicador_id` nulo.

- [ ] **Step 3: Implementar — aprovações**

`back/src/modules/aprovacoes/models/types.ts`, no campo `baixa`, acrescentar (ao lado de `quitou?`):

```ts
; /** o dinheiro ficou na conta do indicador (não foi para a loja) */ naContaDoIndicador?: boolean
```

(isto é, o tipo passa a ser `{ forma: ...; data: string; comprovante: string | null; quitou?: boolean; naContaDoIndicador?: boolean } | null`).

`back/src/modules/aprovacoes/models/repository.ts`: na assinatura de `criarBaixa` trocar `quitou?: boolean }` por `quitou?: boolean; naContaDoIndicador?: boolean }`; e no `insert` trocar a linha do `dados` por:

```ts
              dados: JSON.stringify({ forma: d.forma, data: d.data, comprovante: d.comprovante, ...(d.quitou ? { quitou: true } : {}), ...(d.naContaDoIndicador ? { naContaDoIndicador: true } : {}) }),
```

`back/src/modules/aprovacoes/services/aprovacoes.service.ts`, em `pedirBaixa`, logo depois do bloco do `quitou` (depois de `if (quitou && alvo !== 'EMPRESTIMO') ...`):

```ts
    if (e.naContaDoIndicador !== undefined && typeof e.naContaDoIndicador !== 'boolean') throw requisicaoInvalida('naContaDoIndicador deve ser verdadeiro ou falso')
    const naContaDoIndicador = e.naContaDoIndicador === true
```

e na chamada `tx.criarBaixa({ ... quitou })` acrescentar `naContaDoIndicador` (`..., comprovante, quitou, naContaDoIndicador })`). Na auditoria `BAIXA_AVISADA`, acrescentar `...(naContaDoIndicador ? { naContaDoIndicador: true } : {})` ao `depois`.

- [ ] **Step 4: Implementar — recebimentos (repositório)**

`back/src/modules/recebimentos/models/repository.ts`:

1. Interface `RecebimentosTx`, `criarTransacao`: trocar a assinatura por
```ts
  criarTransacao(d: { clienteId: number; valorTotal: number; forma: FormaPagamento; data: string; recebidoPor: number; resumo: ResumoRecibo; ajustes?: AjustesTransacao | null; /** o dinheiro ficou com este indicador (fora do Caixa até ele repassar) */ cobradoPorIndicadorId?: number | null }): Promise<{ id: number; numeroRecibo: number }>
```
2. Implementação de `criarTransacao`: acrescentar `cobrado_por_indicador_id: d.cobradoPorIndicadorId ?? null,` ao objeto do `insert` (depois de `ajustes: ...`).
3. Interface do repositório, `baixaDoPedido`: no tipo de retorno trocar `quitou: boolean } | null>` por `quitou: boolean; naConta: boolean; indicadorId: number | null } | null>`.
4. Implementação de `baixaDoPedido`: acrescentar `.leftJoin('users as u', 'u.id', 'a.solicitado_por')` depois do segundo `leftJoin`; no tipo do `.first<...>` acrescentar `indicador_id: number | null` e `naContaDoIndicador?: boolean` dentro de `dados`; na lista de colunas do `first(...)` acrescentar `'u.indicador_id'`; e no `return` acrescentar `naConta: l.dados.naContaDoIndicador === true, indicadorId: l.indicador_id`.

- [ ] **Step 5: Implementar — recebimentos (serviço)**

`back/src/modules/recebimentos/services/recebimentos.service.ts`:

1. No tipo `Contexto`, acrescentar `cobradoPorIndicadorId?: number`.
2. Em `registrarCore`, na chamada `tx.criarTransacao({ ... })`, acrescentar `cobradoPorIndicadorId: ctx.cobradoPorIndicadorId ?? null,`.
3. Em `confirmarBaixa`, logo depois de `const quitando = e.quitar === true`, acrescentar:

```ts
      // o dinheiro ficou na conta do indicador? A decisão da loja vale mais que a marca do aviso
      if (e.naContaDoIndicador !== undefined && typeof e.naContaDoIndicador !== 'boolean') throw requisicaoInvalida('naContaDoIndicador deve ser verdadeiro ou falso')
      const naConta = typeof e.naContaDoIndicador === 'boolean' ? e.naContaDoIndicador : b.naConta
      if (naConta && b.indicadorId === null) throw requisicaoInvalida('Quem avisou não é um indicador: o dinheiro não pode ficar na conta dele')
```

e no objeto do contexto passado a `registrarCore` (o primeiro argumento) acrescentar `...(naConta ? { cobradoPorIndicadorId: b.indicadorId! } : {})`:

```ts
        { escopo: { tipo: 'TODOS' }, perfil: 'ADMIN', usuarioId: b.solicitanteId, sessaoRecibo: s, baixaId: id, confirmadoPor: s.usuarioId, ...(naConta ? { cobradoPorIndicadorId: b.indicadorId! } : {}) },
```

Na auditoria `BAIXA_CONFIRMADA`, acrescentar `...(naConta ? { naContaDoIndicador: true } : {})` ao `depois`.

- [ ] **Step 6: Rodar e ver passar (e as suítes vizinhas)**

Run: `cd back && npx vitest run tests/conta-indicador.test.ts tests/baixa.test.ts tests/recebimentos.test.ts tests/quitar.test.ts`
Expected: PASS em tudo.

- [ ] **Step 7: Commit**

```bash
git add back/src back/tests/conta-indicador.test.ts
git commit -m "Baixa do indicador: a loja confirma marcando que o dinheiro ficou na conta dele (fora do Caixa)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Módulo da conta corrente (saldo, extrato, lançar envio)

**Files:**
- Create: `back/src/modules/conta-indicador/models/types.ts`
- Create: `back/src/modules/conta-indicador/models/repository.ts`
- Create: `back/src/modules/conta-indicador/services/conta-indicador.service.ts`
- Create: `back/src/modules/conta-indicador/controllers/conta-indicador.controller.ts`
- Create: `back/src/modules/conta-indicador/routes.ts`
- Modify: `back/src/app.ts` (Deps + registro), `back/src/server.ts` (criar e passar), `back/tests/helpers/conta-mundo.ts` (passar ao `buildApp`)
- Test: `back/tests/conta-indicador.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 3 e 4 (colunas e marcas); `NOME_EMPRESTIMO_SQL` de `shared/sql.js`; `AuditoriaRepository`.
- Produces — HTTP (todas exigem login):
  - `GET /api/contas-indicadores` (admin) → `{ itens: { indicador: { id, nome, ativo }, saldo: number }[] }`
  - `GET /api/indicadores/:id/conta?pagina=1&limite=50` (admin; indicador só a própria, senão 404) → `ContaIndicador`
  - `POST /api/indicadores/:id/conta/envios` (admin) corpo `{ valor: number; data?: 'AAAA-MM-DD'; comprovante?: string; lado?: 'EMPRESTIMO'|'IPHONE' }` → 201 `ContaIndicador`
- `ContaIndicador = { indicador: { id: number; nome: string }; saldo: number; cobrou: number; enviou: number; emprestou: number; itens: LinhaConta[]; total: number; pagina: number; limite: number }`; `LinhaConta = { chave: string; data: string; valor: number; tipo: 'COBROU'|'ENVIOU'|'EMPRESTIMO'; titulo: string; sub: string }`.
- Regra: `saldo = cobrou − enviou − emprestou` (positivo: ele deve à loja).
- Serviço: `createContaIndicadorService(dep: { repo: ContaIndicadorRepository; auditoria: AuditoriaRepository; hoje?: () => string }): ContaIndicadorService` com `saldos(s)`, `ver(s, indicadorId, q)`, `lancarEnvio(s, indicadorId, corpo)`.

- [ ] **Step 1: Escrever os testes que falham**

Dentro do `describe` principal de `back/tests/conta-indicador.test.ts`:

```ts
  describe('a conta corrente', () => {
    const conta = async (ind: number, papel = 'admin') => m.req('GET', `/api/indicadores/${ind}/conta`, papel)
    const envio = (ind: number, corpo: object, papel = 'admin') => m.req('POST', `/api/indicadores/${ind}/conta/envios`, papel, corpo)
    /** uma transação (e o recebimento) cobrada pelo indicador, para o saldo contar */
    async function cobrouDoCliente(ind: number, valor: number, data = '2026-10-05', desfeita = false) {
      const e = await m.emprestimo()
      const [p] = await db!('emprestimo_parcelas').where({ emprestimo_id: e }).orderBy('numero').limit(1)
      const [t] = await db!('transacoes_recebimento').insert({
        numero_recibo: Math.floor(Math.random() * 1e9), cliente_id: m.id.ana, valor_total: valor, forma_pagamento: 'PIX', data_recebimento: data,
        cobrado_por_indicador_id: ind, desfeita_em: desfeita ? new Date() : null, resumo: JSON.stringify({ referencia: 'parcela 1/2' }),
      }).returning('id')
      await db!('recebimentos').insert({ transacao_id: t.id, tipo: 'PARCELA', emprestimo_parcela_id: p.id, valor })
      return { empId: e, transacaoId: t.id as number }
    }

    it('conta vazia: saldo zero', async () => {
      const r = await conta(m.id.roberto)
      expect(r.statusCode).toBe(200)
      expect(r.json()).toMatchObject({ indicador: { id: m.id.roberto, nome: 'Roberto' }, saldo: 0, cobrou: 0, enviou: 0, emprestou: 0, itens: [], total: 0 })
    })
    it('saldo = cobrou − enviou − emprestou, e o extrato traz cada lançamento com seu tipo', async () => {
      await cobrouDoCliente(m.id.roberto, 1500)
      expect((await envio(m.id.roberto, { valor: 400, data: '2026-10-07', comprovante: 'E2E1' })).statusCode).toBe(201)
      await m.emprestimo({ saiuDaConta: { indicadorId: m.id.roberto, valor: 300 } })
      const r = (await conta(m.id.roberto)).json()
      expect(r).toMatchObject({ saldo: 800, cobrou: 1500, enviou: 400, emprestou: 300, total: 3 })
      expect(r.itens.map((i: { tipo: string }) => i.tipo).sort()).toEqual(['COBROU', 'EMPRESTIMO', 'ENVIOU'])
      expect(r.itens.find((i: { tipo: string }) => i.tipo === 'ENVIOU')).toMatchObject({ valor: 400, data: '2026-10-07', sub: 'E2E1' })
      expect(r.itens.find((i: { tipo: string }) => i.tipo === 'COBROU')).toMatchObject({ valor: 1500, titulo: 'Ana Souza', sub: 'parcela 1/2' })
    })
    it('o envio entra no Caixa na data (já contava como "Repasse do indicador") e o que o indicador cobrou não', async () => {
      await cobrouDoCliente(m.id.roberto, 1500)
      await envio(m.id.roberto, { valor: 400, data: '2026-10-07' })
      const cx = (await m.req('GET', '/api/caixa', 'admin')).json() as { saldo: number; itens: { categoria: string; valor: number }[] }
      expect(cx.itens.filter((i) => i.categoria === 'TRANSFERENCIA')).toHaveLength(1)
      expect(cx.itens.find((i) => i.categoria === 'TRANSFERENCIA')!.valor).toBe(400)
      expect(cx.itens.some((i) => i.categoria === 'RECEBIMENTO')).toBe(false)
    })
    it('um indicador não mexe na conta do outro', async () => {
      await cobrouDoCliente(m.id.roberto, 1500)
      expect((await conta(m.id.carla)).json().saldo).toBe(0)
    })
    it('DESFAZER o recebimento tira do saldo sozinho', async () => {
      await cobrouDoCliente(m.id.roberto, 1500)
      const { transacaoId } = await cobrouDoCliente(m.id.roberto, 200)
      expect((await conta(m.id.roberto)).json().saldo).toBe(1700)
      await db!('transacoes_recebimento').where({ id: transacaoId }).update({ desfeita_em: new Date() })
      expect((await conta(m.id.roberto)).json().saldo).toBe(1500)
    })
    it('empréstimo CANCELADO devolve o valor ao saldo', async () => {
      await cobrouDoCliente(m.id.roberto, 1000)
      const e = await m.emprestimo({ saiuDaConta: { indicadorId: m.id.roberto, valor: 600 } })
      expect((await conta(m.id.roberto)).json().saldo).toBe(400)
      await db!('emprestimos').where({ id: e }).update({ status: 'CANCELADA' })
      expect((await conta(m.id.roberto)).json().saldo).toBe(1000)
    })
    it('envio acima do saldo é aceito (vira crédito do indicador: saldo negativo)', async () => {
      expect((await envio(m.id.roberto, { valor: 250 })).statusCode).toBe(201)
      expect((await conta(m.id.roberto)).json().saldo).toBe(-250)
    })
    it('paginação do extrato (limite e página)', async () => {
      for (let i = 0; i < 3; i++) await envio(m.id.roberto, { valor: 10 + i, data: `2026-10-0${i + 1}` })
      const r = (await m.req('GET', `/api/indicadores/${m.id.roberto}/conta?pagina=2&limite=2`, 'admin')).json()
      expect(r).toMatchObject({ total: 3, pagina: 2, limite: 2 })
      expect(r.itens).toHaveLength(1)
    })
    it.each([
      ['valor zero', { valor: 0 }], ['valor negativo', { valor: -1 }], ['valor como texto', { valor: '100' }], ['sem valor', {}], ['valor gigante', { valor: 1e9 }],
      ['data no futuro', { valor: 10, data: '2026-10-09' }], ['data inválida', { valor: 10, data: '2026-02-31' }], ['comprovante enorme', { valor: 10, comprovante: 'x'.repeat(121) }],
      ['lado inventado', { valor: 10, lado: 'CARRO' }],
    ])('envio com %s é recusado (400) e não grava', async (_n, corpo) => {
      expect((await envio(m.id.roberto, corpo)).statusCode).toBe(400)
      expect(await db!('movimentacoes_caixa').count('* as n').first().then((l) => Number((l as { n: string }).n))).toBe(0)
    })
    it('indicador inexistente: 404', async () => {
      expect((await conta(999999)).statusCode).toBe(404)
      expect((await envio(999999, { valor: 10 })).statusCode).toBe(404)
    })
    it('permissões: lançar envio só o administrador; o indicador vê só a própria conta (a do outro é 404); cobrador 403; sem login 401', async () => {
      for (const papel of ['indicador', 'indicador2', 'cobrador']) expect((await envio(m.id.roberto, { valor: 10 }, papel)).statusCode).toBe(403)
      expect((await m.req('POST', `/api/indicadores/${m.id.roberto}/conta/envios`, undefined, { valor: 10 })).statusCode).toBe(401)
      expect((await conta(m.id.roberto, 'indicador')).statusCode).toBe(200)
      expect((await conta(m.id.roberto, 'indicador2')).statusCode).toBe(404)
      expect((await conta(m.id.roberto, 'cobrador')).statusCode).toBe(403)
      expect((await m.req('GET', `/api/indicadores/${m.id.roberto}/conta`)).statusCode).toBe(401)
    })
    it('a lista de saldos é só do administrador e traz todos os indicadores', async () => {
      await cobrouDoCliente(m.id.roberto, 900)
      const r = await m.req('GET', '/api/contas-indicadores', 'admin')
      expect(r.statusCode).toBe(200)
      expect(r.json().itens.find((i: { indicador: { id: number } }) => i.indicador.id === m.id.roberto).saldo).toBe(900)
      expect(r.json().itens.find((i: { indicador: { id: number } }) => i.indicador.id === m.id.carla).saldo).toBe(0)
      expect((await m.req('GET', '/api/contas-indicadores', 'indicador')).statusCode).toBe(403)
    })
    it('lançar envio audita', async () => {
      await envio(m.id.roberto, { valor: 77 })
      const a = await db!('auditoria').where({ acao: 'ENVIO_INDICADOR_LANCADO' }).first()
      expect(a.depois).toMatchObject({ indicadorId: m.id.roberto, valor: 77 })
    })
  })
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd back && npx vitest run tests/conta-indicador.test.ts -t "a conta corrente"`
Expected: FAIL — rotas inexistentes (404 em todos os `GET`/`POST`).

- [ ] **Step 3: Implementar — tipos**

`back/src/modules/conta-indicador/models/types.ts`:

```ts
/** O que cada linha do extrato é: o indicador ficou com dinheiro de cliente, enviou à loja, ou o dinheiro dele pagou um empréstimo. */
export type TipoLinhaConta = 'COBROU' | 'ENVIOU' | 'EMPRESTIMO'

export type LinhaConta = { chave: string; data: string; valor: number; tipo: TipoLinhaConta; titulo: string; sub: string }

export type ResumoConta = { saldo: number; cobrou: number; enviou: number; emprestou: number }

export type ContaIndicador = ResumoConta & {
  indicador: { id: number; nome: string }
  itens: LinhaConta[]
  total: number
  pagina: number
  limite: number
}

export type SaldoIndicador = { indicador: { id: number; nome: string; ativo: boolean }; saldo: number }
```

- [ ] **Step 4: Implementar — repositório**

`back/src/modules/conta-indicador/models/repository.ts`:

```ts
import type { Knex } from 'knex'
import { NOME_EMPRESTIMO_SQL } from '../../../shared/sql.js'
import type { LinhaConta, ResumoConta, SaldoIndicador, TipoLinhaConta } from './types.js'

export interface ContaIndicadorRepository {
  indicador(id: number): Promise<{ id: number; nome: string; ativo: boolean } | null>
  resumo(indicadorId: number, hoje: string): Promise<ResumoConta>
  extrato(indicadorId: number, f: { hoje: string; limite: number; offset: number }): Promise<{ itens: LinhaConta[]; total: number }>
  saldos(hoje: string): Promise<SaldoIndicador[]>
  /** O indicador enviou dinheiro à loja: entra no Caixa (como "Repasse do indicador") e baixa o saldo dele. */
  lancarEnvio(d: { indicadorId: number; valor: number; data: string; comprovante: string | null; lado: 'EMPRESTIMO' | 'IPHONE' | null; usuarioId: number }): Promise<void>
}

const dia = (d: Date | string) => (typeof d === 'string' ? d : d.toISOString()).slice(0, 10)

/**
 * Tudo o que mexe na conta do indicador, uma linha por lançamento. `deve` = true aumenta o que ele deve à loja.
 *  COBROU: recebimento que ficou com ele (não desfeito)  ·  ENVIOU: transferência dele à loja  ·  EMPRESTIMO: empréstimo pago com a conta dele (não cancelado)
 */
const UNIAO = `
  select 'C' || t.id as chave, t.cobrado_por_indicador_id as ind, t.data_recebimento as data, t.valor_total as valor, true as deve, 'COBROU' as tipo,
    c.nome as titulo, coalesce(t.resumo->>'referencia', 'recebimento') as sub
  from transacoes_recebimento t join clientes c on c.id = t.cliente_id
  where t.cobrado_por_indicador_id is not null and t.desfeita_em is null and t.data_recebimento <= :hoje
 union all
  select 'T' || m.id, m.indicador_id, m.data, m.valor, false, 'ENVIOU', 'Enviou para a loja', coalesce(nullif(trim(m.obs), ''), 'transferência')
  from movimentacoes_caixa m where m.tipo = 'TRANSFERENCIA_INDICADOR' and m.indicador_id is not null and m.data <= :hoje
 union all
  select 'E' || e.id, e.saiu_da_conta_indicador_id, e.data_emprestimo, e.saiu_da_conta_valor, false, 'EMPRESTIMO', 'Empréstimo · ' || c.nome, ${NOME_EMPRESTIMO_SQL}
  from emprestimos e join clientes c on c.id = e.cliente_id
  where e.saiu_da_conta_indicador_id is not null and e.saiu_da_conta_valor > 0 and e.status <> 'CANCELADA' and e.data_emprestimo <= :hoje`

const dele = (db: Knex, hoje: string) => db.from(db.raw(`(${UNIAO}) as m`, { hoje }))

export function createContaIndicadorRepository(db: Knex): ContaIndicadorRepository {
  return {
    async indicador(id) {
      const l = await db('indicadores').where({ id }).first<{ id: number; nome: string; ativo: boolean } | undefined>('id', 'nome', 'ativo')
      return l ?? null
    },

    async resumo(indicadorId, hoje) {
      const l = await dele(db, hoje).where('m.ind', indicadorId).first<{ cobrou: string; enviou: string; emprestou: string }>(
        db.raw("coalesce(sum(m.valor) filter (where m.tipo = 'COBROU'), 0) as cobrou"),
        db.raw("coalesce(sum(m.valor) filter (where m.tipo = 'ENVIOU'), 0) as enviou"),
        db.raw("coalesce(sum(m.valor) filter (where m.tipo = 'EMPRESTIMO'), 0) as emprestou"),
      )
      const cobrou = Number(l!.cobrou), enviou = Number(l!.enviou), emprestou = Number(l!.emprestou)
      return { cobrou, enviou, emprestou, saldo: Math.round((cobrou - enviou - emprestou) * 100) / 100 }
    },

    async extrato(indicadorId, f) {
      const [{ n }] = await dele(db, f.hoje).where('m.ind', indicadorId).select<{ n: string }[]>(db.raw('count(*) as n'))
      const ls = await dele(db, f.hoje).where('m.ind', indicadorId).select<{ chave: string; data: Date | string; valor: string; tipo: TipoLinhaConta; titulo: string; sub: string }[]>('m.chave', 'm.data', 'm.valor', 'm.tipo', 'm.titulo', 'm.sub')
        .orderByRaw('m.data desc, m.chave desc').limit(f.limite).offset(f.offset)
      return { total: Number(n), itens: ls.map((l) => ({ chave: l.chave, data: dia(l.data), valor: Number(l.valor), tipo: l.tipo, titulo: l.titulo, sub: l.sub })) }
    },

    async saldos(hoje) {
      const somas = await dele(db, hoje).groupBy('m.ind').select<{ ind: number; saldo: string }[]>('m.ind', db.raw('sum(case when m.deve then m.valor else -m.valor end) as saldo'))
      const por = new Map(somas.map((s) => [s.ind, Math.round(Number(s.saldo) * 100) / 100]))
      const is = await db('indicadores').orderBy('nome').select<{ id: number; nome: string; ativo: boolean }[]>('id', 'nome', 'ativo')
      return is.map((i) => ({ indicador: { id: i.id, nome: i.nome, ativo: i.ativo }, saldo: por.get(i.id) ?? 0 }))
    },

    async lancarEnvio(d) {
      await db('movimentacoes_caixa').insert({ tipo: 'TRANSFERENCIA_INDICADOR', valor: d.valor, data: d.data, obs: d.comprovante, usuario_id: d.usuarioId, indicador_id: d.indicadorId, lado: d.lado })
    },
  }
}
```

- [ ] **Step 5: Implementar — serviço**

`back/src/modules/conta-indicador/services/conta-indicador.service.ts`:

```ts
import { naoEncontrado, requisicaoInvalida, semPermissao } from '../../../shared/errors.js'
import type { Sessao } from '../../../shared/perfis.js'
import { hojeBR } from '../../../shared/relogio.js'
import type { AuditoriaRepository } from '../../auditoria/models/repository.js'
import type { ContaIndicadorRepository } from '../models/repository.js'
import type { ContaIndicador, SaldoIndicador } from '../models/types.js'

export type ContaIndicadorService = {
  /** O saldo de cada indicador (administrador). */
  saldos(s: Sessao): Promise<{ itens: SaldoIndicador[] }>
  /** A conta de um indicador: o administrador vê qualquer uma; o indicador só a própria. */
  ver(s: Sessao, indicadorId: number, q: { pagina?: number; limite?: number }): Promise<ContaIndicador>
  /** O indicador enviou dinheiro à loja (administrador): entra no Caixa e baixa o saldo dele. */
  lancarEnvio(s: Sessao, indicadorId: number, corpo: Record<string, unknown>): Promise<ContaIndicador>
}

const LIMITE_MAX = 100
const DINHEIRO_MAX = 100_000_000
const DATA = /^\d{4}-\d{2}-\d{2}$/
const dataValida = (v: unknown): v is string => typeof v === 'string' && DATA.test(v) && new Date(v + 'T12:00:00Z').toISOString().slice(0, 10) === v

export function createContaIndicadorService(dep: { repo: ContaIndicadorRepository; auditoria: AuditoriaRepository; hoje?: () => string }): ContaIndicadorService {
  const hoje = dep.hoje ?? (() => hojeBR())

  async function montar(indicadorId: number, pagina: number, limite: number): Promise<ContaIndicador> {
    const ind = await dep.repo.indicador(indicadorId)
    if (!ind) throw naoEncontrado('Indicador não encontrado')
    const dia = hoje()
    const [resumo, ext] = await Promise.all([dep.repo.resumo(indicadorId, dia), dep.repo.extrato(indicadorId, { hoje: dia, limite, offset: (pagina - 1) * limite })])
    return { indicador: { id: ind.id, nome: ind.nome }, ...resumo, itens: ext.itens, total: ext.total, pagina, limite }
  }

  return {
    async saldos(s) {
      if (s.perfil !== 'ADMIN') throw semPermissao('Só o administrador vê as contas dos indicadores')
      return { itens: await dep.repo.saldos(hoje()) }
    },

    async ver(s, indicadorId, q) {
      if (s.perfil === 'INDICADOR') {
        // 404 (não 403) para não revelar que o outro indicador existe
        if (s.indicadorId !== indicadorId) throw naoEncontrado('Indicador não encontrado')
      } else if (s.perfil !== 'ADMIN') throw semPermissao('Você não tem acesso à conta do indicador')
      const limite = Math.min(Math.max(Math.trunc(q.limite ?? 50) || 50, 1), LIMITE_MAX)
      const pagina = Math.max(Math.trunc(q.pagina ?? 1) || 1, 1)
      return montar(indicadorId, pagina, limite)
    },

    async lancarEnvio(s, indicadorId, corpo) {
      if (s.perfil !== 'ADMIN') throw semPermissao('Só o administrador lança o envio do indicador')
      const ind = await dep.repo.indicador(indicadorId)
      if (!ind) throw naoEncontrado('Indicador não encontrado')
      if (typeof corpo.valor !== 'number' || !Number.isFinite(corpo.valor) || corpo.valor <= 0 || corpo.valor > DINHEIRO_MAX) throw requisicaoInvalida('Informe quanto o indicador enviou (maior que zero)')
      const valor = Math.round(corpo.valor * 100) / 100
      const dia = hoje()
      const data = corpo.data === undefined || corpo.data === null ? dia : corpo.data
      if (!dataValida(data)) throw requisicaoInvalida('data precisa ser uma data válida (AAAA-MM-DD)')
      if (data > dia) throw requisicaoInvalida('A data do envio não pode ser no futuro')
      let comprovante: string | null = null
      if (corpo.comprovante !== undefined && corpo.comprovante !== null && corpo.comprovante !== '') {
        if (typeof corpo.comprovante !== 'string' || corpo.comprovante.trim().length > 120) throw requisicaoInvalida('comprovante: no máximo 120 letras')
        comprovante = corpo.comprovante.trim() || null
      }
      let lado: 'EMPRESTIMO' | 'IPHONE' | null = null
      if (corpo.lado !== undefined && corpo.lado !== null) {
        if (corpo.lado !== 'EMPRESTIMO' && corpo.lado !== 'IPHONE') throw requisicaoInvalida('lado deve ser EMPRESTIMO ou IPHONE')
        lado = corpo.lado
      }
      await dep.repo.lancarEnvio({ indicadorId, valor, data, comprovante, lado, usuarioId: s.usuarioId })
      await dep.auditoria.registrar({ usuarioId: s.usuarioId, acao: 'ENVIO_INDICADOR_LANCADO', entidade: 'indicador', entidadeId: indicadorId, depois: { indicadorId, valor, data, comprovante, lado } })
      return montar(indicadorId, 1, 50)
    },
  }
}
```

- [ ] **Step 6: Implementar — controller e rotas**

`back/src/modules/conta-indicador/controllers/conta-indicador.controller.ts`:

```ts
import type { FastifyReply, FastifyRequest } from 'fastify'
import { naoAutenticado, requisicaoInvalida } from '../../../shared/errors.js'
import type { ContaIndicadorService } from '../services/conta-indicador.service.js'

const sessaoOuErro = (req: FastifyRequest) => req.sessao ?? (() => { throw naoAutenticado() })()
function idDaRota(req: FastifyRequest): number {
  const id = Number((req.params as { id?: string }).id)
  if (!Number.isInteger(id) || id <= 0) throw requisicaoInvalida('Id inválido')
  return id
}
const numero = (v: unknown) => (v === undefined ? undefined : Number(v))

export function createContaIndicadorController(service: ContaIndicadorService) {
  return {
    async saldos(req: FastifyRequest) { return service.saldos(sessaoOuErro(req)) },
    async ver(req: FastifyRequest) {
      const q = (req.query ?? {}) as { pagina?: string; limite?: string }
      return service.ver(sessaoOuErro(req), idDaRota(req), { pagina: numero(q.pagina), limite: numero(q.limite) })
    },
    async lancarEnvio(req: FastifyRequest, reply: FastifyReply) {
      return reply.code(201).send(await service.lancarEnvio(sessaoOuErro(req), idDaRota(req), (req.body ?? {}) as Record<string, unknown>))
    },
  }
}
```

`back/src/modules/conta-indicador/routes.ts`:

```ts
import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify'
import { createContaIndicadorController } from './controllers/conta-indicador.controller.js'
import type { ContaIndicadorService } from './services/conta-indicador.service.js'

export function contaIndicadorRoutes(service: ContaIndicadorService, auth: preHandlerAsyncHookHandler) {
  const c = createContaIndicadorController(service)
  const p = { preHandler: auth }
  return async (app: FastifyInstance) => {
    // quem pode o quê fica no service; aqui só exige estar logado
    app.get('/contas-indicadores', p, c.saldos)
    app.get('/indicadores/:id/conta', p, c.ver)
    app.post('/indicadores/:id/conta/envios', p, c.lancarEnvio)
  }
}
```

- [ ] **Step 7: Ligar no app, no servidor e no helper**

`back/src/app.ts`: acrescentar o import

```ts
import { contaIndicadorRoutes } from './modules/conta-indicador/routes.js'
import type { ContaIndicadorService } from './modules/conta-indicador/services/conta-indicador.service.js'
```

no tipo `Deps`, depois de `repasses?: RepassesService`:

```ts
  contaIndicador?: ContaIndicadorService
```

e no `buildApp`, depois da linha `if (deps.repasses) ...`:

```ts
  if (deps.contaIndicador) await app.register(contaIndicadorRoutes(deps.contaIndicador, exigir), { prefix: '/api' })
```

`back/src/server.ts`: acrescentar os imports

```ts
import { createContaIndicadorRepository } from './modules/conta-indicador/models/repository.js'
import { createContaIndicadorService } from './modules/conta-indicador/services/conta-indicador.service.js'
```

criar o serviço (depois de `const repasses = ...`):

```ts
const contaIndicador = createContaIndicadorService({ repo: createContaIndicadorRepository(db.knex), auditoria: createAuditoriaRepository(db.knex) })
```

e passar `contaIndicador` na chamada de `buildApp({ ..., repasses, contaIndicador, propostas, ... })`.

`back/tests/helpers/conta-mundo.ts`: acrescentar os imports

```ts
import { createContaIndicadorRepository } from '../../src/modules/conta-indicador/models/repository.js'
import { createContaIndicadorService } from '../../src/modules/conta-indicador/services/conta-indicador.service.js'
```

e no `buildApp`, depois do campo `caixa:`:

```ts
    contaIndicador: createContaIndicadorService({ repo: createContaIndicadorRepository(k), auditoria: audit, hoje: () => hoje }),
```

- [ ] **Step 8: Rodar e ver passar**

Run: `cd back && npx tsc --noEmit && npx vitest run tests/conta-indicador.test.ts`
Expected: PASS em todos (Tasks 1–5), sem erro de tipos.

- [ ] **Step 9: Suíte inteira do back**

Run: `cd back && npx vitest run`
Expected: PASS (todos os arquivos).

- [ ] **Step 10: Commit**

```bash
git add back/src back/tests
git commit -m "Conta corrente do indicador: saldo, extrato e lançar envio (módulo novo)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Front — contrato, http e fake da conta corrente

**Files:**
- Create: `front/src/api/contaIndicador.ts`, `front/src/api/contaIndicador.http.ts`, `front/src/api/contaIndicador.fake.ts`, `front/src/api/contaIndicador.fake.test.ts`
- Modify: `front/src/api/emprestimos.ts` (campo `saiuDaConta` em `EntradaEmprestimo`), `front/src/api/emprestimos.fake.ts` (validar e registrar), `front/src/api/aprovacoes.ts` (`naContaDoIndicador`), `front/src/api/equipe.fake.ts` (marca + registrar), `front/src/api/vendas.fake.ts` (tipo `baixa`), `front/src/api/recursos.ts` (ligar)

**Interfaces:**
- Produces (contrato `front/src/api/contaIndicador.ts`):

```ts
export type TipoLinhaContaApi = 'COBROU' | 'ENVIOU' | 'EMPRESTIMO'
export interface LinhaContaApi { chave: string; data: string; valor: number; tipo: TipoLinhaContaApi; titulo: string; sub: string }
export interface ContaIndicadorApi { indicador: { id: number; nome: string }; saldo: number; cobrou: number; enviou: number; emprestou: number; itens: LinhaContaApi[]; total: number; pagina: number; limite: number }
export interface SaldoIndicadorApi { indicador: { id: number; nome: string; ativo: boolean }; saldo: number }
export interface EntradaEnvio { valor: number; data?: string; comprovante?: string; lado?: 'EMPRESTIMO' | 'IPHONE' }
export interface ContasIndicadorApi {
  saldos(s: Sessao): Promise<SaldoIndicadorApi[]>
  ver(s: Sessao, indicadorId: number, q?: { pagina?: number; limite?: number }): Promise<ContaIndicadorApi>
  lancarEnvio(s: Sessao, indicadorId: number, e: EntradaEnvio): Promise<ContaIndicadorApi>
}
```

- `criarContaIndicadorFake(dep: { indicadores: IndicadoresApi; hoje: () => string }): ContaIndicadorFake` onde `ContaIndicadorFake = ContasIndicadorApi & { _interno: { cobrou(indicadorId: number, l: { data: string; valor: number; titulo: string; sub: string }): void; emprestou(indicadorId: number, l: { data: string; valor: number; titulo: string }): void } }`. O fake nasce com dados de demonstração: o indicador de id 1 **cobrou R$ 1.200,00 (Carlos Henrique, 05 do mês anterior)** e **enviou R$ 400,00**; saldo inicial dele = 800.
- `EntradaEmprestimo.saiuDaConta?: { indicadorId: number; valor: number }`; `AprovacaoApi.baixa.naContaDoIndicador?: boolean`; `DecisaoBaixa.naContaDoIndicador?: boolean`; `pedirBaixa(..., { ..., naContaDoIndicador?: boolean })`.
- `criarEmprestimosFake(dep: { clientes; indicadores; conta?: ContaIndicadorFake })` e `criarAprovacoesFake(vendas, emprestimos?, acordos?, recebimentos?, conta?: ContaIndicadorFake)`.

- [ ] **Step 1: Escrever o teste do fake que falha**

`front/src/api/contaIndicador.fake.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import type { Sessao } from '@/domain/escopo'
import { ErroApi } from './clientes'
import { criarContaIndicadorFake, type ContaIndicadorFake } from './contaIndicador.fake'
import { criarIndicadoresFake } from './indicadores.fake'

const ADMIN: Sessao = { perfil: 'ADMIN', usuarioId: 1 }
const COBR: Sessao = { perfil: 'COBRADOR', usuarioId: 3 }
const IND1: Sessao = { perfil: 'INDICADOR', indicadorId: 1 }
const IND2: Sessao = { perfil: 'INDICADOR', indicadorId: 2 }
const falha = async (p: Promise<unknown>) => p.then(() => null, (e: ErroApi) => e)

let conta: ContaIndicadorFake
beforeEach(() => { conta = criarContaIndicadorFake({ indicadores: criarIndicadoresFake(), hoje: () => '2026-10-08' }) })

describe('conta corrente do indicador (demonstração)', () => {
  it('nasce com o indicador 1 devendo 800 (cobrou 1.200, enviou 400) e os outros zerados', async () => {
    const lista = await conta.saldos(ADMIN)
    expect(lista.find((s) => s.indicador.id === 1)!.saldo).toBe(800)
    expect(lista.filter((s) => s.indicador.id !== 1).every((s) => s.saldo === 0)).toBe(true)
    const c = await conta.ver(ADMIN, 1)
    expect(c).toMatchObject({ saldo: 800, cobrou: 1200, enviou: 400, emprestou: 0, total: 2 })
  })
  it('lançar envio baixa o saldo; acima do saldo vira crédito (negativo)', async () => {
    expect((await conta.lancarEnvio(ADMIN, 1, { valor: 300, comprovante: 'PIX1' })).saldo).toBe(500)
    expect((await conta.lancarEnvio(ADMIN, 1, { valor: 600 })).saldo).toBe(-100)
  })
  it('cobrou e emprestou (vindos dos outros fakes) entram no saldo e no extrato', async () => {
    conta._interno.cobrou(2, { data: '2026-10-08', valor: 500, titulo: 'Ana', sub: 'parcela 1/2' })
    conta._interno.emprestou(2, { data: '2026-10-08', valor: 200, titulo: 'Empréstimo · Ana' })
    const c = await conta.ver(ADMIN, 2)
    expect(c).toMatchObject({ saldo: 300, cobrou: 500, emprestou: 200, total: 2 })
  })
  it.each([['valor zero', { valor: 0 }], ['valor negativo', { valor: -1 }], ['valor como texto', { valor: '100' }], ['sem valor', {}], ['data no futuro', { valor: 10, data: '2026-10-09' }], ['data inválida', { valor: 10, data: '2026-02-31' }], ['lado inventado', { valor: 10, lado: 'CARRO' }]])('envio com %s: 400', async (_n, e) => {
    expect((await falha(conta.lancarEnvio(ADMIN, 1, e as never)))?.status).toBe(400)
    expect((await conta.ver(ADMIN, 1)).enviou).toBe(400)
  })
  it('permissões: lançar só o administrador; indicador vê só a própria (a de outro é 404); cobrador 403; indicador inexistente 404', async () => {
    expect((await falha(conta.lancarEnvio(IND1, 1, { valor: 10 })))?.status).toBe(403)
    expect((await conta.ver(IND1, 1)).saldo).toBe(800)
    expect((await falha(conta.ver(IND2, 1)))?.status).toBe(404)
    expect((await falha(conta.ver(COBR, 1)))?.status).toBe(403)
    expect((await falha(conta.saldos(IND1)))?.status).toBe(403)
    expect((await falha(conta.ver(ADMIN, 999)))?.status).toBe(404)
    expect((await falha(conta.lancarEnvio(ADMIN, 999, { valor: 10 })))?.status).toBe(404)
  })
  it('paginação do extrato', async () => {
    for (let i = 0; i < 3; i++) await conta.lancarEnvio(ADMIN, 1, { valor: 10 + i })
    const c = await conta.ver(ADMIN, 1, { pagina: 2, limite: 2 })
    expect(c).toMatchObject({ total: 5, pagina: 2, limite: 2 })
    expect(c.itens).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd front && npx vitest run src/api/contaIndicador.fake.test.ts`
Expected: FAIL — `Failed to resolve import "./contaIndicador.fake"`.

- [ ] **Step 3: Criar o contrato e o http**

`front/src/api/contaIndicador.ts`: exatamente o bloco de **Interfaces** acima, com `import type { Sessao } from '@/domain/escopo'` no topo.

`front/src/api/contaIndicador.http.ts`:

```ts
import { ErroApi } from './clientes'
import type { ContasIndicadorApi } from './contaIndicador'

type Requisicao = (url: string, init?: RequestInit) => Promise<Response>

export function criarContaIndicadorHttp(baseUrl: string, requisicao: Requisicao): ContasIndicadorApi {
  async function chamar<T>(caminho: string, init: RequestInit = {}): Promise<T> {
    let r: Response
    try {
      r = await requisicao(`${baseUrl}/api${caminho}`, { ...init, headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers } })
    } catch {
      throw new ErroApi(0, 'Sem conexão com o servidor. Tente de novo.')
    }
    const corpo = await r.json().catch(() => ({}))
    if (!r.ok) throw new ErroApi(r.status, corpo.erro ?? 'Algo deu errado. Tente de novo.', corpo.codigo)
    return corpo as T
  }
  return {
    saldos: async () => (await chamar<{ itens: Awaited<ReturnType<ContasIndicadorApi['saldos']>> }>('/contas-indicadores')).itens,
    ver: (_s, id, q) => chamar(`/indicadores/${id}/conta${q ? `?pagina=${q.pagina ?? 1}&limite=${q.limite ?? 50}` : ''}`),
    lancarEnvio: (_s, id, e) => chamar(`/indicadores/${id}/conta/envios`, { method: 'POST', body: JSON.stringify(e) }),
  }
}
```

- [ ] **Step 4: Criar o fake**

`front/src/api/contaIndicador.fake.ts`:

```ts
import type { Sessao } from '@/domain/escopo'
import { arred2 } from '@/domain/format'
import { ErroApi } from './clientes'
import type { ContaIndicadorApi, ContasIndicadorApi, EntradaEnvio, LinhaContaApi, SaldoIndicadorApi, TipoLinhaContaApi } from './contaIndicador'
import type { IndicadoresApi } from './indicadores'

export type ContaIndicadorFake = ContasIndicadorApi & {
  _interno: {
    /** o dinheiro de um cliente ficou na conta do indicador (baixa confirmada com a marca) */
    cobrou(indicadorId: number, l: { data: string; valor: number; titulo: string; sub: string }): void
    /** um empréstimo foi pago com o dinheiro da conta do indicador */
    emprestou(indicadorId: number, l: { data: string; valor: number; titulo: string }): void
  }
}

type Reg = LinhaContaApi & { ind: number }

const dataValida = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(v + 'T12:00:00Z').toISOString().slice(0, 10) === v
const erro = (m: string) => new ErroApi(400, m)

export function criarContaIndicadorFake(dep: { indicadores: IndicadoresApi; hoje: () => string }): ContaIndicadorFake {
  let seq = 0
  const regs: Reg[] = []
  const adicionar = (ind: number, tipo: TipoLinhaContaApi, l: { data: string; valor: number; titulo: string; sub: string }) => {
    regs.push({ chave: `${tipo[0]}${++seq}`, ind, tipo, data: l.data, valor: arred2(l.valor), titulo: l.titulo, sub: l.sub })
  }
  // demonstração: o indicador 1 cobrou de um cliente e já enviou uma parte para a loja
  const mesAnterior = `${dep.hoje().slice(0, 7)}-05`
  adicionar(1, 'COBROU', { data: mesAnterior, valor: 1200, titulo: 'Carlos Henrique', sub: 'parcela 1/4' })
  adicionar(1, 'ENVIOU', { data: dep.hoje(), valor: 400, titulo: 'Enviou para a loja', sub: 'transferência' })

  const resumo = (ind: number) => {
    const soma = (t: TipoLinhaContaApi) => arred2(regs.filter((r) => r.ind === ind && r.tipo === t).reduce((s, r) => s + r.valor, 0))
    const cobrou = soma('COBROU'), enviou = soma('ENVIOU'), emprestou = soma('EMPRESTIMO')
    return { cobrou, enviou, emprestou, saldo: arred2(cobrou - enviou - emprestou) }
  }
  async function indicador(s: Sessao, id: number) {
    const i = (await dep.indicadores.listar({ perfil: 'ADMIN', usuarioId: 1 })).find((x) => x.id === id)
    if (!i) throw new ErroApi(404, 'Indicador não encontrado', 'NAO_ENCONTRADO')
    return i
  }
  async function montar(s: Sessao, id: number, pagina: number, limite: number): Promise<ContaIndicadorApi> {
    const i = await indicador(s, id)
    const dele = regs.filter((r) => r.ind === id).sort((a, b) => b.data.localeCompare(a.data) || b.chave.localeCompare(a.chave))
    const itens = dele.slice((pagina - 1) * limite, pagina * limite).map(({ ind: _ind, ...l }) => l)
    return { indicador: { id: i.id, nome: i.nome }, ...resumo(id), itens, total: dele.length, pagina, limite }
  }

  return {
    async saldos(s) {
      if (s.perfil !== 'ADMIN') throw new ErroApi(403, 'Só o administrador vê as contas dos indicadores', 'SEM_PERMISSAO')
      const lista = await dep.indicadores.listar(s)
      return lista.map((i): SaldoIndicadorApi => ({ indicador: { id: i.id, nome: i.nome, ativo: i.ativo }, saldo: resumo(i.id).saldo }))
    },
    async ver(s, id, q) {
      if (s.perfil === 'INDICADOR') {
        if (s.indicadorId !== id) throw new ErroApi(404, 'Indicador não encontrado', 'NAO_ENCONTRADO')
      } else if (s.perfil !== 'ADMIN') throw new ErroApi(403, 'Você não tem acesso à conta do indicador', 'SEM_PERMISSAO')
      return montar(s, id, Math.max(Math.trunc(q?.pagina ?? 1) || 1, 1), Math.min(Math.max(Math.trunc(q?.limite ?? 50) || 50, 1), 100))
    },
    async lancarEnvio(s, id, e: EntradaEnvio) {
      if (s.perfil !== 'ADMIN') throw new ErroApi(403, 'Só o administrador lança o envio do indicador', 'SEM_PERMISSAO')
      await indicador(s, id)
      if (typeof e.valor !== 'number' || !Number.isFinite(e.valor) || e.valor <= 0 || e.valor > 1e8) throw erro('Informe quanto o indicador enviou (maior que zero)')
      const hoje = dep.hoje()
      const data = e.data ?? hoje
      if (!dataValida(data)) throw erro('data precisa ser uma data válida (AAAA-MM-DD)')
      if (data > hoje) throw erro('A data do envio não pode ser no futuro')
      if (e.comprovante !== undefined && e.comprovante !== '' && (typeof e.comprovante !== 'string' || e.comprovante.trim().length > 120)) throw erro('comprovante: no máximo 120 letras')
      if (e.lado !== undefined && e.lado !== 'EMPRESTIMO' && e.lado !== 'IPHONE') throw erro('lado deve ser EMPRESTIMO ou IPHONE')
      adicionar(id, 'ENVIOU', { data, valor: e.valor, titulo: 'Enviou para a loja', sub: e.comprovante?.trim() || 'transferência' })
      return montar(s, id, 1, 50)
    },
    _interno: {
      cobrou: (ind, l) => adicionar(ind, 'COBROU', l),
      emprestou: (ind, l) => adicionar(ind, 'EMPRESTIMO', { ...l, sub: 'saiu da conta dele' }),
    },
  }
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `cd front && npx vitest run src/api/contaIndicador.fake.test.ts`
Expected: PASS.

- [ ] **Step 6: Escrever os testes que falham dos outros fakes (empréstimo e baixa)**

Acrescentar ao fim de `front/src/api/baixa.fake.test.ts`:

```ts
describe('baixa "na conta do indicador" (demonstração)', () => {
  it('confirmar com a marca coloca o valor na conta do indicador; sem marca, não; a loja pode desmarcar', async () => {
    const { criarContaIndicadorFake } = await import('./contaIndicador.fake')
    const indicadores = criarIndicadoresFake()
    const conta = criarContaIndicadorFake({ indicadores, hoje: () => '2026-10-08' })
    const clientes = criarClientesFake(); const est = criarEstoqueFake()
    const v2 = criarVendasFake({ estoque: est, indicadores, clientes })
    const e2 = criarEmprestimosFake({ clientes, indicadores, conta })
    const r2 = criarRecebimentosFake(v2, e2)
    const a2 = criarAprovacoesFake(v2, e2, undefined, r2, conta)
    const op = (await e2.criar(ADMIN, { clienteId: 3, modalidade: 'PARCELADO', capital: 1000, taxa: 30, parcelas: 2, indicadorId: 1 })).id
    const antes = (await conta.ver(ADMIN, 1)).saldo
    const p1 = await a2.pedirBaixa(IND1, { alvo: 'EMPRESTIMO', operacaoId: op, parcela: 1, valor: 650, forma: 'PIX', naContaDoIndicador: true })
    expect(p1.baixa).toMatchObject({ naContaDoIndicador: true })
    await a2.aprovar(ADMIN, p1.id)
    expect((await conta.ver(ADMIN, 1)).saldo).toBe(antes + 650)
    const p2 = await a2.pedirBaixa(IND1, { alvo: 'EMPRESTIMO', operacaoId: op, parcela: 2, valor: 650, forma: 'PIX', naContaDoIndicador: true })
    await a2.aprovar(ADMIN, p2.id, { naContaDoIndicador: false })
    expect((await conta.ver(ADMIN, 1)).saldo).toBe(antes + 650) // desmarcou: nada na conta
    expect((await falha(a2.pedirBaixa(IND1, { alvo: 'EMPRESTIMO', operacaoId: op, parcela: 2, valor: 1, forma: 'PIX', naContaDoIndicador: 'sim' } as never)))?.status).toBe(400)
  })
})
```

e criar `front/src/api/emprestimos-conta.fake.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { Sessao } from '@/domain/escopo'
import { ErroApi } from './clientes'
import { criarClientesFake } from './clientes.fake'
import { criarContaIndicadorFake } from './contaIndicador.fake'
import { criarEmprestimosFake } from './emprestimos.fake'
import { criarIndicadoresFake } from './indicadores.fake'

const ADMIN: Sessao = { perfil: 'ADMIN', usuarioId: 1 }
const falha = async (p: Promise<unknown>) => p.then(() => null, (e: ErroApi) => e)

function mundo() {
  const clientes = criarClientesFake(); const indicadores = criarIndicadoresFake()
  const conta = criarContaIndicadorFake({ indicadores, hoje: () => '2026-10-08' })
  return { conta, emp: criarEmprestimosFake({ clientes, indicadores, conta }) }
}
const base = { clienteId: 3, modalidade: 'PARCELADO' as const, capital: 1000, taxa: 30, parcelas: 2 }

describe('empréstimo "saiu da conta do indicador" (demonstração)', () => {
  it('registra na conta do indicador (de qualquer indicador) e baixa o saldo', async () => {
    const { conta, emp } = mundo()
    await emp.criar(ADMIN, { ...base, indicadorId: 1, saiuDaConta: { indicadorId: 2, valor: 600 } })
    expect(await conta.ver(ADMIN, 2)).toMatchObject({ saldo: -600, emprestou: 600 })
  })
  it('valor igual ao capital vale; sem saiuDaConta nada muda', async () => {
    const { conta, emp } = mundo()
    await emp.criar(ADMIN, { ...base, saiuDaConta: { indicadorId: 2, valor: 1000 } })
    await emp.criar(ADMIN, { ...base })
    expect((await conta.ver(ADMIN, 2)).emprestou).toBe(1000)
  })
  it.each([['maior que o capital', { indicadorId: 2, valor: 1000.01 }], ['zero', { indicadorId: 2, valor: 0 }], ['negativo', { indicadorId: 2, valor: -5 }], ['texto', { indicadorId: 2, valor: '300' }], ['sem indicador', { valor: 300 }], ['indicador inexistente', { indicadorId: 999, valor: 300 }]])('valor %s: 400 e nada é criado', async (_n, saiuDaConta) => {
    const { conta, emp } = mundo()
    const antes = (await emp.listar(ADMIN, { limite: 200 })).total
    expect((await falha(emp.criar(ADMIN, { ...base, saiuDaConta } as never)))?.status).toBe(400)
    expect((await emp.listar(ADMIN, { limite: 200 })).total).toBe(antes)
    expect((await conta.ver(ADMIN, 2)).emprestou).toBe(0)
  })
})
```

- [ ] **Step 7: Rodar e ver falhar**

Run: `cd front && npx vitest run src/api/baixa.fake.test.ts src/api/emprestimos-conta.fake.test.ts`
Expected: FAIL — `conta` ignorado nos fakes e `naContaDoIndicador` desconhecido.

- [ ] **Step 8: Implementar nos fakes e tipos**

`front/src/api/emprestimos.ts`, em `EntradaEmprestimo`, depois de `observacoes?: string`:

```ts
  /** o dinheiro (ou parte) saiu da conta de um indicador, não do Caixa da loja; não pode passar do capital */
  saiuDaConta?: { indicadorId: number; valor: number }
```

`front/src/api/emprestimos.fake.ts`: a assinatura vira `criarEmprestimosFake(dep: { clientes: ClientesApi; indicadores: IndicadoresFake; conta?: ContaIndicadorFake })` (acrescentar `import type { ContaIndicadorFake } from './contaIndicador.fake'`). No `criar`, **logo depois** da linha `const capital = arred2(e.capital)` (e antes de `const reg: RegistroEmprestimo = {`), acrescentar:

```ts
      let saiuDaConta: { indicadorId: number; valor: number } | null = null
      if (e.saiuDaConta !== undefined && e.saiuDaConta !== null) {
        const s0 = e.saiuDaConta as unknown as Record<string, unknown>
        if (typeof s0 !== 'object' || Array.isArray(s0)) throw erro('saiuDaConta deve ter o indicador e o valor')
        const indId = inteiro(s0.indicadorId, 'saiuDaConta.indicadorId', 1, 2 ** 31 - 1)
        if (typeof s0.valor !== 'number' || !Number.isFinite(s0.valor) || s0.valor <= 0) throw erro('saiuDaConta.valor precisa ser maior que zero')
        const valor = arred2(s0.valor)
        if (valor > capital) throw erro('O que saiu da conta do indicador não pode passar do valor emprestado')
        if (!dep.indicadores._interno.ativo(indId)) throw erro('O indicador da conta não foi encontrado ou está desativado')
        saiuDaConta = { indicadorId: indId, valor }
      }
```

e, **depois** de `registros.push(reg)` (antes de `return calcular(reg, s.perfil)`), acrescentar:

```ts
      if (saiuDaConta) dep.conta?._interno.emprestou(saiuDaConta.indicadorId, { data, valor: saiuDaConta.valor, titulo: `Empréstimo · ${cliente.nome}` })
```

`front/src/api/aprovacoes.ts`: em `baixa` (tipo `AprovacaoApi`), acrescentar `; /** o dinheiro ficou na conta do indicador */ naContaDoIndicador?: boolean`; em `DecisaoBaixa`, acrescentar `/** a loja decide se o dinheiro ficou na conta do indicador (vale mais que o aviso) */ naContaDoIndicador?: boolean`; no `pedirBaixa`, acrescentar `naContaDoIndicador?: boolean` ao objeto de entrada.

`front/src/api/vendas.fake.ts`: no tipo `baixa?:` do `Pedido`, acrescentar `naContaDoIndicador?: boolean`.

`front/src/api/equipe.fake.ts`: a assinatura vira `criarAprovacoesFake(vendas, emprestimos?, acordos?, recebimentos?, conta?: ContaIndicadorFake)` (importar o tipo). Em `pedirBaixa`, antes de `const valor = arred2(e.valor)`:

```ts
      if (e.naContaDoIndicador !== undefined && typeof e.naContaDoIndicador !== 'boolean') throw erro('naContaDoIndicador deve ser verdadeiro ou falso')
```

e no objeto `baixa:` do `Pedido` novo acrescentar `...(e.naContaDoIndicador ? { naContaDoIndicador: true } : {})`. Em `aprovar`, no ramo `p.tipo === 'BAIXA'`, depois das validações do `quitar` e antes de chamar `registrarComo`:

```ts
        if (e?.naContaDoIndicador !== undefined && typeof e.naContaDoIndicador !== 'boolean') throw erro('naContaDoIndicador deve ser verdadeiro ou falso')
        const naConta = typeof e?.naContaDoIndicador === 'boolean' ? e.naContaDoIndicador : p.baixa.naContaDoIndicador === true
```

e, **depois** da chamada `registrarComo(...)` (o `const r = await ...`), antes de marcar o pedido como aprovado:

```ts
        if (naConta) conta?._interno.cobrou(p.solicitanteId - 10_000, { data: p.baixa.data, valor: r.recibo.valor, titulo: r.recibo.cliente.nome, sub: r.recibo.referencia })
```

(`p.solicitanteId - 10_000` é o id do indicador no fake: ver `idSolicitante`.)

- [ ] **Step 9: Ligar em `recursos.ts`**

Em `front/src/api/recursos.ts`: importar

```ts
import type { ContasIndicadorApi } from './contaIndicador'
import { criarContaIndicadorFake } from './contaIndicador.fake'
import { criarContaIndicadorHttp } from './contaIndicador.http'
```

Depois da linha `const vendasFake = ...` (o fake de vendas já existe), criar o fake da conta e passá-lo aos demais:

```ts
const contaFake = vendasFake ? criarContaIndicadorFake({ indicadores: indicadoresApi, hoje: () => vendasFake._interno.hoje }) : null
export const contaIndicadorApi: ContasIndicadorApi = contaFake ?? criarContaIndicadorHttp(URL_API, requisicao)
```

Trocar a criação do `emprestimosFake` por `criarEmprestimosFake({ clientes: clientesFake!, indicadores: indicadoresFake!, ...(contaFake ? { conta: contaFake } : {}) })` e a de `aprovacoesApi` por `criarAprovacoesFake(vendasFake, emprestimosFake!, acordosFake!, recebimentosFake!, contaFake ?? undefined)`.

- [ ] **Step 10: Rodar tudo do front que já existia e os novos**

Run: `cd front && npx vue-tsc --noEmit && npx vitest run`
Expected: PASS (todos).

- [ ] **Step 11: Commit**

```bash
git add front/src/api
git commit -m "Front: contrato, http e fake da conta corrente do indicador; marcas nos empréstimos e nas baixas

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Front — "De onde sai o dinheiro?" no empréstimo novo

**Files:**
- Modify: `front/src/components/EmprestimoForm.vue`
- Test: `front/e2e/conta-indicador.spec.ts` (criado aqui; ganha mais testes nas Tasks 8–9)

**Interfaces:**
- Consumes: `EntradaEmprestimo.saiuDaConta` (Task 6); `indicadoresApi.opcoes(sessao)` (já usado na tela, preenche `indicadores`).
- Produces: no passo 1 do formulário, depois de "Indicador (opcional)", um campo "De onde sai o dinheiro?" com duas opções (`data-origem="CAIXA"` e `data-origem="CONTA"`). Em "Conta do indicador": `<select id="eOrigemInd" data-origem-ind>` + `MoneyInput id="eOrigemValor"` (`data-origem-valor`), com a regra: o valor é obrigatório, > 0 e ≤ o capital; o botão de avançar/salvar respeita o `problemaPasso`.

- [ ] **Step 1: Escrever o teste de ponta a ponta que falha**

`front/e2e/conta-indicador.spec.ts`:

```ts
import { expect, test } from '@playwright/test'
import { confirmarEmprestimo, entrar, navegar, preencherEmprestimo } from './helpers'

const numero = (t: string) => Number(t.replace(/[^\d,-]/g, '').replace(',', '.'))

test.describe('conta corrente do indicador (administrador)', () => {
  test('empréstimo novo "saiu da conta do indicador": a conta do indicador mostra o empréstimo e o saldo cai', async ({ page }) => {
    await entrar(page)
    await preencherEmprestimo(page, { capital: '100000', n: 2, taxa: 10 }) // R$ 1.000,00
    await page.locator('[data-origem="CONTA"]').click()
    await page.locator('[data-origem-ind]').selectOption({ index: 1 })
    await page.locator('#eOrigemValor').fill('60000') // R$ 600,00
    const nomeInd = (await page.locator('[data-origem-ind] option:checked').innerText()).trim()
    await confirmarEmprestimo(page)
    await expect(page.getByTestId('dados-admin')).toContainText('1.000,00')
    await navegar(page, '/indicadores')
    await page.getByRole('button', { name: /Conta corrente/ }).click()
    const linha = page.locator('[data-conta]').filter({ hasText: nomeInd })
    await expect(linha).toBeVisible()
    await linha.click()
    const ficha = page.getByRole('dialog')
    await expect(ficha.locator('[data-lancamento="EMPRESTIMO"]').first()).toContainText('600,00')
  })

  test('não deixa a conta do indicador passar do valor do empréstimo', async ({ page }) => {
    await entrar(page)
    await preencherEmprestimo(page, { capital: '100000', n: 2, taxa: 10 })
    await page.locator('[data-origem="CONTA"]').click()
    await page.locator('[data-origem-ind]').selectOption({ index: 1 })
    await page.locator('#eOrigemValor').fill('100001') // R$ 1.000,01
    await expect(page.getByTestId('problema-origem')).toContainText('não pode passar')
    await expect(page.getByRole('button', { name: 'Continuar' })).toBeDisabled()
  })
})
```

(O teste 1 só passa por inteiro depois da Task 9, que cria a aba "Conta corrente"; a Task 7 só precisa fazer o 2º passar e o 1º chegar até criar o empréstimo. Rode o 2º agora; o 1º fica para a Task 9.)

- [ ] **Step 2: Rodar o 2º teste e ver falhar**

Run: `cd front && npx playwright test e2e/conta-indicador.spec.ts -g "não deixa a conta" --project=computador`
Expected: FAIL — `[data-origem="CONTA"]` não existe.

- [ ] **Step 3: Implementar no `EmprestimoForm.vue`**

No `<script setup>`: acrescentar ao `reactive` `f` os campos `origem: 'CAIXA' as 'CAIXA' | 'CONTA', origemIndicadorId: 0, origemValor: 0`, e zerá-los no `Object.assign(f, { ... })` do reset (linha ~48: acrescentar `origem: 'CAIXA', origemIndicadorId: 0, origemValor: 0`). Acrescentar a regra, junto do `problemaPasso` (use o mesmo estilo da função; a mensagem de problema do passo 1 deve incluir esta checagem). Primeiro, uma `computed` própria:

```ts
/** de onde sai o dinheiro: Caixa da loja (padrão) ou a conta de um indicador (todo ou parte) */
const problemaOrigem = computed(() => {
  if (f.origem !== 'CONTA') return ''
  if (!f.origemIndicadorId) return 'Escolha de qual indicador saiu o dinheiro.'
  if (!(f.origemValor > 0)) return 'Informe quanto saiu da conta do indicador.'
  if (f.origemValor > f.capital + 0.004) return 'O que saiu da conta do indicador não pode passar do valor emprestado.'
  return ''
})
```

e fazer o `problemaPasso(1)` (a função que valida o passo 1) devolver `problemaOrigem.value` quando não houver outro problema do passo 1 (acrescente `|| problemaOrigem.value` ao retorno do ramo do passo 1; se a função usar `if (passo === 1) { ... return '' }`, troque o `return ''` final desse ramo por `return problemaOrigem.value`).

No `salvar()`, no objeto passado a `emprestimosApi.criar`, acrescentar depois do `...(f.indicadorId ? ...)`:

```ts
      ...(f.origem === 'CONTA' ? { saiuDaConta: { indicadorId: f.origemIndicadorId, valor: f.origemValor } } : {}),
```

No `<template>`, logo **depois** do bloco `<div class="field"><label for="eInd">Indicador (opcional)</label>...</div>`:

```html
        <div class="field"><label>De onde sai o dinheiro?</label>
          <div class="pills" data-testid="origem">
            <button type="button" class="pill" :class="{ on: f.origem === 'CAIXA' }" data-origem="CAIXA" @click="f.origem = 'CAIXA'">Caixa da loja</button>
            <button type="button" class="pill" :class="{ on: f.origem === 'CONTA' }" data-origem="CONTA" @click="f.origem = 'CONTA'">Conta do indicador</button>
          </div>
        </div>
        <template v-if="f.origem === 'CONTA'">
          <div class="field"><label for="eOrigemInd">Conta de qual indicador?</label>
            <div class="inp"><select id="eOrigemInd" v-model.number="f.origemIndicadorId" data-origem-ind><option :value="0">Escolha…</option><option v-for="i in indicadores" :key="i.id" :value="i.id">{{ i.nome }}</option></select></div>
          </div>
          <div class="field"><label for="eOrigemValor">Quanto saiu da conta dele?</label><MoneyInput id="eOrigemValor" v-model="f.origemValor" data-origem-valor />
            <div class="small">Pode ser o valor todo ou só uma parte; o resto sai do Caixa da loja.</div>
          </div>
          <div v-if="problemaOrigem" class="small" role="status" style="color: var(--bad)" data-testid="problema-origem">{{ problemaOrigem }}</div>
        </template>
```

- [ ] **Step 4: Rodar e ver passar (o 2º teste) e a regressão dos empréstimos**

Run: `cd front && npx vue-tsc --noEmit && npx playwright test e2e/conta-indicador.spec.ts -g "não deixa a conta" e2e/emprestimos.spec.ts`
Expected: PASS (o 1º teste de `conta-indicador.spec.ts` ainda não é executado aqui).

- [ ] **Step 5: Commit**

```bash
git add front/src/components/EmprestimoForm.vue front/e2e/conta-indicador.spec.ts
git commit -m "Empréstimo novo: de onde sai o dinheiro (Caixa da loja ou conta do indicador)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Front — "Caiu na conta do indicador" ao confirmar a baixa

**Files:**
- Modify: `front/src/views/admin/Equipe.vue`, `front/src/components/ReceberSheet.vue`
- Test: `front/e2e/conta-indicador.spec.ts`

**Interfaces:**
- Consumes: `DecisaoBaixa.naContaDoIndicador`, `AprovacaoApi.baixa.naContaDoIndicador` (Task 6); `ReceberSheet` `alvo.aviso` (já existe da entrega "Quitou tudo").
- Produces: em cada cartão de aviso de baixa da Equipe, uma caixa de marcação `<input type="checkbox" data-na-conta>` "Caiu na conta de {primeiro nome}" que já vem marcada se o indicador marcou; o valor vai em `aprovar(..., { naContaDoIndicador })` (sempre explícito: `true` ou `false`). No fluxo "Conferir quitação" (`ReceberSheet` com `aviso`), a mesma caixa (`data-na-conta`) aparece e o valor vai junto de `quitar`. `alvo.aviso` ganha `naConta: boolean` e `indicador: string` (nome para o texto).

- [ ] **Step 1: Escrever os testes de ponta a ponta que falham**

Acrescentar a `front/e2e/conta-indicador.spec.ts` (e importar `verComo` de `./helpers`; atualizar o import: `import { confirmarEmprestimo, entrar, navegar, preencherEmprestimo, verComo } from './helpers'`):

```ts
test.describe('baixa que caiu na conta do indicador', () => {
  /** O indicador avisa a primeira parcela atrasada dele; devolve o nome do cliente e o do indicador, já como administrador. */
  async function avisarEIrParaEquipe(page: import('@playwright/test').Page) {
    await entrar(page, 'indicador')
    await navegar(page, '/cobranca')
    const linha = page.locator('.cob').first()
    const cliente = (await linha.locator('.t').first().innerText()).trim()
    await linha.getByRole('button', { name: 'Recebi' }).click()
    await page.getByRole('button', { name: 'Avisar a loja que recebi' }).click()
    await expect(page.getByText(/Aviso enviado/)).toBeVisible()
    await verComo(page, 'Admin')
    await navegar(page, '/equipe')
    return cliente
  }
  const card = (page: import('@playwright/test').Page, cliente: string) => page.getByTestId('pedido').filter({ has: page.locator('[data-tipo="BAIXA"]'), hasText: cliente })

  test('a loja marca "caiu na conta" ao confirmar: o valor aparece como COBROU na conta do indicador', async ({ page }) => {
    const cliente = await avisarEIrParaEquipe(page)
    const c = card(page, cliente)
    const indicador = (await c.locator('[data-tipo="BAIXA"]').innerText()).split(' ')[0]
    await expect(c.locator('[data-na-conta]')).not.toBeChecked()
    await c.locator('[data-na-conta]').check()
    await c.locator('[data-confirmar]').click()
    await expect(page.getByTestId('recibo')).toBeVisible()
    await page.keyboard.press('Escape')
    await navegar(page, '/indicadores')
    await page.getByRole('button', { name: /Conta corrente/ }).click()
    await page.locator('[data-conta]').filter({ hasText: indicador }).click()
    await expect(page.getByRole('dialog').locator('[data-lancamento="COBROU"]').filter({ hasText: cliente.split(' ')[0] })).toBeVisible()
  })

  test('sem marcar, o valor NÃO vai para a conta do indicador (continua indo para a loja)', async ({ page }) => {
    const cliente = await avisarEIrParaEquipe(page)
    const c = card(page, cliente)
    const indicador = (await c.locator('[data-tipo="BAIXA"]').innerText()).split(' ')[0]
    await navegar(page, '/indicadores')
    await page.getByRole('button', { name: /Conta corrente/ }).click()
    const saldoAntes = numero(await page.locator('[data-conta]').filter({ hasText: indicador }).locator('[data-saldo]').innerText())
    await navegar(page, '/equipe')
    await card(page, cliente).locator('[data-confirmar]').click()
    await expect(page.getByTestId('recibo')).toBeVisible()
    await page.keyboard.press('Escape')
    await navegar(page, '/indicadores')
    await page.getByRole('button', { name: /Conta corrente/ }).click()
    expect(numero(await page.locator('[data-conta]').filter({ hasText: indicador }).locator('[data-saldo]').innerText())).toBe(saldoAntes)
  })
})
```

- [ ] **Step 2: Implementar em `Equipe.vue`**

No `<script setup>`, junto das variáveis da baixa (perto de `const decidindo = ref...`):

```ts
/** A marca "caiu na conta do indicador" de cada aviso de baixa: começa como o indicador marcou e a loja pode mudar */
const naConta = reactive<Record<number, boolean>>({})
const naContaDe = (p: AprovacaoApi) => naConta[p.id] ?? (p.baixa?.naContaDoIndicador === true)
const primeiroNome = (p: AprovacaoApi) => p.solicitante.nome.split(' ')[0]
```

(`reactive` já é importado em `Equipe.vue`? Se o import de `vue` não tiver `reactive`, acrescente.)

Trocar a função `confirmarBaixa` para sempre mandar a marca. Substituir `const r = await aprovacoesApi.aprovar(sessao.value, p.id, decisao)` por:

```ts
    const r = await aprovacoesApi.aprovar(sessao.value, p.id, { ...(decisao ?? {}), naContaDoIndicador: naContaDe(p) })
```

No `conferirQuitacao(p)`, acrescentar ao `aviso` os campos `naConta: naContaDe(p)` e `indicador: primeiroNome(p)`; e atualizar o tipo de `alvoQuitacao` para incluir `naConta: boolean; indicador: string` dentro de `aviso`.

No `<template>`, dentro do cartão de cada pedido, logo **antes** do `<div class="row" style="gap: 8px; margin-top: 10px">` dos botões:

```html
        <label v-if="p.tipo === 'BAIXA'" class="between small" style="gap: 8px; margin-top: 8px; align-items: center">
          <span>Caiu na conta de {{ primeiroNome(p) }} (o dinheiro está com ele, não com a loja)</span>
          <input type="checkbox" data-na-conta :checked="naContaDe(p)" @change="naConta[p.id] = ($event.target as HTMLInputElement).checked" />
        </label>
```

- [ ] **Step 3: Implementar em `ReceberSheet.vue`**

No tipo de `alvo.aviso` (na `defineProps`) acrescentar `naConta?: boolean; indicador?: string`. No `<script setup>`: `const naContaDoAviso = ref(false)`, e no `watch(() => props.alvo, ...)`, junto de onde se redefine `f.data`/`f.forma`, `naContaDoAviso.value = a.aviso?.naConta === true`. Na chamada `aprovacoesApi.aprovar(sessao.value, props.alvo.aviso.id, { quitar: true, valor: f.valor, cobrarProximo: quitarEstado.proximo })` acrescentar `naContaDoIndicador: naContaDoAviso.value`. No `<template>`, logo depois do `<div v-if="alvo?.aviso" class="aviso" data-testid="quitar-aviso">...</div>`:

```html
        <label v-if="alvo?.aviso" class="between small" style="gap: 8px; align-items: center">
          <span>Caiu na conta de {{ alvo.aviso.indicador || 'o indicador' }} (o dinheiro está com ele, não com a loja)</span>
          <input v-model="naContaDoAviso" type="checkbox" data-na-conta />
        </label>
```

- [ ] **Step 4: Rodar (os testes de conta só passam por inteiro depois da Task 9) e a regressão das baixas**

Run: `cd front && npx vue-tsc --noEmit && npx playwright test e2e/baixa.spec.ts`
Expected: PASS (as baixas e a quitação pelo aviso continuam funcionando; o botão "Confirmar baixa" agora manda `naContaDoIndicador: false`).

- [ ] **Step 5: Commit**

```bash
git add front/src/views/admin/Equipe.vue front/src/components/ReceberSheet.vue front/e2e/conta-indicador.spec.ts
git commit -m "Equipe: marcar que o dinheiro caiu na conta do indicador ao confirmar a baixa (e na quitação)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Front — aba "Conta corrente" e lançar envio

**Files:**
- Create: `front/src/components/LancarEnvioForm.vue`, `front/src/components/ContaIndicadorFicha.vue`
- Modify: `front/src/views/admin/Indicadores.vue`
- Test: `front/e2e/conta-indicador.spec.ts`

**Interfaces:**
- Consumes: `contaIndicadorApi` (Task 6); `Sheet`, `MoneyInput`, `DateField`, `Seg` (componentes existentes); `useApp`, `useToast`.
- Produces: nova aba em Indicadores `{ id: 'conta', label: 'Conta corrente', icon: 'landmark' }` com um cartão por indicador (`data-conta`, saldo em `data-saldo`, texto "deve à loja" / "a loja deve a ele" / "em dia"); clicar abre `ContaIndicadorFicha` (sheet com saldo, três totais e extrato com `data-lancamento="COBROU|ENVIOU|EMPRESTIMO"`) e o botão `data-lancar-envio` abre `LancarEnvioForm` (valor, data, comprovante, lado) que chama `contaIndicadorApi.lancarEnvio` e atualiza.

- [ ] **Step 1: Acrescentar os testes de ponta a ponta que falham**

Em `front/e2e/conta-indicador.spec.ts`:

```ts
test.describe('aba Conta corrente', () => {
  async function abrir(page: import('@playwright/test').Page) {
    await entrar(page)
    await navegar(page, '/indicadores')
    await page.getByRole('button', { name: /Conta corrente/ }).click()
  }

  test('lista cada indicador com o saldo; o da demonstração aparece devendo à loja', async ({ page }) => {
    await abrir(page)
    await expect(page.locator('[data-conta]').first()).toBeVisible()
    const devendo = page.locator('[data-conta]').filter({ hasText: 'deve à loja' }).first()
    await expect(devendo).toContainText('800,00')
  })

  test('a ficha mostra o extrato (cobrou e enviou) e o saldo; lançar envio baixa o saldo e entra no extrato', async ({ page }) => {
    await abrir(page)
    await page.locator('[data-conta]').filter({ hasText: 'deve à loja' }).first().click()
    const ficha = page.getByRole('dialog')
    await expect(ficha.getByTestId('conta-saldo')).toContainText('800,00')
    await expect(ficha.locator('[data-lancamento="COBROU"]').first()).toContainText('1.200,00')
    await expect(ficha.locator('[data-lancamento="ENVIOU"]').first()).toContainText('400,00')
    await ficha.locator('[data-lancar-envio]').click()
    await page.locator('#envValor').fill('30000') // R$ 300,00
    await page.locator('#envComprovante').fill('PIX-E2E')
    await page.getByRole('button', { name: 'Lançar envio', exact: true }).last().click()
    await expect(ficha.getByTestId('conta-saldo')).toContainText('500,00')
    await expect(ficha.locator('[data-lancamento="ENVIOU"]').filter({ hasText: 'PIX-E2E' })).toBeVisible()
  })

  test('envio acima do saldo avisa que vira crédito do indicador, mas deixa lançar', async ({ page }) => {
    await abrir(page)
    await page.locator('[data-conta]').filter({ hasText: 'deve à loja' }).first().click()
    const ficha = page.getByRole('dialog')
    await ficha.locator('[data-lancar-envio]').click()
    await page.locator('#envValor').fill('90000') // R$ 900,00 (o saldo é 800,00)
    await expect(page.getByTestId('envio-aviso')).toContainText('passa do que ele devia')
    await page.getByRole('button', { name: 'Lançar envio', exact: true }).last().click()
    await expect(ficha.getByTestId('conta-saldo')).toContainText('100,00')
    await expect(ficha.getByTestId('conta-saldo')).toContainText('a loja deve a ele')
  })

  test('celular: a aba e a ficha cabem na tela, sem rolagem lateral', async ({ page }) => {
    await abrir(page)
    await page.locator('[data-conta]').first().click()
    await expect(page.getByRole('dialog')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd front && npx playwright test e2e/conta-indicador.spec.ts -g "aba Conta corrente" --project=computador`
Expected: FAIL — não existe o botão "Conta corrente".

- [ ] **Step 3: Criar `LancarEnvioForm.vue`**

`front/src/components/LancarEnvioForm.vue`:

```vue
<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ErroApi } from '@/api/clientes'
import { contaIndicadorApi } from '@/api/recursos'
import type { ContaIndicadorApi } from '@/api/contaIndicador'
import { useApp } from '@/composables/useApp'
import { useToast } from '@/composables/useToast'
import { fmt } from '@/domain/format'
import DateField from './DateField.vue'
import MoneyInput from './MoneyInput.vue'
import Seg from './Seg.vue'
import Sheet from './Sheet.vue'

/** O administrador lança o que o indicador enviou à loja: baixa o saldo dele e entra no Caixa na data. */
const props = defineProps<{ aberto: boolean; indicador: { id: number; nome: string } | null; saldo: number }>()
const emit = defineEmits<{ fechar: []; feito: [conta: ContaIndicadorApi] }>()
const { sessao, hoje } = useApp()
const { mostrar } = useToast()

const LADOS = [{ id: 'EMPRESTIMO', label: 'Empréstimos' }, { id: 'IPHONE', label: 'iPhones' }]
const f = reactive({ valor: 0, data: '', comprovante: '', lado: 'EMPRESTIMO' as 'EMPRESTIMO' | 'IPHONE' })
const erro = ref('')
const enviando = ref(false)

watch(() => props.aberto, (a) => { if (a) { Object.assign(f, { valor: 0, data: hoje.value, comprovante: '', lado: 'EMPRESTIMO' }); erro.value = '' } })

/** Mandou mais do que devia: vira crédito dele (a loja passa a dever). Deixa lançar, só avisa. */
const aviso = computed(() => (f.valor > 0 && f.valor > props.saldo + 0.004 ? `Isso passa do que ele devia (${fmt(Math.max(props.saldo, 0))}): o que sobrar vira crédito dele com a loja.` : ''))
const problema = computed(() => (f.valor > 0 ? '' : 'Informe quanto ele enviou.'))

async function confirmar() {
  if (enviando.value || problema.value || !props.indicador) return
  enviando.value = true; erro.value = ''
  try {
    const conta = await contaIndicadorApi.lancarEnvio(sessao.value, props.indicador.id, {
      valor: f.valor, data: f.data || hoje.value, lado: f.lado, ...(f.comprovante.trim() ? { comprovante: f.comprovante.trim() } : {}),
    })
    mostrar(`Envio de ${fmt(f.valor)} lançado.`)
    emit('feito', conta)
  } catch (e) {
    erro.value = e instanceof ErroApi ? e.message : 'Não consegui lançar o envio. Tente de novo.'
  } finally {
    enviando.value = false
  }
}
</script>

<template>
  <Sheet :aberto="aberto" @fechar="emit('fechar')">
    <template v-if="indicador">
      <h3>Lançar envio</h3>
      <div class="small">{{ indicador.nome }} enviou dinheiro para a loja</div>
      <form style="display: flex; flex-direction: column; gap: 14px; margin-top: 14px" novalidate @submit.prevent="confirmar">
        <div class="field"><label for="envValor">Quanto ele enviou?</label><MoneyInput id="envValor" v-model="f.valor" /></div>
        <div v-if="aviso" class="aviso" role="status" data-testid="envio-aviso">{{ aviso }}</div>
        <div class="field"><label for="envData">Quando chegou?</label><DateField id="envData" v-model="f.data" :max="hoje" min="2020-01-01" /></div>
        <div class="field"><label>Entra em qual caixa?</label><Seg v-model="f.lado" :itens="LADOS" /></div>
        <div class="field"><label for="envComprovante">Comprovante (opcional)</label><div class="inp"><input id="envComprovante" v-model="f.comprovante" maxlength="120" placeholder="Ex.: ID da transação Pix" autocomplete="off" /></div></div>
        <div v-if="erro" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad)">{{ erro }}</div>
        <button class="btn b-pri b-block" type="submit" :disabled="enviando || !!problema">{{ enviando ? 'Lançando…' : 'Lançar envio' }}</button>
      </form>
    </template>
  </Sheet>
</template>
```

- [ ] **Step 4: Criar `ContaIndicadorFicha.vue`**

`front/src/components/ContaIndicadorFicha.vue`:

```vue
<script setup lang="ts">
import { ref, watch } from 'vue'
import { ErroApi } from '@/api/clientes'
import type { ContaIndicadorApi, TipoLinhaContaApi } from '@/api/contaIndicador'
import { contaIndicadorApi } from '@/api/recursos'
import { useApp } from '@/composables/useApp'
import { dmy, fmt } from '@/domain/format'
import Icon from './Icon.vue'
import LancarEnvioForm from './LancarEnvioForm.vue'
import Sheet from './Sheet.vue'

/** A conta de um indicador com a loja: o saldo, os totais e o extrato (o que ele cobrou, o que enviou e o que emprestou da conta dele). */
const props = defineProps<{ indicador: { id: number; nome: string } | null }>()
const emit = defineEmits<{ fechar: []; mudou: [] }>()
const { sessao } = useApp()

const conta = ref<ContaIndicadorApi | null>(null)
const carregando = ref(false)
const erro = ref('')
const lancando = ref(false)

async function carregar() {
  if (!props.indicador) return
  carregando.value = true; erro.value = ''
  try { conta.value = await contaIndicadorApi.ver(sessao.value, props.indicador.id) }
  catch (e) { erro.value = e instanceof ErroApi ? e.message : 'Não consegui abrir a conta.' }
  finally { carregando.value = false }
}
watch(() => props.indicador, (i) => { conta.value = null; if (i) carregar() })

const ROTULO: Record<TipoLinhaContaApi, { icone: string; sinal: '+' | '−'; cor: string }> = {
  COBROU: { icone: 'arrow-down-left', sinal: '+', cor: 'var(--bad)' },
  ENVIOU: { icone: 'arrow-up-right', sinal: '−', cor: 'var(--ok)' },
  EMPRESTIMO: { icone: 'hand-coins', sinal: '−', cor: 'var(--ok)' },
}
/** "ele deve", "a loja deve a ele" ou "em dia" */
const situacao = (saldo: number) => (saldo > 0.004 ? 'deve à loja' : saldo < -0.004 ? 'a loja deve a ele' : 'em dia')

function aoLancar(c: ContaIndicadorApi) { conta.value = c; lancando.value = false; emit('mudou') }
</script>

<template>
  <Sheet :aberto="indicador !== null" @fechar="emit('fechar')">
    <template v-if="indicador">
      <h3>Conta de {{ indicador.nome }}</h3>
      <div v-if="erro" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad)">{{ erro }}</div>
      <div v-else-if="carregando && !conta" class="empty">Carregando…</div>
      <template v-else-if="conta">
        <div class="card pad" style="margin-top: 12px; background: var(--elevated)" data-testid="conta-saldo">
          <div class="lbl">Saldo com a loja</div>
          <div class="val num">{{ fmt(Math.abs(conta.saldo)) }}</div>
          <div class="small">{{ situacao(conta.saldo) }}</div>
        </div>
        <div class="resumo3" style="margin-top: 12px">
          <div><div class="lbl">Cobrou dos clientes</div><div class="val num">{{ fmt(conta.cobrou) }}</div></div>
          <div><div class="lbl">Enviou à loja</div><div class="val num">{{ fmt(conta.enviou) }}</div></div>
          <div><div class="lbl">Pagou empréstimos</div><div class="val num">{{ fmt(conta.emprestou) }}</div></div>
        </div>
        <button class="btn b-pri b-block" style="margin-top: 12px" data-lancar-envio @click="lancando = true"><Icon name="plus" small />Lançar envio</button>
        <div class="card list" style="margin-top: 12px" data-testid="conta-extrato">
          <div v-for="l in conta.itens" :key="l.chave" class="li" :data-lancamento="l.tipo" style="cursor: default">
            <span class="wa" style="width: 32px; height: 32px" :style="l.tipo === 'COBROU' ? 'background: var(--bad-soft); color: var(--bad)' : ''"><Icon :name="ROTULO[l.tipo].icone" small /></span>
            <span class="mid"><span class="t" style="display: block">{{ l.titulo }}</span><span class="s" style="display: block">{{ dmy(l.data) }} · {{ l.sub }}</span></span>
            <b class="num" :style="{ color: ROTULO[l.tipo].cor }">{{ ROTULO[l.tipo].sinal }} {{ fmt(l.valor) }}</b>
          </div>
          <div v-if="!conta.itens.length" class="empty">Nada na conta ainda.</div>
        </div>
        <div class="small" style="margin-top: 8px">+ é dinheiro de cliente que ficou com ele; − é o que ele já mandou para a loja ou o que pagou de empréstimo.</div>
      </template>
      <LancarEnvioForm :aberto="lancando" :indicador="indicador" :saldo="conta?.saldo ?? 0" @fechar="lancando = false" @feito="aoLancar" />
    </template>
  </Sheet>
</template>
```

- [ ] **Step 5: Ligar a aba em `Indicadores.vue`**

No `<script setup>`: importar

```ts
import type { SaldoIndicadorApi } from '@/api/contaIndicador'
import { contaIndicadorApi, indicadoresApi, repassesApi } from '@/api/recursos'
import ContaIndicadorFicha from '@/components/ContaIndicadorFicha.vue'
```

(trocando o import existente de `recursos` para incluir `contaIndicadorApi`). Acrescentar à lista `abas`: `{ id: 'conta', label: 'Conta corrente', icon: 'landmark' },` (depois de `repasses`). Acrescentar o estado e o carregamento:

```ts
// ---- conta corrente: quanto de dinheiro de cliente está com cada indicador ----
const saldos = ref<SaldoIndicadorApi[]>([])
const contaAberta = ref<{ id: number; nome: string } | null>(null)
const saldosVisiveis = computed(() => saldos.value.filter((s) => casaBusca([s.indicador.nome], busca.value)))
const situacaoConta = (saldo: number) => (saldo > 0.004 ? 'deve à loja' : saldo < -0.004 ? 'a loja deve a ele' : 'em dia')
async function carregarSaldos() {
  try { saldos.value = await contaIndicadorApi.saldos(sessao.value) }
  catch (e) { erro.value = e instanceof ErroApi ? e.message : 'Não consegui carregar as contas.' }
}
```

e chamar `carregarSaldos()` no `onMounted(() => { carregar(); carregarNiveis(); carregarRepasses(); carregarSaldos() })`.

No `<template>`, **antes** do bloco `<!-- já pagos -->`, acrescentar:

```html
  <!-- conta corrente -->
  <template v-else-if="aba === 'conta'">
    <div class="small">Dinheiro de cliente que ficou na conta do indicador. O saldo é o que ele cobrou, menos o que já enviou à loja e o que pagou de empréstimo.</div>
    <CampoBusca v-model="busca" placeholder="Buscar indicador" />
    <div class="fones">
      <button v-for="s in saldosVisiveis" :key="s.indicador.id" class="card pad" style="text-align: left; display: flex; align-items: center; gap: 12px" :style="{ opacity: s.indicador.ativo ? 1 : 0.6 }" :data-conta="s.indicador.id" @click="contaAberta = { id: s.indicador.id, nome: s.indicador.nome }">
        <span class="ini" style="background: var(--primary-soft); color: var(--primary)">{{ iniciais(s.indicador.nome) }}</span>
        <div style="flex: 1; min-width: 0"><div class="val">{{ s.indicador.nome }}</div><div class="small">{{ situacaoConta(s.saldo) }}</div></div>
        <b class="num" data-saldo :style="{ color: s.saldo > 0.004 ? 'var(--bad)' : s.saldo < -0.004 ? 'var(--ok)' : 'var(--soft)' }">{{ fmt(Math.abs(s.saldo)) }}</b>
      </button>
      <div v-if="!saldosVisiveis.length" class="card empty">{{ busca.trim() ? 'Nenhum indicador com esse nome.' : 'Nenhum indicador ainda.' }}</div>
    </div>
  </template>
```

e, perto do final do template (junto das outras sheets do arquivo, por exemplo ao lado de `<PagarRepasseForm ... />`):

```html
  <ContaIndicadorFicha :indicador="contaAberta" @fechar="contaAberta = null" @mudou="carregarSaldos()" />
```

- [ ] **Step 6: Rodar tudo do front (unitários, tipos e ponta a ponta)**

Run: `cd front && npx vue-tsc --noEmit && npx vitest run && npx playwright test e2e/conta-indicador.spec.ts e2e/baixa.spec.ts e2e/emprestimos.spec.ts`
Expected: PASS — inclusive o 1º teste da Task 7 e os da Task 8, que dependiam desta aba.

- [ ] **Step 7: Suíte completa de ponta a ponta**

Run: `cd front && npx playwright test`
Expected: PASS (desktop e celular; os `skipped` de antes continuam skipped).

- [ ] **Step 8: Commit**

```bash
git add front/src front/e2e
git commit -m "Indicadores: aba Conta corrente com saldo, extrato e lançar envio

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Fechamento — verificação geral, PR e roteiro de produção

**Files:** nenhum arquivo novo (só comandos).

- [ ] **Step 1: Verificação completa**

Run: `cd back && npx tsc --noEmit && npx vitest run` e `cd ../front && npx vue-tsc --noEmit && npx vitest run && npx playwright test`
Expected: tudo PASS. Anotar as contagens (testes do back, do front e de ponta a ponta) para o PR.

- [ ] **Step 2: Empurrar e abrir o PR (sem merge)**

```bash
git push -q -u origin conta-corrente-indicador-etapa-1
gh pr create --title "Conta corrente do indicador — etapa 1 (back + administrador)" --body "$(cat <<'EOF'
## O que muda
- **Caixa:** empréstimo pago (todo ou em parte) com a conta de um indicador só tira do Caixa o que não veio dela.
- **Empréstimo novo:** campo \"De onde sai o dinheiro?\" (Caixa da loja ou conta do indicador + valor).
- **Baixa do indicador:** a loja marca \"caiu na conta do indicador\" ao confirmar (também na quitação); o recebimento fica fora do Caixa até o indicador enviar.
- **Conta corrente:** aba nova em Indicadores com o saldo de cada um, extrato (cobrou / enviou / pagou empréstimo) e **Lançar envio** (entra no Caixa na data).
- Back: módulo \`conta-indicador\` (3 rotas), migração com 2 colunas em \`emprestimos\`. O saldo é calculado, não gravado.

## Fora desta etapa
Telas do indicador (marcar no Recebi, Minha conta, informar envio com confirmação): etapa 2.

## Roteiro de produção (só com OK do Geovane)
1. Backup do banco; 2. enviar back e rodar \`docker compose run --rm back npm run migrate\`; 3. enviar o front. O DEDA já abre devendo R\$ 3.585,00 (12.020 cobrados − 8.435 transferidos, dados da migração).

## Testes
(preencher com as contagens do passo 1)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Parar e esperar o OK do Geovane** para mergear e para o roteiro de produção (a migração grava no banco de produção).

---

## Self-Review

**Spec coverage** (seções da spec → tasks):
- §3 saldo calculado → Task 5 (SQL `UNIAO` + testes de desfazer/cancelar).
- §4 lançamento 1 (caiu na conta) → Task 4 (back) e Task 8 (tela da loja); a marca do **indicador** no Recebi é etapa 2 (fora de escopo, dito na spec §9.2).
- §4 lançamento 2 (envio) → Task 5 (back: administrador lança direto) e Task 9 (tela). O "indicador informa e a loja confirma" é etapa 2 (`envios_indicador`).
- §4 lançamento 3 (saiu da conta do indicador) → Tasks 1–3 (dados, Caixa, empréstimo) e Task 7 (tela).
- §5 dados → Task 1 (colunas) e Task 4 (`dados.naContaDoIndicador`). A tabela `envios_indicador` ficou para a etapa 2 (YAGNI na etapa 1: o administrador lança o envio direto no `movimentacoes_caixa`).
- §6 telas do administrador → Tasks 7, 8, 9. O cartão "Quanto está com os indicadores" do Início ficou explicitamente para depois (já estava assim na spec).
- §7 casos de borda → Review Focus 1–7 e testes correspondentes. "Venda de iPhone pode marcar caiu na conta" funciona pelo mesmo caminho da baixa (nenhum código específico de empréstimo no `confirmarBaixa`).
- §8 testes → cobertos em cada task.

**Placeholder scan:** sem TBD, sem "similar à task N". Os nomes locais do `criar` do fake de empréstimos (`capital`, `data`, `cliente`, `dep.indicadores._interno.ativo`) foram conferidos no arquivo.

**Type consistency:** `ContaIndicadorApi`/`LinhaContaApi`/`SaldoIndicadorApi`/`EntradaEnvio` (Task 6) são os usados nas Tasks 9; `saiuDaConta: { indicadorId; valor }` é o mesmo no back (Task 3), no contrato do front e no `EmprestimoForm` (Task 7); `naContaDoIndicador` é o nome em `pedirBaixa`, `aprovar`, `AprovacaoApi.baixa` e `DecisaoBaixa`; `data-lancamento`, `data-conta`, `data-saldo`, `data-na-conta`, `data-origem*`, `data-lancar-envio` batem entre as telas e os testes de ponta a ponta.
