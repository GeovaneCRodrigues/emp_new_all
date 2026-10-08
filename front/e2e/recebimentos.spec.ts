import { expect, test, type Page } from '@playwright/test'
import { entrar } from './helpers'

const linha = (page: Page, nome: string, parcela: string) => page.locator('.cob', { hasText: nome }).filter({ hasText: parcela }).first()
const recebi = (page: Page, nome: string, parcela: string) => linha(page, nome, parcela).getByRole('button', { name: 'Recebi' })
const confirmar = (page: Page) => page.getByRole('button', { name: 'Confirmar recebimento' })
const aba = (page: Page, nome: RegExp) => page.locator('.seg').getByRole('button', { name: nome })
const badge = (page: Page) => page.locator('.badge-dot, .side .cnt').first()

test.describe('cobranças', () => {
  test('mostra as atrasadas com total, WhatsApp e Recebi; as outras abas também', async ({ page }) => {
    await entrar(page)
    await page.goto('/cobrancas')
    await expect(page.locator('.cob').first()).toBeVisible()
    await expect(page.getByTestId('cobrancas-total')).toContainText('R$')
    await expect(page.locator('.cob').first().getByRole('link', { name: 'Cobrar no WhatsApp' })).toBeVisible()
    await expect(linha(page, 'Carlos Henrique', 'parcela 2/12')).toContainText('33 dias')
    await aba(page, /Esta semana/).click()
    await expect(page.locator('.cob').first()).toBeVisible()
    await aba(page, /Recebidas/).click()
    await expect(page.locator('.cob').first().getByRole('button', { name: 'Recibo' })).toBeVisible()
  })

  test('o número vermelho do menu é o de parcelas atrasadas e cai quando uma é recebida', async ({ page }) => {
    await entrar(page)
    await page.goto('/cobrancas')
    const antes = Number(await badge(page).innerText())
    expect(antes).toBeGreaterThan(0)
    await recebi(page, 'Carlos Henrique', 'parcela 2/12').click()
    await confirmar(page).click()
    await page.getByTestId('recibo').waitFor()
    await expect(badge(page)).toHaveText(String(antes - 1))
  })
})

test.describe('recebimento', () => {
  test('valor cheio: quita a parcela, abre o recibo com o texto do WhatsApp e tira da lista de atrasadas', async ({ page }) => {
    await entrar(page)
    await page.goto('/cobrancas')
    await recebi(page, 'Carlos Henrique', 'parcela 2/12').click()
    await expect(page.getByTestId('previa')).toHaveText('Quita a 2ª')
    await confirmar(page).click()
    const recibo = page.getByTestId('recibo')
    await expect(recibo).toContainText('R$ 500,00')
    await expect(recibo).toContainText('parcela 2/12')
    await expect(page.getByTestId('recibo-numero')).toHaveText(/^\d{6}$/)
    await expect(page.getByTestId('recibo-mensagem')).toContainText('Recebemos R$ 500,00 em 08/10/2026 (Pix), referente à parcela 2/12 do seu iPhone 15 Pro.')
    await expect(page.getByTestId('toast')).toContainText('recebidos de Carlos')
    await page.keyboard.press('Escape')
    await expect(linha(page, 'Carlos Henrique', 'parcela 2/12')).toHaveCount(0)
  })

  test('pagou menos, fica devendo: o restante ganha data nova, aparece como remarcada e sai dos atrasados', async ({ page }) => {
    await entrar(page)
    await page.goto('/cobrancas')
    await recebi(page, 'Fernanda Almeida', 'parcela 2/10').click()
    await page.fill('#rValor', '10000') // R$ 100 de R$ 350
    await expect(page.getByTestId('resto')).toContainText('Faltaram R$ 250,00')
    await page.getByRole('button', { name: '+7 dias' }).click()
    await expect(page.getByTestId('previa')).toHaveText('A 2ª fica com R$ 250,00, para 15/10')
    await confirmar(page).click()
    await expect(page.getByTestId('recibo-mensagem')).toContainText('Na 2ª ainda ficam R$ 250,00, para 15/10.')
    await page.keyboard.press('Escape')
    await expect(linha(page, 'Fernanda Almeida', 'parcela 2/10')).toHaveCount(0)
    await aba(page, /Esta semana/).click()
    await expect(linha(page, 'Fernanda Almeida', 'parcela 2/10')).toContainText('remarcada (era 05/10)')
    await expect(linha(page, 'Fernanda Almeida', 'parcela 2/10')).toContainText('já pagou R$ 100')
  })

  test('pagou menos, desconto: quita a parcela e o desconto vira o efeito da prévia', async ({ page }) => {
    await entrar(page)
    await page.goto('/cobrancas')
    await recebi(page, 'Fernanda Almeida', 'parcela 2/10').click()
    await page.fill('#rValor', '10000')
    await page.locator('[data-resto="DESCONTO"]').click()
    await expect(page.getByTestId('previa')).toHaveText('Dá R$ 250,00 de desconto na 2ª')
    await confirmar(page).click()
    await expect(page.getByTestId('recibo')).toContainText('R$ 100,00')
    await page.keyboard.press('Escape')
    await expect(linha(page, 'Fernanda Almeida', 'parcela 2/10')).toHaveCount(0)
  })

  test('pagou a mais: a prévia diz o que quita e o que abate; acima da dívida é recusado na hora', async ({ page }) => {
    await entrar(page)
    await page.goto('/cobrancas')
    await recebi(page, 'Carlos Henrique', 'parcela 2/12').click()
    await page.fill('#rValor', '125000') // R$ 1.250 em parcelas de 500: quita a 2ª e a 3ª e abate 250 da 4ª
    await expect(page.getByTestId('previa')).toHaveText('Quita a 2ª, quita a 3ª, abate R$ 250,00 da 4ª')
    await page.fill('#rValor', '999999999')
    await expect(page.getByRole('alert').first()).toContainText('passa do que falta pagar')
    await expect(confirmar(page)).toBeDisabled()
  })

  test('desfazer pelo aviso: a parcela volta para as atrasadas', async ({ page }) => {
    await entrar(page)
    await page.goto('/cobrancas')
    await recebi(page, 'Carlos Henrique', 'parcela 2/12').click()
    await confirmar(page).click()
    await page.getByTestId('recibo').waitFor()
    await page.keyboard.press('Escape')
    await expect(linha(page, 'Carlos Henrique', 'parcela 2/12')).toHaveCount(0)
    await page.getByTestId('toast').getByRole('button', { name: 'Desfazer' }).click()
    await expect(page.getByTestId('toast')).toContainText('Recebimento desfeito')
    await expect(linha(page, 'Carlos Henrique', 'parcela 2/12')).toBeVisible()
  })

  test('o vendedor não tem acesso às cobranças', async ({ page }) => {
    await entrar(page, 'vendedor')
    await page.goto('/cobrancas')
    await expect(page.getByText('Esta tela entra nas próximas etapas.')).toBeVisible()
  })
})

