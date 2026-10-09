import { expect, test } from '@playwright/test'
import { entrar } from './helpers'

const pedidos = (page: import('@playwright/test').Page) => page.getByTestId('pedido')

test.describe('equipe', () => {
  test('mostra o que espera o administrador: pedidos de desconto e fechamento para conferir', async ({ page }) => {
    await entrar(page)
    await page.goto('/equipe')
    await expect(pedidos(page)).toHaveCount(2)
    await expect(pedidos(page).first()).toContainText('Diego Ramos pede')
    await expect(page.getByTestId('fechamento')).toHaveCount(1)
    await expect(page.getByTestId('pessoa')).toHaveCount(3)
  })

  test('aprovar tira o pedido da lista; recusar pede o motivo (opcional) e também tira', async ({ page }) => {
    await entrar(page)
    await page.goto('/equipe')
    await pedidos(page).first().getByRole('button', { name: 'Aprovar' }).click()
    await expect(pedidos(page)).toHaveCount(1)
    await pedidos(page).first().getByRole('button', { name: 'Recusar' }).click()
    await page.locator('#mRecusa').fill('Margem apertada')
    await page.getByRole('button', { name: 'Recusar', exact: true }).last().click()
    await expect(pedidos(page)).toHaveCount(0)
  })

  test('conferir o fechamento tira da lista', async ({ page }) => {
    await entrar(page)
    await page.goto('/equipe')
    await page.getByTestId('fechamento').getByRole('button', { name: 'Conferido' }).click()
    await expect(page.getByTestId('fechamento')).toHaveCount(0)
  })

  test('convida uma pessoa: mostra a senha temporária uma vez e ela entra na lista', async ({ page }) => {
    await entrar(page)
    await page.goto('/equipe')
    await page.getByRole('button', { name: 'Convidar' }).click()
    await page.fill('#cNome', 'Paulo Mendes')
    await page.fill('#cEmail', 'paulo@loja.com')
    await page.getByRole('button', { name: 'Criar acesso' }).click()
    await expect(page.getByTestId('senha-temporaria')).toContainText('paulo@loja.com')
    await page.getByRole('button', { name: 'Pronto' }).click()
    await expect(page.getByTestId('pessoa').filter({ hasText: 'Paulo Mendes' })).toBeVisible()
  })

  test('desativar e reativar uma pessoa', async ({ page }) => {
    await entrar(page)
    await page.goto('/equipe')
    const bruna = page.getByTestId('pessoa').filter({ hasText: 'Bruna Teixeira' })
    await bruna.getByRole('button', { name: 'Desativar' }).click()
    await expect(bruna).toContainText('sem acesso')
    await bruna.getByRole('button', { name: 'Reativar' }).click()
    await expect(bruna).not.toContainText('sem acesso')
  })

  test('e-mail repetido mostra o erro na própria folha', async ({ page }) => {
    await entrar(page)
    await page.goto('/equipe')
    await page.getByRole('button', { name: 'Convidar' }).click()
    await page.fill('#cNome', 'Outro Diego')
    await page.fill('#cEmail', 'cobrador@demo.com')
    await page.getByRole('button', { name: 'Criar acesso' }).click()
    await expect(page.getByRole('alert')).toContainText('e-mail')
  })
})
