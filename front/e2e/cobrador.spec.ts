import { expect, test, type Page } from '@playwright/test'
import { entrar } from './helpers'

/** Vai para uma tela pelo menu que está visível (barra de baixo no celular, lateral no computador): a memória da demonstração não zera. */
const irPara = async (page: Page, nome: string) => { await page.locator('.side, .tabs').getByRole('button', { name: new RegExp('^' + nome + '( \\d+)?$') }).filter({ visible: true }).first().click() }
const numero = (t: string) => Number(t.replace(/[^\d,]/g, '').replace(',', '.'))

test.describe('cobrador', () => {
  test.beforeEach(async ({ page }) => { await entrar(page, 'cobrador') })

  test('entra em Hoje: quanto cobrar, atrasadas, vencem hoje e próximos 7 dias, só da carteira dele', async ({ page }) => {
    await expect(page.getByTestId('cobrar-hoje')).toContainText('R$')
    await expect(page.getByTestId('secao-atrasadas')).toBeVisible()
    await expect(page.getByTestId('secao-hoje')).toBeVisible()
    await expect(page.getByTestId('secao-proximos')).toBeVisible()
    await expect(page.getByTestId('secao-atrasadas').locator('.cob').first()).toBeVisible()
    for (const t of await page.getByTestId('secao-atrasadas').locator('.cob').allInnerTexts()) expect(t).toMatch(/Fernanda|Carlos|Ana Paula|João/)
    await expect(page.locator('body')).not.toContainText(/lucro|capital|custo/i)
  })

  test('Recebi pela linha de Hoje: abre o recibo e o total a cobrar cai', async ({ page }) => {
    const antes = numero(await page.getByTestId('cobrar-hoje').innerText())
    await page.getByTestId('secao-atrasadas').locator('.cob').first().getByRole('button', { name: 'Recebi' }).click()
    await page.getByRole('button', { name: 'Confirmar recebimento' }).click()
    await expect(page.getByTestId('recibo')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect.poll(async () => numero(await page.getByTestId('cobrar-hoje').innerText())).toBeLessThan(antes)
  })

  test('Recebi (botão central): achar o cliente pelo nome, sem acento e sem maiúscula', async ({ page }) => {
    await irPara(page, 'Recebi')
    await expect(page.locator('.cob').first()).toBeVisible()
    await page.getByLabel('Buscar cliente').fill('CARLOS')
    await expect(page.locator('.cob').first()).toContainText('Carlos')
    for (const t of await page.locator('.cob').allInnerTexts()) expect(t).toContain('Carlos')
    await page.getByLabel('Buscar cliente').fill('joao')
    await page.locator('.seg').getByRole('button', { name: 'Próximas' }).click()
    await page.getByLabel('Buscar cliente').fill('zzzz')
    await expect(page.getByText('Ninguém com esse nome nesta lista.')).toBeVisible()
  })

  test('Carteira: os clientes dele, filtros e a ficha do cliente com as operações', async ({ page }) => {
    await irPara(page, 'Carteira')
    const lista = page.getByTestId('carteira')
    await expect(lista.locator('[data-cliente]')).toHaveCount(4)
    await page.locator('.seg').getByRole('button', { name: /Atrasados/ }).click()
    for (const t of await lista.locator('[data-cliente]').allInnerTexts()) expect(t).toContain('atrasada')
    await page.locator('.seg').getByRole('button', { name: /Todos/ }).click()
    await page.getByLabel('Buscar cliente').fill('carlos')
    await expect(lista.locator('[data-cliente]')).toHaveCount(1)
    await lista.locator('[data-cliente]').click()
    await expect(page.getByTestId('operacoes-do-cliente').locator('[data-operacao]').first()).toBeVisible()
    await expect(page.getByRole('link', { name: 'Chamar no WhatsApp' })).toBeVisible()
  })

  test('pede desconto pela ficha da venda; o pedido aparece em Pedidos como esperando', async ({ page }) => {
    await irPara(page, 'Carteira')
    await page.getByLabel('Buscar cliente').fill('carlos')
    await page.getByTestId('carteira').locator('[data-cliente]').click()
    await page.getByTestId('operacoes-do-cliente').locator('[data-operacao]').first().click()
    await page.locator('[data-desconto]').first().click()
    await page.locator('#dValor').fill('5000')
    await expect(page.getByTestId('problema-desconto')).toContainText('motivo')
    await page.locator('#dMotivo').fill('Cliente pagou o resto em dinheiro')
    await page.getByRole('button', { name: 'Pedir desconto', exact: true }).last().click()
    await expect(page.getByText('Pedido de desconto enviado')).toBeVisible()
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape')
    await irPara(page, 'Pedidos')
    await expect(page.getByTestId('pedidos-esperando')).toContainText('Desconto de R$ 50,00')
  })

  test('pede acordo e retomada pela ficha; os dois ficam esperando em Pedidos', async ({ page }) => {
    await irPara(page, 'Carteira')
    await page.getByLabel('Buscar cliente').fill('fernanda')
    await page.getByTestId('carteira').locator('[data-cliente]').click()
    await page.getByTestId('operacoes-do-cliente').locator('[data-operacao]').first().click()
    await page.locator('[data-acordo]').click()
    await expect(page.getByRole('heading', { name: 'Pedir acordo' })).toBeVisible()
    await page.locator('#aMotivo').fill('Perdeu o emprego')
    await page.getByRole('button', { name: 'Pedir acordo', exact: true }).last().click()
    await expect(page.getByText('Pedido de acordo enviado')).toBeVisible()
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape')
    await irPara(page, 'Pedidos')
    await expect(page.getByTestId('pedidos-esperando')).toContainText('Acordo de')
  })

  test('Pedidos mostra os respondidos com o motivo da recusa', async ({ page }) => {
    await irPara(page, 'Pedidos')
    await expect(page.getByTestId('pedidos-esperando').locator('[data-pedido]').first()).toBeVisible()
    await expect(page.getByTestId('pedidos-respondidos')).toBeVisible()
  })

  test('Caixa: soma por forma, lista com recibo e "Fechar o dia"; depois de fechar não recebe mais', async ({ page }) => {
    // recebe em dinheiro pela tela de Hoje
    await page.getByTestId('secao-atrasadas').locator('.cob').first().getByRole('button', { name: 'Recebi' }).click()
    await page.getByRole('button', { name: 'Dinheiro', exact: true }).click()
    await page.getByRole('button', { name: 'Confirmar recebimento' }).click()
    await expect(page.getByTestId('recibo')).toBeVisible()
    await page.keyboard.press('Escape')
    await irPara(page, 'Caixa')
    await expect(page.getByTestId('caixa-dinheiro')).not.toContainText('R$ 0,00')
    await expect(page.getByTestId('recebimentos-do-dia').locator('[data-recebimento]')).toHaveCount(1)
    await page.locator('[data-fechar]').click()
    await page.getByRole('button', { name: 'Fechar o dia', exact: true }).last().click()
    await expect(page.getByTestId('dia-fechado')).toContainText('esperando conferência')
    await expect(page.locator('[data-fechar]')).toHaveCount(0)
    // fechado: tentar receber de novo é recusado com o motivo
    await irPara(page, 'Hoje')
    await page.getByTestId('secao-atrasadas').locator('.cob').first().getByRole('button', { name: 'Recebi' }).click()
    await page.getByRole('button', { name: 'Confirmar recebimento' }).click()
    await expect(page.getByRole('alert')).toContainText('dia já foi fechado')
  })
})
