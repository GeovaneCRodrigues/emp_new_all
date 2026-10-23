import { expect, test } from '@playwright/test'
import { confirmarEmprestimo, entrar, navegar, verComo } from './helpers'

/** Abre o empréstimo novo e preenche só o passo 1 (cliente e valor); a origem do dinheiro também é escolhida nele. */
async function abrirPasso1(page: import('@playwright/test').Page, capital: string) {
  await page.goto('/operacoes')
  await page.getByRole('button', { name: /Empréstimos/ }).click()
  await page.getByRole('button', { name: 'Empréstimo', exact: true }).click()
  await page.locator('[data-cliente]').first().click()
  await page.locator('#eCapital').fill(capital)
}

const numero = (t: string) => Number(t.replace(/[^\d,-]/g, '').replace(',', '.'))

test.describe('conta corrente do indicador (administrador)', () => {
  test('empréstimo novo "saiu da conta do indicador": a conta do indicador mostra o empréstimo e o saldo cai', async ({ page }) => {
    await entrar(page)
    await abrirPasso1(page, '100000') // R$ 1.000,00
    await page.locator('[data-origem="CONTA"]').click()
    await page.locator('[data-origem-ind]').selectOption({ index: 1 })
    await page.locator('#eOrigemValor').fill('60000') // R$ 600,00
    const nomeInd = (await page.locator('[data-origem-ind] option:checked').innerText()).trim()
    await page.getByRole('button', { name: 'Continuar' }).click()
    await page.fill('#eParcelas', '2'); await page.fill('#eTaxa', '10')
    await confirmarEmprestimo(page)
    await expect(page.getByTestId('dados-admin')).toContainText('1.000,00')
    await navegar(page, '/indicadores')
    await page.getByRole('button', { name: /Conta corrente/ }).click()
    const linha = page.locator('[data-conta]').filter({ hasText: nomeInd })
    await expect(linha).toBeVisible()
    await linha.click()
    const ficha = page.getByRole('dialog')
    await expect(ficha.locator('[data-lancamento="EMPRESTIMO"]').first()).toContainText('600,00')
  })

  test('não deixa a conta do indicador passar do valor do empréstimo', async ({ page }) => {
    await entrar(page)
    await abrirPasso1(page, '100000')
    await page.locator('[data-origem="CONTA"]').click()
    await page.locator('[data-origem-ind]').selectOption({ index: 1 })
    await page.locator('#eOrigemValor').fill('100001') // R$ 1.000,01
    await expect(page.getByTestId('problema-origem')).toContainText('não pode passar')
    await expect(page.getByRole('button', { name: 'Continuar' })).toBeDisabled()
  })
})

test.describe('baixa que caiu na conta do indicador', () => {
  /** O indicador avisa a primeira parcela atrasada dele; devolve o nome do cliente e o do indicador, já como administrador. */
  async function avisarEIrParaEquipe(page: import('@playwright/test').Page) {
    await entrar(page, 'indicador')
    await navegar(page, '/cobranca')
    const linha = page.locator('.cob').first()
    const cliente = (await linha.locator('.t').first().innerText()).trim()
    await linha.getByRole('button', { name: 'Recebi' }).click()
    await page.getByRole('button', { name: 'Avisar a loja que recebi' }).click()
    await expect(page.getByText(/Aviso enviado/)).toBeVisible()
    await verComo(page, 'Admin')
    await navegar(page, '/equipe')
    return cliente
  }
  const card = (page: import('@playwright/test').Page, cliente: string) => page.getByTestId('pedido').filter({ has: page.locator('[data-tipo="BAIXA"]'), hasText: cliente })

  test('a loja marca "caiu na conta" ao confirmar: o valor aparece como COBROU na conta do indicador', async ({ page }) => {
    const cliente = await avisarEIrParaEquipe(page)
    const c = card(page, cliente)
    const indicador = (await c.locator('[data-tipo="BAIXA"]').innerText()).split(' ')[0]
    await expect(c.locator('[data-na-conta]')).not.toBeChecked()
    await c.locator('[data-na-conta]').check()
    await c.locator('[data-confirmar]').click()
    await expect(page.getByTestId('recibo')).toBeVisible()
    await page.keyboard.press('Escape')
    await navegar(page, '/indicadores')
    await page.getByRole('button', { name: /Conta corrente/ }).click()
    await page.locator('[data-conta]').filter({ hasText: indicador }).click()
    await expect(page.getByRole('dialog').locator('[data-lancamento="COBROU"]').filter({ hasText: cliente.split(' ')[0] })).toBeVisible()
  })

  test('sem marcar, o valor NÃO vai para a conta do indicador (continua indo para a loja)', async ({ page }) => {
    const cliente = await avisarEIrParaEquipe(page)
    const c = card(page, cliente)
    const indicador = (await c.locator('[data-tipo="BAIXA"]').innerText()).split(' ')[0]
    await navegar(page, '/indicadores')
    await page.getByRole('button', { name: /Conta corrente/ }).click()
    const saldoAntes = numero(await page.locator('[data-conta]').filter({ hasText: indicador }).locator('[data-saldo]').innerText())
    await navegar(page, '/equipe')
    await card(page, cliente).locator('[data-confirmar]').click()
    await expect(page.getByTestId('recibo')).toBeVisible()
    await page.keyboard.press('Escape')
    await navegar(page, '/indicadores')
    await page.getByRole('button', { name: /Conta corrente/ }).click()
    expect(numero(await page.locator('[data-conta]').filter({ hasText: indicador }).locator('[data-saldo]').innerText())).toBe(saldoAntes)
  })
})
