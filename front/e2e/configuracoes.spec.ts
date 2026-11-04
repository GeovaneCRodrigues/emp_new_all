import { expect, test, type Page } from '@playwright/test'
import { entrar, navegar } from './helpers'

// um PNG de 1x1 pixel (o formulário reduz e regrava, então o conteúdo não importa)
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

async function abrir(page: Page) {
  await entrar(page, 'admin')
  await navegar(page, '/config')
  await expect(page.getByTestId('config')).toBeVisible()
  await expect(page.locator('#eNome')).toHaveValue('Mundo dos iPhones LTDA')
}

test.describe('configurações: dados da empresa', () => {
  test('o menu Configurações abre os dados da empresa (e não mais "em breve")', async ({ page }) => {
    await abrir(page)
    await expect(page.getByTestId('config')).toContainText('Logo da empresa')
    await expect(page.getByTestId('config')).toContainText('Pix da loja')
    await expect(page.getByTestId('config')).toContainText('Taxas do contrato')
  })

  test('telefone, cidade/UF e Pix: salva, valida e lembra', async ({ page }) => {
    await abrir(page)
    await page.fill('#eTel', '1133334444')
    await expect(page.locator('#eTel')).toHaveValue('(11) 3333-4444')
    await page.fill('#eCidade', 'Taboão da Serra'); await page.fill('#eUf', 's1')
    await page.getByTestId('pix-chave').fill('59.215.794/0001-53')
    await page.getByTestId('ct-salvar-empresa').click()
    await expect(page.getByTestId('ct-empresa-erro')).toContainText('UF')
    await page.fill('#eUf', 'sp')
    await page.getByTestId('ct-salvar-empresa').click()
    await expect(page.getByTestId('ct-empresa-msg')).toContainText('salvos')
    await expect(page.locator('#eUf')).toHaveValue('SP')
    await expect(page.locator('#eTel')).toHaveValue('(11) 3333-4444')
    await expect(page.getByTestId('pix-chave')).toHaveValue('59.215.794/0001-53')
  })

  test('cidade e UF saem na data do contrato', async ({ page }) => {
    await abrir(page)
    await page.fill('#eCidade', 'Osasco')
    await page.getByTestId('ct-salvar-empresa').click()
    await expect(page.getByTestId('ct-empresa-msg')).toBeVisible()
    await navegar(page, '/contratos')
    await page.locator('[data-contrato]').first().click()
    await expect(page.getByTestId('ficha-texto')).toContainText('Osasco, ')
  })

  test('logo: envia, aparece na prévia, e remove', async ({ page }) => {
    await abrir(page)
    await expect(page.getByTestId('logo-previa')).toContainText('sem logo')
    await expect(page.getByTestId('logo-remover')).toHaveCount(0)
    await page.getByTestId('logo-arquivo').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG_1X1 })
    await expect(page.getByTestId('logo-msg')).toContainText('Logo salva')
    await expect(page.getByTestId('logo-previa').locator('img')).toBeVisible()
    await page.getByTestId('logo-remover').click()
    await expect(page.getByTestId('logo-msg')).toContainText('removida')
    await expect(page.getByTestId('logo-previa')).toContainText('sem logo')
  })

  test('arquivo que não é imagem aceita é recusado com aviso', async ({ page }) => {
    await abrir(page)
    await page.getByTestId('logo-arquivo').setInputFiles({ name: 'logo.gif', mimeType: 'image/gif', buffer: Buffer.from('GIF89a') })
    await expect(page.getByTestId('logo-erro')).toContainText('PNG, JPEG ou WEBP')
  })

  test('a logo aparece na página de assinatura do cliente', async ({ page }) => {
    await abrir(page)
    await page.getByTestId('logo-arquivo').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG_1X1 })
    await expect(page.getByTestId('logo-msg')).toContainText('Logo salva')
    // venda → link → página do cliente (mesmo app, sem recarregar)
    await navegar(page, '/vender')
    await page.locator('[data-aparelho]').first().click()
    await page.locator('[data-cliente]').first().click()
    await page.getByTestId('completar-cliente').click()
    await page.fill('#cCpf', '52998224725'); await page.fill('#cEnd', 'Rua A'); await page.fill('#cCidade', 'Santos')
    await page.getByRole('button', { name: 'Salvar alterações' }).click()
    await page.getByRole('button', { name: 'Confirmar venda' }).click()
    await page.getByTestId('venda-contrato').click()
    await page.getByTestId('ficha-gerar-link').click()
    const caminho = new URL(await page.getByTestId('ficha-link-url').innerText()).pathname
    await page.evaluate((c) => { history.pushState({}, '', c); window.dispatchEvent(new PopStateEvent('popstate')) }, caminho)
    await expect(page.getByTestId('assinar-logo')).toBeVisible()
  })

  test('o vendedor não tem Configurações (a rota mostra "em breve")', async ({ page }) => {
    await entrar(page, 'vendedor')
    await navegar(page, '/config')
    await expect(page.getByTestId('config')).toHaveCount(0)
  })
})
