import { expect, test, type Page } from '@playwright/test'
import { entrar, navegar, verComo } from './helpers'

const ehComputador = () => test.info().project.name === 'computador'
const numero = (t: string) => Number(t.replace(/[^\d,]/g, '').replace(',', '.'))
/** A primeira atrasada do indicador, na Cobrança. */
const primeira = (page: Page) => page.locator('.cob').first()

/** Indicador: vai à Cobrança e avisa que recebeu a primeira parcela atrasada (com o valor que quiser, ou o total). Devolve o nome do cliente. */
async function avisar(page: Page, valor?: string) {
  await navegar(page, '/cobranca')
  const linha = primeira(page)
  const nome = (await linha.locator('.t').first().innerText()).trim()
  await linha.getByRole('button', { name: 'Recebi' }).click()
  if (valor) await page.fill('#avValor', valor)
  await page.getByRole('button', { name: 'Avisar a loja que recebi' }).click()
  await expect(page.getByText(/Aviso enviado/)).toBeVisible()
  return nome
}
const cardBaixa = (page: Page, nome: string) => page.getByTestId('pedido').filter({ has: page.locator('[data-tipo="BAIXA"]'), hasText: nome })

test.describe('indicador avisa que recebeu', () => {
  test.beforeEach(async ({ page }) => { await entrar(page, 'indicador') })

  test('o Recebi abre o aviso com o valor da parcela, diz que não dá baixa e valida o que digitar', async ({ page }) => {
    await navegar(page, '/cobranca')
    await primeira(page).getByRole('button', { name: 'Recebi' }).click()
    await expect(page.getByRole('heading', { name: 'Avisar a loja que recebi' })).toBeVisible()
    await expect(page.getByText('Isto não dá baixa sozinho')).toBeVisible()
    const falta = numero(await page.locator('#avValor').inputValue())
    expect(falta).toBeGreaterThan(0)
    const enviar = page.getByRole('button', { name: 'Avisar a loja que recebi' })
    await expect(enviar).toBeEnabled()
    await page.fill('#avValor', String(Math.round(falta * 100) + 1)) // um centavo a mais
    await expect(enviar).toBeDisabled()
    await expect(page.getByText(/só tem R\$/)).toBeVisible()
    await page.fill('#avValor', '10000') // R$ 100,00: menos que a parcela
    await expect(page.getByTestId('menos')).toContainText('a loja decide')
    await page.fill('#avValor', '')
    await expect(enviar).toBeDisabled()
  })

  test('depois de avisar a parcela fica "esperando a loja" e some o botão Recebi (nada de baixa)', async ({ page }) => {
    await navegar(page, '/cobranca')
    const antes = numero(await page.getByTestId('cobrancas-total').innerText())
    const nome = await avisar(page)
    const linha = page.locator('.cob').filter({ hasText: nome }).first()
    await expect(linha.locator('[data-aguardando]')).toHaveText('esperando a loja')
    await expect(linha.getByRole('button', { name: 'Recebi' })).toHaveCount(0)
    expect(numero(await page.getByTestId('cobrancas-total').innerText())).toBe(antes) // continua em aberto
    await navegar(page, '/indicar')
    await expect(page.getByTestId('meus-avisos').locator('[data-aviso]').first()).toContainText(nome)
    await expect(page.getByTestId('meus-avisos').locator('[data-status]').first()).toHaveText('esperando a loja')
  })

  test('o botão central Novo abre as três opções do indicador', async ({ page }) => {
    const novo = ehComputador() ? page.locator('aside.side .novo') : page.locator('nav.tabs .vender')
    await novo.click()
    await expect(page.getByTestId('novo-opcoes').locator('[data-novo]')).toHaveCount(3)
    for (const [id, titulo] of [['recebi', 'Recebi de um cliente'], ['indicar', 'Indicar cliente'], ['simular', 'Só simular']]) await expect(page.locator(`[data-novo="${id}"]`)).toContainText(titulo)
    await page.locator('[data-novo="recebi"]').click()
    await expect(page.locator('h1')).toHaveText('Cobrança')
  })
})

