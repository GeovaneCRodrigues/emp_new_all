import { expect, test, type Page } from '@playwright/test'
import { entrar, navegar } from './helpers'

// Demonstração: 9 contratos (7 assinados e 2 esperando: Patrícia Gomes e Ana Paula Ribeiro, que ainda não têm CPF nem endereço).
const aba = (page: Page, nome: string | RegExp) => page.getByTestId('ct-abas').getByRole('button', { name: nome })
const item = (page: Page, nome: string) => page.getByTestId('ct-lista').locator('[data-contrato]', { hasText: nome })
const semRolagemLateral = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)

/** Completa o cadastro do cliente pela tela de clientes (a demonstração guarda a mudança). */
async function completarCliente(page: Page, nome: string) {
  await navegar(page, '/clientes')
  await page.getByLabel('Buscar cliente').fill(nome)
  await page.locator('.li', { hasText: nome }).first().click()
  await page.getByRole('button', { name: 'Editar' }).click()
  await page.fill('#cCpf', '52998224725')
  await page.fill('#cEnd', 'Rua das Flores, 120')
  await page.getByRole('button', { name: 'Salvar alterações' }).click()
  await expect(page.getByRole('heading', { name: 'Editar cliente' })).toHaveCount(0)
  await navegar(page, '/contratos')
}

