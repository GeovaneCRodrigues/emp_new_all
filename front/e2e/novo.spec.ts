import { expect, test, type Page } from '@playwright/test'
import { entrar } from './helpers'

const novo = (page: Page) => page.locator('.side, .tabs').getByRole('button', { name: /^Novo$/ }).filter({ visible: true }).first()

test.describe('botão Novo (administrador)', () => {
  test.beforeEach(async ({ page }) => { await entrar(page) })

  test('abre a escolha entre venda, empréstimo e só simular', async ({ page }) => {
    await novo(page).click()
    await expect(page.getByRole('heading', { name: 'O que você quer fazer?' })).toBeVisible()
    await expect(page.getByTestId('novo-opcoes').locator('[data-novo]')).toHaveCount(3)
    await expect(page.locator('[data-novo="venda"]')).toContainText('Venda de iPhone')
    await expect(page.locator('[data-novo="emprestimo"]')).toContainText('Empréstimo')
    await expect(page.locator('[data-novo="simular"]')).toContainText('Só simular')
  })

  test('Venda de iPhone leva para a nova venda', async ({ page }) => {
    await novo(page).click()
    await page.locator('[data-novo="venda"]').click()
    await expect(page).toHaveURL(/\/vender/)
    await expect(page.getByRole('heading', { name: 'O que você quer fazer?' })).toBeHidden()
  })

  test('Empréstimo abre as Operações já com o formulário do novo empréstimo', async ({ page }) => {
    await novo(page).click()
    await page.locator('[data-novo="emprestimo"]').click()
    await expect(page).toHaveURL(/\/operacoes/)
    await expect(page.getByRole('heading', { name: 'Novo empréstimo' })).toBeVisible()
    await expect(page.locator('[data-passo="1"]')).toBeVisible()
    await expect(page).not.toHaveURL(/novo=/) // a pergunta some do endereço
  })

  test('Só simular leva para o simulador', async ({ page }) => {
    await novo(page).click()
    await page.locator('[data-novo="simular"]').click()
    await expect(page).toHaveURL(/\/simulador/)
  })

  test('Esc fecha a escolha sem ir a lugar nenhum', async ({ page }) => {
    const url = page.url()
    await novo(page).click()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('heading', { name: 'O que você quer fazer?' })).toBeHidden()
    expect(page.url()).toBe(url)
  })
})

test.describe('botão Vender (vendedor)', () => {
  test('o vendedor continua com "Vender" direto, sem a escolha', async ({ page }) => {
    await entrar(page, 'vendedor')
    await page.locator('.side, .tabs').getByRole('button', { name: /^(Vender|Nova venda)$/ }).filter({ visible: true }).first().click()
    await expect(page).toHaveURL(/\/vender/)
  })
})