test.describe('a loja responde ao aviso', () => {
  test('o administrador vê o aviso na Equipe e "Roberto avisou" na cobrança; CONFIRMAR dá a baixa e abre o recibo', async ({ page }) => {
    await entrar(page, 'indicador')
    const nome = await avisar(page)
    await verComo(page, 'Admin')
    await navegar(page, '/cobrancas')
    await expect(page.locator('.cob').filter({ hasText: nome }).locator('[data-baixa-pendente]').first()).toContainText('avisou')
    await navegar(page, '/equipe')
    const card = cardBaixa(page, nome)
    await expect(card).toContainText('avisou que recebeu')
    await expect(card).toContainText('Pix')
    await card.locator('[data-confirmar]').click()
    await expect(page.getByTestId('recibo')).toBeVisible()
    await expect(page.getByTestId('recibo')).toContainText(nome)
    await page.keyboard.press('Escape')
    await expect(card).toHaveCount(0)
    await verComo(page, 'Indicador')
    await navegar(page, '/indicar')
    await expect(page.getByTestId('meus-avisos').locator('[data-status]').first()).toHaveText('confirmado')
  })

  test('veio menos que a parcela: a loja escolhe o que fazer com o resto (fica devendo, com a data nova)', async ({ page }) => {
    await entrar(page, 'indicador')
    const nome = await avisar(page, '10000') // R$ 100,00
    await verComo(page, 'Admin')
    await navegar(page, '/equipe')
    await cardBaixa(page, nome).locator('[data-confirmar]').click()
    await expect(page.getByRole('heading', { name: 'E o resto da parcela?' })).toBeVisible()
    await expect(page.locator('[data-resto="FICA"]')).toBeChecked()
    await page.getByRole('button', { name: 'Confirmar baixa' }).last().click()
    await expect(page.getByTestId('recibo')).toBeVisible()
    await expect(page.getByTestId('recibo')).toContainText('R$ 100,00')
  })

  test('RECUSAR com motivo: o indicador vê "recusado" e o motivo, e o Recebi volta', async ({ page }) => {
    await entrar(page, 'indicador')
    const nome = await avisar(page)
    await verComo(page, 'Admin')
    await navegar(page, '/equipe')
    await cardBaixa(page, nome).getByRole('button', { name: 'Recusar' }).click()
    await page.fill('#mRecusa', 'Não bate com o que o cliente disse')
    await page.getByRole('button', { name: 'Recusar', exact: true }).last().click()
    await expect(cardBaixa(page, nome)).toHaveCount(0)
    await verComo(page, 'Indicador')
    await navegar(page, '/indicar')
    const aviso = page.getByTestId('meus-avisos').locator('[data-aviso]').first()
    await expect(aviso.locator('[data-status]')).toHaveText('recusado')
    await expect(aviso).toContainText('Não bate com o que o cliente disse')
    await navegar(page, '/cobranca')
    await expect(page.locator('.cob').filter({ hasText: nome }).first().getByRole('button', { name: 'Recebi' })).toBeVisible()
  })

  test('se a loja lançar o recebimento direto, o aviso do indicador é recusado sozinho', async ({ page }) => {
    await entrar(page, 'indicador')
    const nome = await avisar(page)
    await verComo(page, 'Admin')
    await navegar(page, '/cobrancas')
    await page.locator('.cob').filter({ hasText: nome }).first().getByRole('button', { name: 'Recebi' }).click()
    await page.getByRole('button', { name: 'Confirmar recebimento' }).click()
    await expect(page.getByTestId('recibo')).toBeVisible()
    await page.keyboard.press('Escape')
    await navegar(page, '/equipe')
    await expect(cardBaixa(page, nome)).toHaveCount(0)
    await verComo(page, 'Indicador')
    await navegar(page, '/indicar')
    await expect(page.getByTestId('meus-avisos').locator('[data-status]').first()).toHaveText('recusado')
  })
})