test.describe('contratos (administrador)', () => {
  test.beforeEach(async ({ page }) => { await entrar(page, 'admin'); await navegar(page, '/contratos'); await expect(page.getByTestId('ct-abas')).toBeVisible() })

  test('lista com resumo, filtros e o status de cada contrato', async ({ page }) => {
    await expect(page.getByTestId('ct-assinados')).toHaveText('7'); await expect(page.getByTestId('ct-esperando')).toHaveText('2'); await expect(page.getByTestId('ct-seguro')).toHaveText('0')
    await expect(page.getByTestId('ct-lista').locator('[data-contrato]')).toHaveCount(9)
    await page.getByTestId('ct-filtro').getByRole('button', { name: /Esperando/ }).click()
    await expect(page.getByTestId('ct-lista').locator('[data-contrato]')).toHaveCount(2)
    await expect(item(page, 'Patrícia Gomes')).toContainText('esperando assinatura')
    await page.getByTestId('ct-filtro').getByRole('button', { name: 'Assinados' }).click()
    await expect(page.getByTestId('ct-lista').locator('[data-contrato]')).toHaveCount(7)
    await expect(page.getByTestId('ct-lista').locator('[data-status="AGUARDANDO"]')).toHaveCount(0)
    await expect(page.getByTestId('ct-lista').locator('[data-contrato]').first()).toContainText(/Nº 2026-\d{4}/)
  })

  test('contrato assinado: linha do tempo completa, texto fechado e janela de impressão com o texto', async ({ page }) => {
    await page.getByTestId('ct-filtro').getByRole('button', { name: 'Assinados' }).click()
    await page.getByTestId('ct-lista').locator('[data-contrato]').first().click()
    await expect(page.getByTestId('ficha-status')).toHaveText('assinado')
    await expect(page.getByTestId('ficha-passos').locator('.ok')).toHaveCount(3)
    await expect(page.getByTestId('ficha-congelado')).toBeVisible()
    await expect(page.getByTestId('ficha-texto')).toContainText('CONTRATO DE LOCAÇÃO DE APARELHO CELULAR')
    const [popup] = await Promise.all([page.waitForEvent('popup'), page.getByTestId('ficha-imprimir').click()])
    await expect(popup.getByTestId('contrato-impressao')).toContainText('CLÁUSULA PRIMEIRA')
    await popup.close()
  })

  test('contrato esperando sem CPF e endereço: avisa o que falta em laranja e não deixa marcar como enviado', async ({ page }) => {
    await item(page, 'Ana Paula Ribeiro').click()
    await expect(page.getByTestId('ficha-faltam')).toContainText('CPF'); await expect(page.getByTestId('ficha-faltam')).toContainText('Endereço')
    await expect(page.getByTestId('ficha-texto').locator('mark.f').first()).toBeVisible()
    await expect(page.getByTestId('ficha-enviado')).toBeDisabled()
    await expect(page.getByTestId('ficha-assinado')).toHaveCount(0)
  })

  test('fluxo completo: completa o cadastro, marca seguro, envia (o texto fecha) e depois marca assinado', async ({ page }) => {
    await completarCliente(page, 'Ana Paula Ribeiro')
    await item(page, 'Ana Paula Ribeiro').click()
    await expect(page.getByTestId('ficha-faltam')).toHaveCount(0)
    await expect(page.getByTestId('ficha-texto')).toContainText('529.982.247-25')
    await page.getByTestId('ficha-seguro').check()
    await expect(page.getByTestId('ficha-texto')).toContainText('contratado, R$ 39,90 por mês')
    await page.getByTestId('ficha-enviado').click()
    await expect(page.getByTestId('ficha-congelado')).toBeVisible()
    await expect(page.getByTestId('ficha-passos').locator('.ok')).toHaveCount(2)
    await expect(page.getByTestId('ficha-seguro')).toHaveCount(0) // depois de enviado o seguro não muda
    await page.getByTestId('ficha-assinado').click()
    await expect(page.getByTestId('ficha-status')).toHaveText('assinado')
    await expect(page.getByTestId('ficha-passos').locator('.ok')).toHaveCount(3)
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('ct-assinados')).toHaveText('8'); await expect(page.getByTestId('ct-esperando')).toHaveText('1'); await expect(page.getByTestId('ct-seguro')).toHaveText('1')
    await expect(item(page, 'Ana Paula Ribeiro')).toContainText('com seguro')
  })

  test('copiar o texto do contrato', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await item(page, 'Patrícia Gomes').click()
    await page.getByTestId('ficha-copiar').click()
    await expect(page.getByTestId('ficha-copiar')).toContainText('Copiado!')
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('CLÁUSULA PRIMEIRA')
  })

  test('modelo: edita, vê preenchido com uma venda de exemplo, salva a versão nova e volta ao padrão', async ({ page }) => {
    await aba(page, 'Modelo').click()
    await expect(page.getByTestId('ct-versao')).toContainText('padrão')
    await expect(page.getByTestId('ct-salvar-modelo')).toBeDisabled()
    const area = page.getByTestId('ct-texto')
    await expect(area).toHaveValue(/CONTRATO DE LOCAÇÃO/)
    // insere um campo automático onde está o cursor
    await area.evaluate((el: HTMLTextAreaElement) => { el.focus(); el.setSelectionRange(el.value.length, el.value.length) })
    await page.locator('[data-var="cliente_nome"]').click()
    await expect(area).toHaveValue(/\{\{cliente_nome\}\}$/)
    await page.getByTestId('ct-ver').click()
    await expect(page.getByTestId('ct-previa')).toContainText('CLÁUSULA TERCEIRA')
    await expect(page.getByTestId('ct-previa').locator('mark').first()).toBeVisible()
    await page.getByTestId('ct-editar').click()
    await page.getByTestId('ct-salvar-modelo').click()
    await expect(page.getByTestId('ct-modelo-msg')).toContainText('versão 1')
    await expect(page.getByTestId('ct-versao')).toContainText('Versão 1')
    await page.getByTestId('ct-padrao').click()
    await expect(page.getByTestId('ct-texto')).not.toHaveValue(/\{\{cliente_nome\}\}$/)
    await page.getByTestId('ct-salvar-modelo').click()
    await expect(page.getByTestId('ct-versao')).toContainText('Versão 2')
  })

  test('modelo com campo que não existe: recusa e mostra qual', async ({ page }) => {
    await aba(page, 'Modelo').click()
    await page.getByTestId('ct-texto').fill(`${'Texto do contrato. '.repeat(5)}{{campo_inventado}}`)
    await page.getByTestId('ct-salvar-modelo').click()
    await expect(page.getByTestId('ct-modelo-erro')).toContainText('{{campo_inventado}}')
  })

  test('empresa e taxas: carrega, valida o CNPJ, salva e lembra', async ({ page }) => {
    await aba(page, 'Empresa e taxas').click()
    await expect(page.locator('#eNome')).toHaveValue('Mundo dos iPhones LTDA')
    await expect(page.locator('#tAvaria')).toHaveValue('350,00')
    await page.fill('#eCnpj', '123')
    await page.getByTestId('ct-salvar-empresa').click()
    await expect(page.getByTestId('ct-empresa-erro')).toContainText('CNPJ')
    await page.fill('#eCnpj', '11.222.333/0001-81'); await page.fill('#tAvaria', '400,50'); await page.fill('#tCanc', '12,5')
    await page.getByTestId('ct-salvar-empresa').click()
    await expect(page.getByTestId('ct-empresa-msg')).toContainText('salvos')
    await expect(page.locator('#tAvaria')).toHaveValue('400,50'); await expect(page.locator('#tCanc')).toHaveValue('12,5')
    // as taxas novas saem no contrato que ainda não foi enviado
    await aba(page, 'Contratos').click()
    await item(page, 'Patrícia Gomes').click()
    await expect(page.getByTestId('ficha-texto')).toContainText('R$ 400,50'); await expect(page.getByTestId('ficha-texto')).toContainText('12,5%')
  })

  test('taxa em branco: o contrato passa a pedir o campo e não deixa enviar', async ({ page }) => {
    await completarCliente(page, 'Ana Paula Ribeiro')
    await aba(page, 'Empresa e taxas').click()
    await page.fill('#tRecup', '')
    await page.getByTestId('ct-salvar-empresa').click()
    await expect(page.getByTestId('ct-empresa-msg')).toBeVisible()
    await aba(page, 'Contratos').click()
    await item(page, 'Ana Paula Ribeiro').click()
    await expect(page.getByTestId('ficha-faltam')).toContainText('Taxa de recuperação')
    await expect(page.getByTestId('ficha-enviado')).toBeDisabled()
  })

  test('na ficha da venda, o contrato abre direto', async ({ page }) => {
    await navegar(page, '/operacoes')
    await page.locator('.fones .card', { hasText: 'Patrícia' }).first().click()
    await page.getByRole('dialog').getByTestId('venda-contrato').click()
    await expect(page.getByTestId('ficha-numero')).toContainText('Contrato 2026-')
    await expect(page.getByTestId('ficha-status')).toHaveText('esperando assinatura')
  })

  test('as três abas cabem na tela sem rolagem lateral na página', async ({ page }) => {
    for (const nome of ['Contratos', 'Modelo', 'Empresa e taxas']) { await aba(page, nome).click(); expect(await semRolagemLateral(page), nome).toBe(true) }
  })
})

test.describe('contratos: quem não é administrador', () => {
  for (const conta of ['cobrador', 'indicador'] as const) {
    test(`${conta} não vê a tela de contratos`, async ({ page }) => {
      await entrar(page, conta); await navegar(page, '/contratos')
      await expect(page.getByTestId('ct-abas')).toHaveCount(0)
      await expect(page.getByText('Esta tela entra nas próximas etapas.')).toBeVisible()
    })
  }
})
