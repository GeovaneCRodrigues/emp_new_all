import { expect, test } from '@playwright/test'
import { entrar, sair } from './helpers'

test.describe('login e sessão', () => {
  test('senha errada mostra o erro e não entra', async ({ page }) => {
    await page.goto('/login')
    await page.fill('#email', 'admin@demo.com')
    await page.fill('#senha', 'errada-errada')
    await page.getByRole('button', { name: 'Entrar' }).click()
    await expect(page.getByRole('alert')).toHaveText('E-mail ou senha incorretos')
    await expect(page).toHaveURL(/\/login/)
  })

  test('entra, mantém a sessão ao recarregar e sai', async ({ page }) => {
    await entrar(page)
    await expect(page).toHaveURL('/')
    await expect(page.locator('h1')).toHaveText('Início')
    await page.reload()
    await expect(page.locator('h1')).toHaveText('Início')
    await sair(page)
    await expect(page).toHaveURL(/\/login$/)
  })

  test('rota protegida manda para o login e volta para ela depois de entrar', async ({ page }) => {
    await page.goto('/estoque')
    await expect(page).toHaveURL(/\/login\?volta=\/estoque/)
    await page.fill('#email', 'admin@demo.com')
    await page.fill('#senha', 'demo1234')
    await page.getByRole('button', { name: 'Entrar' }).click()
    await expect(page).toHaveURL(/\/estoque$/)
    await expect(page.locator('h1')).toHaveText('Estoque')
  })

  test('depois de sair, as rotas protegidas voltam a pedir login', async ({ page }) => {
    await entrar(page)
    await sair(page)
    await page.goto('/cobrancas')
    await expect(page).toHaveURL(/\/login/)
  })

  test('não deixa o "volta" levar para outro site', async ({ page }) => {
    await page.goto('/login?volta=//site-mal-intencionado.com')
    await page.fill('#email', 'admin@demo.com')
    await page.fill('#senha', 'demo1234')
    await page.getByRole('button', { name: 'Entrar' }).click()
    await expect(page).toHaveURL('/')
  })
})
