import { expect, test, type Page } from '@playwright/test'
import { confirmarEmprestimo, entrar, preencherEmprestimo } from './helpers'

// Cria dois só juros de 3.000 a 12% em 3x para o mesmo cliente (cada um deve 4.080,00 → 8.160,00 juntos; capital na rua 6.000,00).
// Sem recarregar a página entre os dois: a demonstração guarda tudo na memória.
async function doisDoMesmoCliente(page: Page): Promise<string> {
  await entrar(page)
  await preencherEmprestimo(page, { capital: '300000', tipo: 'JUROS', n: 3, taxa: 12 })
  await confirmarEmprestimo(page)
  await expect(page.getByTestId('dados-admin')).toContainText('3.000,00')
  const nome = (await page.locator('.sheet h3').first().innerText()).trim()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Empréstimo', exact: true }).click()
  await page.locator('[data-cliente]').first().click()
  await page.locator('#eCapital').fill('300000')
  await page.getByRole('button', { name: 'Continuar' }).click()
  await page.locator('[data-mod="JUROS"]').click()
  await page.fill('#eParcelas', '3'); await page.fill('#eTaxa', '12')
  await confirmarEmprestimo(page)
  await expect(page.getByTestId('dados-admin')).toContainText('3.000,00')
  expect((await page.locator('.sheet h3').first().innerText()).trim()).toBe(nome)
  await page.keyboard.press('Escape')
  return nome
}
const campoBusca = (page: Page) => page.getByRole('searchbox', { name: 'Buscar empréstimo' })

test.describe('unificar empréstimos (administrador)', () => {
  test('Selecionar: marca dois do mesmo cliente, vê a conta, escolhe semanal e o empréstimo novo nasce com tudo somado', async ({ page }) => {
    const nome = await doisDoMesmoCliente(page)
    await campoBusca(page).fill(nome)
    // o cliente da demonstração já tinha um empréstimo (com parcela paga): só os dois novos, que ainda não receberam nada
    const cards = page.locator('[data-emprestimo]').filter({ hasText: 'R$ 0 de R$ 4.080' })
    await expect(cards).toHaveCount(2)
    await page.locator('[data-selecionar]').click()
    await expect(page.getByTestId('barra-selecao')).toBeVisible()
    await expect(page.locator('[data-unificar-marcados]')).toBeDisabled()
    await cards.nth(0).click()
    await expect(cards.nth(0)).toHaveAttribute('data-marcado', 'true')
    await expect(page.locator('[data-unificar-marcados]')).toBeDisabled() // com um só não dá
    await cards.nth(1).click()
    await expect(page.locator('[data-unificar-marcados]')).toBeEnabled()
    await page.locator('[data-unificar-marcados]').click()

    await expect(page.getByRole('heading', { name: 'Unificar empréstimos' })).toBeVisible()
    await expect(page.getByTestId('unificar-saldo')).toContainText('8.160,00')
    await expect(page.getByTestId('unificar-capital')).toContainText('6.000,00')
    await expect(page.locator('#uValor')).toHaveValue('8.160,00')
    // dinheiro novo e o juro dele: o valor soma sozinho e o capital do novo também
    await page.locator('#uNovo').fill('150000')
    await page.locator('#uJurosNovo').fill('50000')
    await expect(page.getByTestId('unificar-conta')).toContainText('= R$ 10.160,00')
    await expect(page.locator('#uValor')).toHaveValue('10.160,00')
    await expect(page.getByTestId('unificar-capital-novo')).toContainText('7.500,00')
    await page.getByRole('button', { name: '4x', exact: true }).click()
    await page.locator('[data-periodicidade="SEMANAL"]').click()
    await page.locator('#uData').fill('01/12/2026')
    await expect(page.locator('[data-parcela-unificar]')).toHaveCount(4)
    await expect(page.locator('[data-parcela-unificar="2"]')).toContainText('08/12')
    await page.getByRole('button', { name: 'Unificar empréstimos', exact: true }).last().click()
    await expect(page.getByText('Empréstimos unificados.')).toBeVisible()

    // abre a ficha do novo: capital 7.500 (6.000 que estavam na rua + 1.500 novos), 4 parcelas semanais
    const ficha = page.getByTestId('dados-admin')
    await expect(ficha).toContainText('7.500,00')
    await expect(page.getByTestId('unificado-de')).toContainText('Unificado a partir dos empréstimos')
    await expect(page.locator('.timeline i')).toHaveCount(4)
    await expect(ficha).toContainText('Parcelas por vir') // o plano é o que vem pela frente, não o histórico
    // botão para consultar os empréstimos de antes (só leitura)
    await page.locator('[data-consultar]').first().click()
    await expect(page.getByTestId('consulta-titulo')).toContainText('só consulta')
    await expect(page.getByTestId('consulta-dados')).toContainText('3.000,00') // capital que passou para o novo
    await expect(page.getByTestId('consulta-dados')).toContainText('4.080,00') // em aberto na unificação
  })

  test('com um marcado, os empréstimos de outro cliente ficam apagados; Cancelar sai do modo', async ({ page }) => {
    await entrar(page)
    await page.goto('/operacoes')
    await page.getByRole('button', { name: /^Empréstimos/ }).click()
    const cards = page.locator('[data-emprestimo]')
    await expect(cards.nth(1)).toBeVisible()
    await page.locator('[data-selecionar]').click()
    await cards.first().click()
    await expect(cards.first()).toHaveAttribute('data-marcado', 'true')
    await expect(cards.nth(1)).toBeDisabled()
    await page.locator('[data-selecionar]').click() // virou "Cancelar"
    await expect(page.getByTestId('barra-selecao')).toHaveCount(0)
    await expect(cards.nth(1)).toBeEnabled()
    await cards.first().click() // fora do modo, abre a ficha normalmente
    await expect(page.getByTestId('dados-admin')).toBeVisible()
  })

  test('pela ficha: "Unificar com outro empréstimo" abre a folha com o dela marcado', async ({ page }) => {
    const nome = await doisDoMesmoCliente(page)
    await campoBusca(page).fill(nome)
    await page.locator('[data-emprestimo]').filter({ hasText: 'R$ 0 de R$ 4.080' }).first().click()
    await page.locator('[data-unificar]').click()
    await expect(page.getByRole('heading', { name: 'Unificar empréstimos' })).toBeVisible()
    await expect(page.locator('[data-unificar-item]').first()).toBeVisible()
    await expect(page.getByTestId('problema-unificar')).toContainText('pelo menos 2')
    const novos = page.locator('[data-unificar-item]').filter({ hasText: 'R$ 4.080,00' })
    await expect(novos).toHaveCount(2)
    await novos.nth(1).locator('input').check()
    await expect(page.getByTestId('problema-unificar')).toHaveCount(0)
    await expect(page.getByTestId('unificar-saldo')).toContainText('8.160,00')
    await page.getByRole('button', { name: 'Unificar empréstimos', exact: true }).last().click()
    await expect(page.getByText('Empréstimos unificados.')).toBeVisible()
  })
})

test('o cobrador não vê o botão Selecionar nem Unificar', async ({ page }) => {
  await entrar(page, 'cobrador')
  await page.goto('/cobrancas')
  await expect(page.locator('[data-selecionar], [data-unificar]')).toHaveCount(0)
})
