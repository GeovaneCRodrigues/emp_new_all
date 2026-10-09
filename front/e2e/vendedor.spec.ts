import { expect, test } from '@playwright/test'
import { entrar } from './helpers'

test.describe('vendedor: início', () => {
  test('mostra vendas do mês, disponíveis, contratos e atrasados só da carteira dele, sem custo nem lucro', async ({ page }) => {
    await entrar(page, 'vendedor')
    await expect(page.getByTestId('vendas-mes')).toBeVisible()
    await expect(page.getByTestId('disponiveis')).not.toHaveText('—')
    await expect(page.getByTestId('contratos')).toBeVisible()
    await expect(page.getByTestId('atrasados')).toBeVisible()
    const corpo = await page.locator('main, body').first().innerText()
    expect(corpo).not.toMatch(/lucro|custo/i)
  })

  test('Nova venda leva para a venda', async ({ page }) => {
    await entrar(page, 'vendedor')
    await page.getByRole('button', { name: 'Nova venda' }).first().click()
    await expect(page).toHaveURL(/\/vender/)
  })
})
