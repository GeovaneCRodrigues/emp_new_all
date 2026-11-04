import { expect, test, type Page } from '@playwright/test'
import { entrar } from './helpers'

/** A demonstração guarda tudo na memória: para "abrir o link no celular do cliente" navega dentro do mesmo app (sem recarregar). */
async function irPara(page: Page, caminho: string) {
  await page.evaluate((c) => { history.pushState({}, '', c); window.dispatchEvent(new PopStateEvent('popstate')) }, caminho)
}

/** Faz uma venda de verdade na demonstração, completando o cliente na própria tela e mandando gerar o link. */
async function vendaComLink(page: Page) {
  await entrar(page, 'admin')
  await page.goto('/vender')
  await page.locator('[data-aparelho]').first().click()
  await page.locator('[data-cliente]').first().click()
  // cartão "Dados do contrato": o cliente da demonstração não tem CPF nem endereço
  const cartao = page.getByTestId('dados-contrato')
  await expect(cartao).toContainText('falta preencher')
  await expect(page.getByTestId('dados-contrato-cliente')).toContainText('CPF')
  await page.getByTestId('completar-cliente').click()
  await page.fill('#cCpf', '52998224725')
  await page.fill('#cEnd', 'Rua Érico Veríssimo')
  await page.fill('#cNum', '25')
  await page.fill('#cBairro', 'Vila Indiana')
  await page.fill('#cCidade', 'Taboão da Serra')
  await page.fill('#cUf', 'sp')
  await page.fill('#cCep', '06786490')
  await page.getByRole('button', { name: 'Salvar alterações' }).click()
  await expect(cartao).toContainText('completo')
  await page.getByRole('button', { name: 'Confirmar venda' }).click()
  await page.getByTestId('venda-contrato').click()
  await page.getByTestId('ficha-gerar-link').click()
  await expect(page.getByTestId('ficha-link')).toBeVisible()
  const url = await page.getByTestId('ficha-link-url').innerText()
  return { caminho: new URL(url).pathname }
}

/** Mesma venda, mas indo pelo ZapSign em vez do link próprio. */
async function vendaPeloZapsign(page: Page) {
  await entrar(page, 'admin')
  await page.goto('/vender')
  await page.locator('[data-aparelho]').first().click()
  await page.locator('[data-cliente]').first().click()
  await page.getByTestId('completar-cliente').click()
  await page.fill('#cCpf', '52998224725'); await page.fill('#cEnd', 'Rua Érico Veríssimo'); await page.fill('#cCidade', 'Taboão da Serra')
  await page.getByRole('button', { name: 'Salvar alterações' }).click()
  await page.getByRole('button', { name: 'Confirmar venda' }).click()
  await page.getByTestId('venda-contrato').click()
}

async function assinarComODedo(page: Page) {
  await page.getByTestId('assinatura-campo').scrollIntoViewIfNeeded()
  const caixa = (await page.getByTestId('assinatura-campo').boundingBox())!
  await page.mouse.move(caixa.x + 30, caixa.y + 40)
  await page.mouse.down()
  for (let i = 1; i <= 14; i++) await page.mouse.move(caixa.x + 30 + i * 18, caixa.y + 40 + (i % 2 ? 40 : 0))
  await page.mouse.up()
}

