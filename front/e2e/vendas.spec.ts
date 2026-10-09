import { expect, test, type Page } from '@playwright/test'
import { entrar } from './helpers'

const aparelho = (page: Page, id: number) => page.locator(`[data-aparelho="${id}"]`)
const cliente = (page: Page, id: number) => page.locator(`[data-cliente="${id}"]`)
const confirmar = (page: Page) => page.getByRole('button', { name: 'Confirmar venda' })

/** Abre a venda do iPhone 16 (id 6, preço de tabela 7.600) para a Juliana (id 1) e chega no passo do pagamento. */
async function ate_pagamento(page: Page) {
  await page.goto('/vender')
  await aparelho(page, 6).click()
  await cliente(page, 1).click()
  await expect(page.locator('#vPreco')).toBeVisible()
}
/** Preço 7.500 e entrada 1.500 (o exemplo do plano). */
async function exemploDoPlano(page: Page) {
  await page.fill('#vPreco', '750000')
  await page.fill('#vEntrada', '150000')
}

test.describe('nova venda', () => {
  test('o exemplo do plano: 7.500 com 1.500 de entrada = 10x de 1.200; 6x de 1.600; 5x de 1.800', async ({ page }) => {
    await entrar(page)
    await ate_pagamento(page)
    await exemploDoPlano(page)
    await expect(page.getByTestId('resumo-parcelado')).toHaveText('R$ 6.000,00')
    await expect(page.getByTestId('resumo-parcela')).toHaveText('10x R$ 1.200,00')
    await expect(page.getByTestId('resumo-total')).toHaveText('R$ 13.500,00')
    await page.getByRole('button', { name: '6x', exact: true }).click()
    await expect(page.getByTestId('resumo-parcela')).toHaveText('6x R$ 1.600,00')
    await page.getByRole('button', { name: '5x', exact: true }).click()
    await expect(page.getByTestId('resumo-parcela')).toHaveText('5x R$ 1.800,00')
  })

  test('o admin vê custo, parte do indicador e lucro; o capital volta na parcela certa', async ({ page }) => {
    await entrar(page)
    await ate_pagamento(page)
    await exemploDoPlano(page)
    await page.selectOption('#vInd', { label: 'Roberto Indicações' }) // 50%
    await expect(page.getByText('Custo do aparelho')).toBeVisible()
    await expect(page.getByText('Parte do indicador (50%)')).toBeVisible()
    // total 13.500 − custo 5.100 = lucro 8.400; metade é do indicador
    await expect(page.getByTestId('resumo-lucro')).toHaveText('R$ 4.200,00')
    await expect(page.getByText('Seu capital volta na parcela 3.')).toBeVisible() // 1.500 + 3 × 1.200 ≥ 5.100
  })

  test('registra a venda, o aparelho sai do estoque e a venda aparece nas operações', async ({ page }) => {
    await entrar(page)
    await ate_pagamento(page)
    await exemploDoPlano(page)
    await confirmar(page).click()
    await expect(page.getByTestId('venda-feita')).toContainText('Venda feita!')
    await expect(page.getByTestId('venda-feita')).toContainText('10x de R$ 1.200,00')
    await expect(page.getByTestId('venda-feita')).toContainText('A primeira vence em 10/11')

    await page.getByRole('button', { name: 'Ver a operação' }).click()
    await expect(page.getByRole('dialog')).toContainText('Juliana Prado')
    await expect(page.getByRole('dialog')).toContainText('Lucro total')
    await expect(page.locator('[data-parcela]')).toHaveCount(10)
    await page.keyboard.press('Escape')
    await expect(page.locator('.fones').getByText('Juliana Prado').first()).toBeVisible()

    // pelo menu (um page.goto recarregaria a página e a demonstração esqueceria a venda)
    await page.getByRole('button', { name: 'Estoque', exact: true }).click()
    await expect(page.getByRole('button', { name: /Disponível · 5/ })).toBeVisible()
  })

  test('aparelho vendido some da escolha de aparelhos', async ({ page }) => {
    await entrar(page)
    await ate_pagamento(page)
    await confirmar(page).click()
    await expect(page.getByTestId('venda-feita')).toBeVisible()
    await page.getByTestId('venda-feita').getByRole('button', { name: 'Nova venda' }).click()
    await expect(page.locator('[data-aparelho]').first()).toBeVisible()
    await expect(aparelho(page, 6)).toHaveCount(0)
  })

  test('troca abate o parcelado e a entrada acima do preço trava a confirmação', async ({ page }) => {
    await entrar(page)
    await ate_pagamento(page)
    await exemploDoPlano(page)
    await page.getByRole('switch', { name: /deu um aparelho na troca/ }).click()
    await page.fill('#tModelo', 'iPhone 11')
    await page.fill('#tCor', 'Preto')
    await page.fill('#tValor', '90000')
    await expect(page.getByTestId('resumo-parcelado')).toHaveText('R$ 5.100,00')
    await expect(page.getByText('− Troca')).toBeVisible()
    await page.fill('#vEntrada', '800000')
    await expect(page.getByRole('alert').first()).toContainText('passam do preço')
    await expect(confirmar(page)).toBeDisabled()
  })

  test('sem nada para parcelar, a venda fecha quitada (à vista)', async ({ page }) => {
    await entrar(page)
    await ate_pagamento(page)
    await page.fill('#vPreco', '750000')
    await page.fill('#vEntrada', '750000')
    await expect(page.getByText('a venda fecha quitada')).toBeVisible()
    await expect(page.getByTestId('resumo-parcela')).toHaveText('À vista')
    await confirmar(page).click()
    await expect(page.getByTestId('venda-feita')).toContainText('Pago à vista')
  })

  test('cadastra o cliente na hora, sem sair da venda', async ({ page }) => {
    await entrar(page)
    await page.goto('/vender')
    await aparelho(page, 6).click()
    await page.getByRole('button', { name: 'Novo', exact: true }).click()
    await page.fill('#cNome', 'Cliente Novo da Venda')
    await page.fill('#cFone', '11966667777')
    await page.getByRole('button', { name: 'Cadastrar cliente' }).click()
    await expect(page.locator('#vPreco')).toBeVisible()
    await expect(page.getByText('para Cliente Novo da Venda')).toBeVisible()
  })

  test('o Simulador manda preço, entrada e parcelas para a venda', async ({ page }) => {
    await entrar(page)
    await page.goto('/simulador')
    await page.selectOption('#simBem', '6')
    await page.fill('#simPreco', '750000')
    await page.fill('#simEntrada', '150000')
    await page.getByRole('button', { name: /6x R\$ 1\.600/ }).click()
    await page.getByRole('button', { name: 'Vender assim' }).click()
    await expect(page).toHaveURL(/\/vender\?/)
    await cliente(page, 2).click()
    await expect(page.locator('#vPreco')).toHaveValue('7.500,00')
    await expect(page.locator('#vEntrada')).toHaveValue('1.500,00')
    await expect(page.getByTestId('resumo-parcela')).toHaveText('6x R$ 1.600,00')
  })

  test('a ficha do estoque leva o aparelho para a venda', async ({ page }) => {
    await entrar(page)
    await page.goto('/estoque')
    await page.locator('.fone', { hasText: 'iPhone 14 · 128 GB' }).first().click()
    await page.getByRole('dialog').getByRole('button', { name: 'Vender', exact: true }).click()
    await expect(page).toHaveURL(/\/vender\?bem=2/)
    await expect(page.getByRole('tab', { name: /2\. Cliente/ })).toHaveAttribute('aria-selected', 'true')
  })

  test('aparelho encomendado já vem com o cliente que encomendou', async ({ page }) => {
    await entrar(page)
    await page.goto('/vender')
    await aparelho(page, 7).click() // iPhone 16 Pro, encomendado para a Patrícia
    await expect(page.locator('#vPreco')).toBeVisible()
    await expect(page.getByText('para Patrícia Gomes')).toBeVisible()
  })
})

