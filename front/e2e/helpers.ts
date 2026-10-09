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

export interface NovoEmp {
  /** só os dígitos, como o campo de dinheiro recebe (500000 = R$ 5.000,00) */
  capital: string
  tipo?: 'PARCELADO' | 'JUROS'
  freq?: 'MENSAL' | 'QUINZENAL' | 'SEMANAL' | 'DIARIA'
  n?: number
  taxa?: number
  primeira?: string
}

/** Abre Operações > Empréstimos e preenche os 3 passos até a tela de confirmar (não grava). */
export async function preencherEmprestimo(page: Page, e: NovoEmp) {
  await page.goto('/operacoes')
  await page.getByRole('button', { name: /Empréstimos/ }).click()
  await page.getByRole('button', { name: 'Empréstimo', exact: true }).click()
  await page.locator('[data-cliente]').first().click()
  await page.locator('#eCapital').fill(e.capital)
  await page.getByRole('button', { name: 'Continuar' }).click()
  if (e.freq) await page.locator(`[data-freq="${e.freq}"]`).click()
  if (e.tipo === 'JUROS') await page.locator('[data-mod="JUROS"]').click()
  if (e.n !== undefined) await page.fill('#eParcelas', String(e.n))
  if (e.taxa !== undefined) await page.fill('#eTaxa', String(e.taxa))
}

/** Do passo 2 para o 3 (opcionalmente trocando o 1º vencimento) e grava. */
export async function confirmarEmprestimo(page: Page, primeira?: string) {
  await page.getByRole('button', { name: 'Continuar' }).click()
  if (primeira) await page.fill('#ePrimeira', primeira)
  await page.getByRole('button', { name: 'Fazer empréstimo' }).click()
}