test.describe('ficha da venda', () => {
  test('lista os pagamentos com recibo, recebe pela ficha e só o último tem "Desfazer"', async ({ page }) => {
    await entrar(page)
    await page.goto('/operacoes')
    await page.locator('.fones .card', { hasText: 'Carlos Henrique' }).first().click()
    const ficha = page.getByRole('dialog')
    await expect(ficha.getByTestId('pagamentos')).toContainText('entrada')
    await expect(ficha.getByTestId('pagamentos')).toContainText('parcela 1/12')

    await ficha.locator('[data-receber="2"]').click()
    await page.getByRole('button', { name: 'Confirmar recebimento' }).click()
    await expect(page.getByTestId('recibo')).toContainText('parcela 2/12')
    await page.keyboard.press('Escape') // fecha só o recibo: a ficha continua aberta
    await expect(page.getByRole('dialog').first()).toContainText('Carlos Henrique')
    const pagamentos = page.getByTestId('pagamentos')
    await expect(pagamentos).toContainText('parcela 2/12')
    await expect(pagamentos.getByRole('button', { name: 'Desfazer' })).toHaveCount(1)
    await expect(pagamentos.locator('[data-pagamento]').first().getByRole('button', { name: 'Desfazer' })).toBeVisible()
  })

  test('o Esc fecha só a folha de cima: o recebimento fecha e a ficha fica', async ({ page }) => {
    await entrar(page)
    await page.goto('/operacoes')
    await page.locator('.fones .card', { hasText: 'Carlos Henrique' }).first().click()
    await page.getByRole('dialog').locator('[data-receber="2"]').click()
    await expect(page.getByRole('dialog')).toHaveCount(2)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(1)
    await expect(page.getByRole('dialog')).toContainText('Carlos Henrique')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('quitar tudo fecha a venda: sai de "em andamento" e vai para "quitadas"', async ({ page }) => {
    await entrar(page)
    await page.goto('/operacoes')
    await page.locator('.fones .card', { hasText: 'Patrícia Gomes' }).first().click()
    await page.getByRole('dialog').locator('[data-receber]').first().click()
    await page.fill('#rValor', '300000') // 10 × 300 = 3.000: quita tudo
    await expect(page.getByTestId('previa')).toContainText('Quita a 1ª')
    await page.getByRole('button', { name: 'Confirmar recebimento' }).click()
    await expect(page.getByTestId('recibo-mensagem')).toContainText('Tudo quitado!')
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Quitadas' }).click()
    await expect(page.locator('.fones .card', { hasText: 'Patrícia Gomes' })).toBeVisible()
  })
})
