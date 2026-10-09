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
  if (primeira) await page.fill('#ePrimeira', br(primeira))
  await page.getByRole('button', { name: 'Fazer empréstimo' }).click()
}

/** 2026-10-15 → 15/10/2026 (os campos de data aceitam dd/mm/aaaa). */
export const br = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

/** Sai do sistema pelo caminho de cada tela: lateral no computador; no celular, o "Mais" (administrador) ou "Minha conta" (os outros). */
export async function sair(page: Page) {
  if (await page.locator('aside.side').isVisible()) {
    await page.locator('aside.side').getByRole('button', { name: /^Sair/ }).click()
    return
  }
  const mais = page.locator('nav.tabs').getByRole('button', { name: /^Mais/ })
  if (await mais.count()) await mais.click()
  else await page.getByRole('button', { name: 'Minha conta' }).click()
  await page.getByRole('button', { name: 'Sair do sistema' }).click()
}