test.describe('vendedor vendendo', () => {
  test('não vê custo, lucro nem a parte do indicador, e só escolhe indicador pelo nome', async ({ page }) => {
    await entrar(page, 'vendedor')
    await page.goto('/vender')
    await aparelho(page, 6).click()
    await cliente(page, 1).click()
    await exemploDoPlano(page)
    await expect(page.getByTestId('resumo-parcela')).toHaveText('10x R$ 1.200,00')
    await expect(page.getByText(/custo|lucro|parte do indicador/i)).toHaveCount(0)
    await expect(page.locator('#vInd option')).toContainText(['Sem indicador', 'Roberto Indicações'])
    await expect(page.locator('#vInd')).not.toContainText('%')
  })

  test('só vê os clientes da carteira dele', async ({ page }) => {
    await entrar(page, 'vendedor')
    await page.goto('/vender')
    await aparelho(page, 6).click()
    await expect(page.locator('[data-cliente]')).toHaveCount(4)
    await expect(cliente(page, 3)).toHaveCount(0) // a Fernanda é do cobrador
  })

  test('preço abaixo da tabela trava a venda; acima da tabela passa', async ({ page }) => {
    await entrar(page, 'vendedor')
    await page.goto('/vender')
    await aparelho(page, 6).click()
    await cliente(page, 1).click()
    await page.fill('#vPreco', '700000')
    await expect(page.locator('.erro-campo')).toHaveText('Abaixo da tabela (R$ 7.600)')
    await expect(page.getByRole('alert').first()).toContainText('Só o administrador vende abaixo da tabela')
    await expect(confirmar(page)).toBeDisabled()
    await page.fill('#vPreco', '800000')
    await expect(confirmar(page)).toBeEnabled()
    await confirmar(page).click()
    await expect(page.getByTestId('venda-feita')).toBeVisible()
    await expect(page.getByTestId('venda-feita')).not.toContainText(/lucro/i)
  })
})

