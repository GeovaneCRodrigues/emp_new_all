import { expect, test, type Page } from '@playwright/test'
import { entrar, navegar } from './helpers'

// A demonstração tem "hoje" em 08/10/2026 (quinta-feira): outubro/2026 começa numa quinta e tem 31 dias.
const celulaComParcela = (page: Page) => page.locator('[data-testid="cron-grade"] button.d:not([data-cor=""])')
// dia com algo a vencer (cor "ok" = tudo pago)
const celulaAVencer = (page: Page) => page.locator('[data-testid="cron-grade"] button.d:not([data-cor=""]):not([data-cor="ok"])')
const abertas = (rotulo: string) => Number(/(\d+) em aberto/.exec(rotulo)?.[1] ?? 0)

test.describe('cronograma: o calendário do mês (administrador)', () => {
  test.beforeEach(async ({ page }) => { await entrar(page, 'admin'); await navegar(page, '/cronograma') })

  test('abre no mês de hoje, com o resumo e os 31 dias; hoje vem marcado e o mês inteiro listado', async ({ page }) => {
    await expect(page.getByTestId('cron-mes')).toHaveText(/outubro 2026/i)
    await expect(page.getByRole('heading', { name: 'Cronograma' })).toBeVisible()
    await expect(page.locator('[data-testid="cron-grade"] button.d')).toHaveCount(31)
    await expect(page.locator('[data-testid="cron-grade"] button.d.hoje')).toHaveAttribute('data-dia', '2026-10-08')
    await expect(page.locator('[data-testid="cron-grade"] button.d.sel')).toHaveCount(0) // nenhum dia escolhido: vale o mês todo
    await expect(page.getByTestId('cron-mes-todo')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('cron-lista-mes')).toBeVisible()
    await expect(page.getByTestId('cron-hoje')).toHaveCount(0) // já está no mês de hoje
    for (const id of ['cron-previsto', 'cron-recebido', 'cron-atrasado']) await expect(page.getByTestId(id)).toHaveText(/R\$/)
  })

  test('mês inteiro: lista todas as parcelas do mês (a mesma conta do calendário), dia a dia e em ordem', async ({ page }) => {
    const lista = page.getByTestId('cron-lista-mes')
    await expect(lista.locator('[data-cobranca]').first()).toBeVisible()
    let esperado = 0
    for (const rotulo of await celulaComParcela(page).evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''))) esperado += Number(/(\d+) parcela/.exec(rotulo)![1])
    expect(esperado).toBeGreaterThan(0)
    await expect(lista.locator('[data-cobranca]')).toHaveCount(esperado)
    await expect(lista).toContainText(new RegExp(`${esperado} parcelas? em outubro`))
    const dias = await lista.locator('[data-grupo-dia]').evaluateAll((els) => els.map((e) => e.getAttribute('data-grupo-dia')!))
    expect(dias.length).toBeGreaterThan(1); expect([...dias].sort()).toEqual(dias)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  })

  test('clicar num dia mostra só o dia; clicar de novo, ou em "Mês inteiro", volta ao mês todo', async ({ page }) => {
    const total = await page.getByTestId('cron-lista-mes').locator('[data-cobranca]').count()
    const c = celulaAVencer(page).first()
    const qtd = abertas((await c.getAttribute('aria-label'))!)
    await c.click()
    await expect(page.getByTestId('cron-lista-mes')).toHaveCount(0)
    await expect(page.getByTestId('cron-lista-dia').locator('[data-cobranca]')).toHaveCount(qtd)
    await expect(page.getByTestId('cron-mes-todo')).toHaveAttribute('aria-pressed', 'false')
    await c.click() // o mesmo dia de novo: volta ao mês
    await expect(page.getByTestId('cron-lista-mes').locator('[data-cobranca]')).toHaveCount(total)
    await c.click()
    await expect(page.getByTestId('cron-lista-dia')).toBeVisible()
    await page.getByTestId('cron-mes-todo').click()
    await expect(page.getByTestId('cron-lista-mes').locator('[data-cobranca]')).toHaveCount(total)
    await expect(page.locator('[data-testid="cron-grade"] button.d.sel')).toHaveCount(0)
  })

  test('trocar de mês ou de filtro volta para o mês inteiro; mês sem parcela avisa', async ({ page }) => {
    await celulaComParcela(page).first().click()
    await expect(page.getByTestId('cron-lista-dia')).toBeVisible()
    await page.getByTestId('filtro-tipo').getByRole('button', { name: 'Empréstimos' }).click()
    await expect(page.getByTestId('cron-lista-mes')).toBeVisible()
    for (let i = 0; i < 40; i++) await page.getByTestId('cron-mes-prox').click() // bem depois da última parcela
    await expect(page.getByTestId('cron-lista-mes')).toContainText('nada vence neste mês')
  })

  test('clicar num dia com parcelas lista exatamente as parcelas dele', async ({ page }) => {
    const c = celulaAVencer(page).first()
    await expect(c).toBeVisible()
    const iso = (await c.getAttribute('data-dia'))!
    const qtd = abertas((await c.getAttribute('aria-label'))!)
    await c.click()
    const lista = page.getByTestId('cron-lista-dia')
    await expect(lista).toContainText(`${Number(iso.slice(8))} de outubro`)
    await expect(lista.locator('[data-cobranca]')).toHaveCount(qtd)
    await expect(lista).toContainText(`${qtd} a vencer`)
  })

  test('as já pagas do dia ficam escondidas e aparecem em "Mostrar pagas"', async ({ page }) => {
    const c = page.locator('[data-testid="cron-grade"] button.d[aria-label*="com pagamento"][aria-label*="em aberto"]').first()
    test.skip(await c.count() === 0, 'sem dia misto na demonstração')
    const rotulo = (await c.getAttribute('aria-label'))!
    const total = Number(/(\d+) parcela/.exec(rotulo)![1])
    await c.click()
    const lista = page.getByTestId('cron-lista-dia')
    await expect(lista.locator('[data-cobranca]')).toHaveCount(abertas(rotulo))
    await page.getByTestId('cron-dia-pagas').click()
    await expect(lista.locator('[data-cobranca]')).toHaveCount(total)
    await page.getByTestId('cron-dia-pagas').click()
    await expect(lista.locator('[data-cobranca]')).toHaveCount(abertas(rotulo))
  })

  test('as setas trocam o mês e o botão Hoje volta; nenhum dia vem selecionado', async ({ page }) => {
    await page.getByTestId('cron-mes-prox').click()
    await expect(page.getByTestId('cron-mes')).toHaveText(/novembro 2026/i)
    await expect(page.locator('[data-testid="cron-grade"] button.d')).toHaveCount(30)
    await expect(page.locator('[data-testid="cron-grade"] button.d.sel')).toHaveCount(0)
    await page.getByTestId('cron-mes-ant').click(); await page.getByTestId('cron-mes-ant').click()
    await expect(page.getByTestId('cron-mes')).toHaveText(/setembro 2026/i)
    await page.getByTestId('cron-hoje').click()
    await expect(page.getByTestId('cron-mes')).toHaveText(/outubro 2026/i)
    await expect(page.getByTestId('cron-hoje')).toHaveCount(0)
  })

  test('dia sem parcela mostra "nada vence neste dia"', async ({ page }) => {
    const vazio = page.locator('[data-testid="cron-grade"] button.d[data-cor=""]').first()
    await vazio.click()
    await expect(page.getByTestId('cron-lista-dia')).toContainText('nada vence neste dia')
  })

  test('a busca por nome (sem acento) mostra todas as parcelas do mês dele embaixo', async ({ page }) => {
    await celulaComParcela(page).first().click()
    const nome = (await page.getByTestId('cron-lista-dia').locator('[data-cobranca] .t').first().textContent())!.trim()
    const parte = nome.split(' ')[0].normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
    await page.getByTestId('cron-busca').fill(parte)
    const lista = page.getByTestId('cron-lista-busca')
    await expect(lista).toBeVisible()
    await expect(lista).toContainText(/parcelas? em outubro/)
    await expect(lista.locator('[data-cobranca]').first()).toBeVisible()
    for (const t of await lista.locator('[data-cobranca] .t').allTextContents()) expect(t.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()).toContain(parte)
    await page.getByTestId('cron-busca').fill('zzzzzz')
    await expect(page.getByTestId('cron-lista-busca')).toContainText('nenhum cliente com esse nome')
  })

  test('com a busca preenchida, clicar num dia mostra só as parcelas do dia', async ({ page }) => {
    await celulaComParcela(page).first().click()
    const nome = (await page.getByTestId('cron-lista-dia').locator('[data-cobranca] .t').first().textContent())!.trim()
    await page.getByTestId('cron-busca').fill(nome.split(' ')[0])
    await expect(page.getByTestId('cron-lista-busca')).toBeVisible()
    await celulaComParcela(page).first().click()
    await expect(page.getByTestId('cron-lista-dia')).toBeVisible()
    await expect(page.getByTestId('cron-lista-busca')).toHaveCount(0)
  })

  test('o filtro iPhones / Empréstimos reduz o calendário', async ({ page }) => {
    const todos = await celulaComParcela(page).count()
    await page.getByTestId('filtro-tipo').getByRole('button', { name: 'Empréstimos' }).click()
    await expect.poll(async () => celulaComParcela(page).count()).toBeLessThanOrEqual(todos)
    await page.getByTestId('filtro-tipo').getByRole('button', { name: 'iPhones' }).click()
    await expect.poll(async () => celulaComParcela(page).count()).toBeLessThanOrEqual(todos)
  })

  test('abrir uma parcela do dia leva à ficha da operação', async ({ page }) => {
    await celulaAVencer(page).first().click()
    await page.getByTestId('cron-lista-dia').locator('[data-cobranca] .mid').first().click()
    await expect(page.locator('.sheet, [role="dialog"]').first()).toBeVisible()
  })
})

test.describe('cronograma: o indicador vê só o calendário dele', () => {
  test('Cronograma tem menu próprio: mostra o mês com as parcelas dele, sem botão de receber', async ({ page }) => {
    await entrar(page, 'indicador')
    if (test.info().project.name === 'computador') await page.locator('aside.side').getByRole('button', { name: /^Cronograma/ }).click()
    else await page.locator('nav.tabs').getByRole('button', { name: /^Cronograma/ }).click()
    await expect(page.getByTestId('cron-mes')).toHaveText(/outubro 2026/i)
    await expect(page.locator('[data-testid="cron-grade"] button.d')).toHaveCount(31)
    const c = celulaComParcela(page).first()
    if (await c.count()) {
      await c.click()
      await expect(page.getByTestId('cron-lista-dia')).toBeVisible()
      await expect(page.getByRole('button', { name: /^Receber$/ })).toHaveCount(0) // quem dá a baixa é a loja
    }
  })
})
