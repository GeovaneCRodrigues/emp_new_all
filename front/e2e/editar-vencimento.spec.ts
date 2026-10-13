import { expect, test, type Page } from '@playwright/test'
import { entrar, navegar } from './helpers'

// Demonstração: hoje é 08/10/2026. O botão Editar muda o vencimento de uma parcela em aberto (só o administrador).
const editar = (page: Page) => page.locator('[data-cobranca] [data-editar]')

test.describe('editar o vencimento (administrador)', () => {
  test('Cobranças: abre a folha, valida, salva a nova data e a linha vira "remarcada"', async ({ page }) => {
    await entrar(page, 'admin'); await navegar(page, '/cobrancas')
    await page.getByRole('button', { name: /^Atrasadas/ }).first().click()
    await expect(editar(page).first()).toBeVisible()
    const linha = page.locator('[data-cobranca]').filter({ has: page.locator('[data-editar]') }).first()
    const chave = await linha.getAttribute('data-cobranca')
    await linha.locator('[data-editar]').click()
    await expect(page.getByRole('heading', { name: 'Editar vencimento' })).toBeVisible()
    await expect(page.getByTestId('remarcar-atual')).toContainText('R$')
    await expect(page.getByRole('button', { name: 'Salvar nova data' })).toBeEnabled() // a data já vem em "hoje" (a atrasada ainda não é de hoje)
    await page.locator('#rvMotivo').fill('Cliente combinou pagar dia 20')
    await page.locator('#rvData').fill('20/10/2026')
    await page.getByRole('button', { name: 'Salvar nova data' }).click()
    await expect(page.getByText(/mudou para 20\/10/)).toBeVisible()
    // saiu das atrasadas; na aba das próximas aparece marcada como remarcada
    await expect(page.locator(`[data-cobranca="${chave}"]`)).toHaveCount(0)
    await page.getByRole('button', { name: /^Próximas/ }).first().click()
    const nova = page.locator(`[data-cobranca="${chave}"]`)
    await expect(nova).toBeVisible()
    await expect(nova).toContainText('remarcada')
    await expect(nova).toContainText('20/10')
  })

  test('Cronograma: o Editar está na lista do mês e muda a parcela de dia', async ({ page }) => {
    await entrar(page, 'admin'); await navegar(page, '/cronograma')
    await expect(editar(page).first()).toBeVisible()
    await editar(page).first().click()
    await expect(page.getByRole('heading', { name: 'Editar vencimento' })).toBeVisible()
    await page.locator('#rvData').fill('28/10/2026')
    await page.getByRole('button', { name: 'Salvar nova data' }).click()
    await expect(page.getByText(/mudou para 28\/10/)).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  })

  test('data igual à atual ou no passado trava o botão e explica', async ({ page }) => {
    await entrar(page, 'admin'); await navegar(page, '/cobrancas')
    await page.getByRole('button', { name: /^Próximas/ }).first().click()
    await expect(editar(page).first()).toBeVisible()
    await editar(page).first().click()
    await expect(page.getByTestId('remarcar-problema')).toContainText('diferente da atual')
    await expect(page.getByRole('button', { name: 'Salvar nova data' })).toBeDisabled()
  })
})

test('cobrador e indicador não veem o botão Editar', async ({ page }) => {
  await entrar(page, 'cobrador'); await navegar(page, '/cobrancas').catch(() => undefined)
  await expect(editar(page)).toHaveCount(0)
})

test('indicador no portal: sem Editar', async ({ page }) => {
  await entrar(page, 'indicador'); await navegar(page, '/cobranca')
  await expect(page.locator('.cob').first()).toBeVisible()
  await expect(page.locator('.cob [data-editar]')).toHaveCount(0)
})
