import { expect, test } from '@playwright/test'
import { entrar, navegar, verComo } from './helpers'

test.describe('e-mail e observações do cliente (só do administrador)', () => {
  test('o admin grava na ficha e vê de volta; o vendedor não tem esses campos', async ({ page }) => {
    await entrar(page)
    await navegar(page, '/clientes')
    await page.locator('.li').first().click()
    await page.getByRole('button', { name: 'Editar' }).click()
    await page.fill('#cEmail', 'sem-arroba')
    await page.getByRole('button', { name: 'Salvar alterações' }).click()
    await expect(page.getByText('E-mail inválido')).toBeVisible()
    await page.fill('#cEmail', 'maria@exemplo.com')
    await page.fill('#cObs', 'Cliente antigo, paga sempre no dia 10')
    await page.getByRole('button', { name: 'Salvar alterações' }).click()
    await expect(page.getByRole('heading', { name: 'Editar cliente' })).toHaveCount(0)
    await page.locator('.li').first().click()
    await page.getByRole('button', { name: 'Editar' }).click()
    await expect(page.locator('#cEmail')).toHaveValue('maria@exemplo.com')
    await expect(page.locator('#cObs')).toHaveValue('Cliente antigo, paga sempre no dia 10')
    await page.keyboard.press('Escape')
    await verComo(page, 'Vendedor')
    await navegar(page, '/clientes')
    await page.locator('.li').first().click()
    await page.getByRole('button', { name: 'Editar' }).click()
    await expect(page.locator('#cEmail')).toHaveCount(0)
    await expect(page.locator('#cObs')).toHaveCount(0)
  })
})
