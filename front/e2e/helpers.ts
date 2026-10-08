import { expect, type Page } from '@playwright/test'

export const SENHA = 'demo1234'

/** Entra no modo demonstração com uma das contas de exemplo. */
export async function entrar(page: Page, conta: 'admin' | 'vendedor' | 'cobrador' | 'indicador' = 'admin') {
  await page.goto('/login')
  await page.fill('#email', `${conta}@demo.com`)
  await page.fill('#senha', SENHA)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.locator('h1')).toBeVisible()
}

export const botaoNovo = (page: Page, nome: string) => page.getByRole('button', { name: nome, exact: true })