test.describe('operações', () => {
  test('o admin vê os 3 números e as vendas; abre a ficha com parcelas, custo e lucro', async ({ page }) => {
    await entrar(page)
    await page.goto('/operacoes')
    await expect(page.locator('.resumo3')).toContainText('A receber')
    await expect(page.locator('.resumo3')).toContainText('Capital na rua')
    await expect(page.locator('.resumo3')).toContainText('Lucro por vir')
    await page.locator('.fones .card', { hasText: 'Juliana Prado' }).first().click()
    await expect(page.getByRole('dialog')).toContainText('Custo do aparelho')
    await expect(page.getByRole('dialog')).toContainText('Parcelas')
    await expect(page.locator('[data-parcela]').first()).toBeVisible()
  })

  test('filtra por atraso e quitadas', async ({ page }) => {
    await entrar(page)
    await page.goto('/operacoes')
    await page.getByRole('button', { name: 'Com atraso' }).click()
    await expect(page.locator('.fones .card').first()).toContainText('atrasada')
    await page.getByRole('button', { name: 'Quitadas' }).click()
    await expect(page.locator('.fones .card').first()).toContainText('quitada')
  })

  test('o vendedor vê só "A receber", sem abas de empréstimo, sem custo e lucro na ficha', async ({ page }) => {
    await entrar(page, 'vendedor')
    await page.goto('/vendas')
    await expect(page.locator('.resumo3')).toContainText('A receber')
    await expect(page.getByText(/capital na rua|lucro por vir/i)).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Empréstimos' })).toHaveCount(0)
    await page.locator('.fones .card').first().click()
    await expect(page.getByRole('dialog')).not.toContainText(/custo|lucro/i)
  })

  test('a aba de empréstimos do admin continua funcionando', async ({ page }) => {
    await entrar(page)
    await page.goto('/operacoes')
    await page.getByRole('button', { name: /Empréstimos/ }).click()
    await expect(page.locator('.fones .card').first()).toBeVisible()
  })
})

test.describe('empréstimos parcelados', () => {
  const abrirAba = async (page: import('@playwright/test').Page) => {
    await entrar(page)
    await page.goto('/operacoes')
    await page.getByRole('tab', { name: /Empréstimos/ }).or(page.getByRole('button', { name: /Empréstimos/ })).first().click()
  }

  test('lista os empréstimos com os 3 números e abre a ficha com capital e lucro (admin)', async ({ page }) => {
    await abrirAba(page)
    await expect(page.locator('[data-emprestimo]').first()).toBeVisible()
    await page.locator('[data-emprestimo]').first().click()
    await expect(page.getByTestId('dados-admin')).toContainText('Capital emprestado')
  })

  test('faz um empréstimo parcelado: a prévia bate com a conta e ele aparece na lista', async ({ page }) => {
    await abrirAba(page)
    await page.getByRole('button', { name: 'Empréstimo', exact: true }).click()
    await page.locator('[data-cliente]').first().click()
    await expect(page.locator('[data-mod="JUROS"]')).toBeDisabled()
    await page.locator('#eCapital').fill('500000')
    await page.fill('#eTaxa', '10')
    await page.fill('#eParcelas', '6')
    await expect(page.getByTestId('previa-parcela')).toContainText('1.333,34')
    await expect(page.getByTestId('previa-total')).toContainText('8.000,04')
    await page.getByRole('button', { name: 'Fazer empréstimo' }).click()
    await expect(page.getByTestId('dados-admin')).toContainText('5.000,00')
  })
})
