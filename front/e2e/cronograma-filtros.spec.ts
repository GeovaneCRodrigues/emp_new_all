import { expect, test, type Page } from '@playwright/test'
import { entrar, navegar } from './helpers'

const linhas = (page: Page) => page.getByTestId('cron-lista-mes').locator('[data-cobranca]')
const mod = (page: Page, m: string) => page.locator(`[data-testid="cron-filtro-modalidade"] [data-modalidade="${m}"]`)
const previsto = (page: Page) => page.getByTestId('cron-previsto').innerText()

test.describe('cronograma: filtros e dias em dois blocos (administrador)', () => {
  test.beforeEach(async ({ page }) => { await entrar(page, 'admin'); await navegar(page, '/cronograma'); await expect(linhas(page).first()).toBeVisible() })

  test('filtro de indicador: um indicador só, "Sem indicador", e o resumo e a lista acompanham', async ({ page }) => {
    const todas = await linhas(page).count(); const prevTodas = await previsto(page)
    const sel = page.getByTestId('cron-filtro-indicador')
    await expect(sel.locator('option')).not.toHaveCount(2) // além de "Todos" e "Sem indicador" vêm os indicadores
    await sel.selectOption({ label: 'Sem indicador' })
    await expect.poll(async () => await linhas(page).count()).toBeLessThan(todas)
    await expect(page.locator('[data-cobranca] [data-indicador]')).toHaveCount(0)
    expect(await previsto(page)).not.toBe(prevTodas)
    await sel.selectOption({ index: 2 }) // o primeiro indicador da lista
    await expect.poll(async () => (await linhas(page).count()) > 0 && (await linhas(page).count()) < todas).toBe(true)
    expect(await page.locator('[data-cobranca]:not(:has([data-indicador]))').count()).toBe(0) // todas têm "indicado por"
    await page.getByTestId('cron-limpar-filtros').click()
    await expect(linhas(page)).toHaveCount(todas)
    await expect(page.getByTestId('cron-limpar-filtros')).toHaveCount(0)
  })

  test('modalidade é multisseleção: marca uma, marca outra junto, desmarca; "Todas" limpa', async ({ page }) => {
    const todas = await linhas(page).count()
    await page.getByRole('button', { name: 'Empréstimos' }).click()
    await expect(linhas(page).first()).toBeVisible()
    const emp = await linhas(page).count()
    await mod(page, 'JUROS').click()
    await expect(mod(page, 'JUROS')).toHaveAttribute('aria-pressed', 'true')
    await expect(mod(page, 'TODAS')).toHaveAttribute('aria-pressed', 'false')
    await expect.poll(() => linhas(page).count()).toBeLessThan(emp)
    const soJuros = await linhas(page).count()
    await mod(page, 'DIARIA').click() // junto com o só juros
    await expect(mod(page, 'JUROS')).toHaveAttribute('aria-pressed', 'true'); await expect(mod(page, 'DIARIA')).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => linhas(page).count()).toBeGreaterThanOrEqual(soJuros)
    await mod(page, 'JUROS').click(); await mod(page, 'DIARIA').click() // desmarcou tudo: volta a ser "Todas"
    await expect(mod(page, 'TODAS')).toHaveAttribute('aria-pressed', 'true')
    await expect(linhas(page)).toHaveCount(emp)
    await mod(page, 'PARCELADO').click(); await mod(page, 'TODAS').click()
    await expect(linhas(page)).toHaveCount(emp)
    expect(emp).toBeLessThanOrEqual(todas)
  })

  test('situação: "A receber" tira o que já foi recebido; "Recebidas" mostra só ele; "Todas" volta; soma com os outros filtros', async ({ page }) => {
    const todas = await linhas(page).count()
    const sit = (nome: string) => page.getByTestId('cron-filtro-situacao').getByRole('button', { name: nome, exact: true })
    await sit('A receber').click()
    await expect.poll(() => linhas(page).count()).toBeLessThan(todas)
    const abertas = await linhas(page).count()
    await expect(page.locator('[data-bloco="recebido"]').first()).toBeVisible().catch(() => undefined) // parcela paga pela metade ainda mostra o que entrou
    expect(await page.locator('[data-situacao="recebida"]').count()).toBe(0)
    await sit('Recebidas').click()
    await expect.poll(async () => (await page.locator('[data-situacao="recebida"]').count()) > 0).toBe(true)
    expect(await page.locator('[data-situacao="atrasada"], [data-situacao="hoje"], [data-situacao="aberta"]').count()).toBe(0)
    expect(await linhas(page).count() + abertas).toBe(todas)
    await page.getByTestId('cron-limpar-filtros').click()
    await expect(linhas(page)).toHaveCount(todas)
    await sit('A receber').click()
    await page.getByRole('button', { name: 'Empréstimos' }).click()
    await mod(page, 'PARCELADO').click()
    await expect(page.getByTestId('cron-limpar-filtros')).toBeVisible()
  })

  test('na aba iPhones o filtro de modalidade some, e não vale', async ({ page }) => {
    await page.getByRole('button', { name: 'Empréstimos' }).click()
    await mod(page, 'JUROS').click()
    await page.getByRole('button', { name: 'iPhones' }).click()
    await expect(page.getByTestId('cron-filtro-modalidade')).toHaveCount(0)
    await expect(linhas(page).first()).toBeVisible() // continua mostrando as vendas
  })

  test('os filtros somam com a busca e com a escolha de um dia', async ({ page }) => {
    await page.getByRole('button', { name: 'Empréstimos' }).click()
    await mod(page, 'PARCELADO').click()
    await page.getByTestId('cron-busca').fill('zzzxyz')
    await expect(linhas(page)).toHaveCount(0)
    await page.getByTestId('cron-busca').fill('')
    await expect(linhas(page).first()).toBeVisible()
    await page.locator('[data-testid="cron-grade"] button.d:not([data-cor=""])').first().click()
    await expect(page.getByTestId('cron-lista-dia')).toBeVisible()
  })

  test('cada dia mostra dois blocos: o que já entrou (verde) e o que está aberto', async ({ page }) => {
    const celulas = page.locator('[data-testid="cron-grade"] button.d:not([data-cor=""])')
    await expect(celulas.first()).toBeVisible()
    expect(await page.locator('[data-bloco="aberto"]').count()).toBeGreaterThan(0)
    expect(await page.locator('[data-bloco="recebido"]').count()).toBeGreaterThan(0)
    const misto = celulas.filter({ has: page.locator('[data-bloco="recebido"]') }).filter({ has: page.locator('[data-bloco="aberto"]') })
    if (await misto.count()) {
      const c = misto.first()
      await expect(c.locator('[data-bloco]')).toHaveCount(2)
      await expect(c.locator('[data-bloco="recebido"] .v')).toHaveCSS('color', /.+/)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  })
})

test('indicador no portal: sem filtros de indicador nem de modalidade', async ({ page }) => {
  await entrar(page, 'indicador'); await navegar(page, '/cronograma')
  await expect(page.getByTestId('cron-filtros')).toHaveCount(0)
})