test.describe('assinatura do contrato pelo link', () => {
  test('venda → completa o cliente → gera o link → o cliente assina → o contrato fica assinado com a prova', async ({ page }) => {
    const { caminho } = await vendaComLink(page)
    expect(caminho).toMatch(/^\/assinar\/.{40,}/)
    await expect(page.getByTestId('ficha-link-whatsapp')).toHaveAttribute('href', /^https:\/\/wa\.me\/55\d+\?text=/)
    await expect(page.getByTestId('ficha-status')).toHaveText('esperando assinatura')

    // o cliente abre o link
    await irPara(page, caminho)
    await expect(page.getByTestId('assinar-texto')).toContainText('ANEXO II - MINUTA DE CONTRATO')
    await expect(page.getByTestId('assinar-texto')).toContainText('Rua Érico Veríssimo'.toUpperCase())
    // o CPF não aparece na página pública (é o que ele digita para provar quem é)
    await expect(page.getByTestId('assinar-texto')).not.toContainText('529.982.247-25')
    await expect(page.getByTestId('assinar-texto')).toContainText('***.***.***-25')
    await expect(page.getByTestId('assinar-enviar')).toBeDisabled()

    // CPF errado: avisa e continua na tela
    await page.getByTestId('assinar-cpf').fill('11144477735')
    await assinarComODedo(page)
    await page.getByTestId('assinar-aceito').check()
    await page.getByTestId('assinar-enviar').click()
    await expect(page.getByTestId('assinar-erro')).toContainText('CPF não confere')

    // CPF certo: assina
    await page.getByTestId('assinar-cpf').fill('52998224725')
    await page.getByTestId('assinar-enviar').click()
    await expect(page.getByTestId('assinar-feito')).toContainText('Contrato assinado')

    // o mesmo link não abre mais (sai da página e volta, como quem clica de novo)
    await irPara(page, '/contratos')
    await irPara(page, caminho)
    await expect(page.getByTestId('assinar-bloqueio')).toBeVisible()

    // a loja vê o contrato assinado, com a assinatura e a prova
    await irPara(page, '/contratos')
    await page.getByRole('button', { name: 'Assinados' }).click()
    await page.locator('[data-contrato]').first().click()
    await expect(page.getByTestId('ficha-status')).toHaveText('assinado')
    await expect(page.getByTestId('ficha-assinatura')).toContainText('***.***.***-25')
    await expect(page.getByTestId('ficha-assinatura').locator('img')).toBeVisible()
  })

  test('link inventado mostra o aviso e nada do contrato', async ({ page }) => {
    await entrar(page, 'admin')
    await irPara(page, `/assinar/${'x'.repeat(43)}`)
    await expect(page.getByTestId('assinar-bloqueio')).toContainText('Link inválido')
    await expect(page.getByTestId('assinar-texto')).toHaveCount(0)
  })

  test('limpar a assinatura desliga o botão de assinar', async ({ page }) => {
    const { caminho } = await vendaComLink(page)
    await irPara(page, caminho)
    await page.getByTestId('assinar-cpf').fill('52998224725')
    await page.getByTestId('assinar-aceito').check()
    await assinarComODedo(page)
    await expect(page.getByTestId('assinar-enviar')).toBeEnabled()
    await page.getByTestId('assinatura-limpar').click()
    await expect(page.getByTestId('assinar-enviar')).toBeDisabled()
  })

  test('vendedor não completa o aparelho (só o administrador) e o aviso diz isso', async ({ page }) => {
    await entrar(page, 'vendedor')
    await page.goto('/vender')
    await page.locator('[data-aparelho]').first().click()
    await page.locator('[data-cliente]').first().click()
    await expect(page.getByTestId('completar-aparelho')).toHaveCount(0)
  })

  test('ZapSign: envia o contrato, mostra o link do ZapSign com a marca de teste e fecha o caminho do link próprio', async ({ page }) => {
    await vendaPeloZapsign(page)
    await expect(page.getByTestId('ficha-enviar-zapsign')).toBeVisible()
    await page.getByTestId('ficha-enviar-zapsign').click()
    await expect(page.getByTestId('ficha-zapsign')).toBeVisible()
    await expect(page.getByTestId('ficha-zapsign-teste')).toContainText('TESTE')
    await expect(page.getByTestId('ficha-zapsign-status')).toContainText('esperando assinatura no ZapSign')
    await expect(page.getByTestId('ficha-zapsign-url')).toContainText('zapsign')
    await expect(page.getByTestId('ficha-zapsign-whatsapp')).toHaveAttribute('href', /^https:\/\/wa\.me\/55\d+\?text=.*zapsign/)
    await expect(page.getByTestId('ficha-status')).toHaveText('esperando assinatura')
    await expect(page.getByTestId('ficha-gerar-link')).toBeDisabled() // um caminho de cada vez
    await page.getByTestId('ficha-zapsign-atualizar').click()
    await expect(page.getByTestId('ficha-zapsign-status')).toContainText('esperando')
  })
})
