import { expect, test, type Page } from '@playwright/test'
import { entrar, navegar, verComo } from './helpers'

const CPF = '52998224725'

/** Indicador: cadastra um cliente novo e manda a proposta de venda dele. Devolve o nome. */
async function indicarVenda(page: Page, nome = 'Maria da Silva', interesse = 'iPhone 14 128 GB preto', parcelas = '10') {
  await navegar(page, '/indicar')
  await page.getByTestId('nova-proposta').click()
  await page.getByTestId('cadastrar-novo').click()
  await page.fill('#cNome', nome); await page.fill('#cFone', '11988124410'); await page.fill('#cCpf', CPF)
  await page.getByRole('button', { name: 'Cadastrar cliente' }).click()
  await page.fill('#pInteresse', interesse); await page.fill('#pParcelas', parcelas)
  await page.getByRole('button', { name: 'Mandar proposta' }).click()
  // o cadastro é padronizado em maiúsculas
  const padronizado = nome.toLocaleUpperCase('pt-BR')
  await expect(page.getByTestId('minhas-propostas')).toContainText(padronizado)
  return padronizado
}
const cardProposta = (page: Page, nome: string) => page.getByTestId('proposta').filter({ hasText: nome })

test.describe('indicador: cadastra o cliente e manda a proposta', () => {
  test.beforeEach(async ({ page }) => { await entrar(page, 'indicador') })

  test('o cadastro exige CPF (o indicador entrega a ficha completa) e valida os dados', async ({ page }) => {
    await navegar(page, '/indicar')
    await page.getByTestId('nova-proposta').click()
    await page.getByTestId('cadastrar-novo').click()
    await page.fill('#cNome', 'Maria da Silva'); await page.fill('#cFone', '11988124410')
    await page.getByRole('button', { name: 'Cadastrar cliente' }).click()
    await expect(page.getByText('Informe o CPF do cliente')).toBeVisible()
    await page.fill('#cCpf', '11111111111')
    await page.getByRole('button', { name: 'Cadastrar cliente' }).click()
    await expect(page.getByText('CPF inválido')).toBeVisible()
    await page.fill('#cCpf', CPF)
    await page.getByRole('button', { name: 'Cadastrar cliente' }).click()
    await expect(page.getByRole('heading', { name: 'Mandar proposta' })).toBeVisible()
  })

  test('cadastrar o cliente leva direto à proposta; a lista mostra "esperando a loja" e dá para cancelar', async ({ page }) => {
    const nome = await indicarVenda(page)
    const linha = page.locator('[data-proposta]').filter({ hasText: nome })
    await expect(linha).toContainText('Venda · iPhone 14 128 GB preto · 10x')
    await expect(linha.locator('[data-status]')).toHaveText('esperando a loja')
    await linha.locator('[data-cancelar]').click()
    await expect(linha.locator('[data-status]')).toHaveText('cancelada')
    await expect(linha.locator('[data-cancelar]')).toHaveCount(0)
  })

  test('a proposta de venda pede o aparelho; a de empréstimo pede o valor; parcelas só de 1 a 120', async ({ page }) => {
    await navegar(page, '/indicar')
    await page.getByTestId('nova-proposta').click()
    await page.getByTestId('escolher-cliente').locator('[data-cliente]').first().click()
    const enviar = page.getByRole('button', { name: 'Mandar proposta' })
    await expect(enviar).toBeDisabled()
    await expect(page.getByText('Diga qual aparelho o cliente quer')).toBeVisible()
    await page.fill('#pInteresse', 'iPhone 13')
    await expect(enviar).toBeEnabled()
    await page.fill('#pParcelas', '121')
    await expect(page.getByText('Parcelas: um número de 1 a 120')).toBeVisible()
    await expect(enviar).toBeDisabled()
    await page.fill('#pParcelas', '12')
    await page.getByRole('button', { name: 'Empréstimo', exact: true }).click()
    await expect(page.getByText('Diga quanto o cliente quer pegar')).toBeVisible()
    await page.fill('#pValor', '300000') // R$ 3.000,00
    await expect(enviar).toBeEnabled()
  })

  test('escolher um aparelho do estoque preenche o texto', async ({ page }) => {
    await navegar(page, '/indicar')
    await page.getByTestId('nova-proposta').click()
    await page.getByTestId('escolher-cliente').locator('[data-cliente]').first().click()
    await page.locator('#pAparelho').selectOption({ index: 1 })
    await expect(page.locator('#pInteresse')).toHaveValue(/GB/)
    await expect(page.getByRole('button', { name: 'Mandar proposta' })).toBeEnabled()
  })

  test('o indicador só escolhe entre os clientes dele (busca)', async ({ page }) => {
    await navegar(page, '/indicar')
    await page.getByTestId('nova-proposta').click()
    const lista = page.getByTestId('escolher-cliente')
    await expect(lista.locator('[data-cliente]').first()).toBeVisible()
    await page.getByLabel('Buscar cliente').fill('zzzzzz')
    await expect(page.getByText('Nenhum cliente seu com esse nome.')).toBeVisible()
  })
})

test.describe('a loja responde', () => {
  test('recusar com motivo: some da Equipe e o indicador vê o motivo', async ({ page }) => {
    await entrar(page, 'indicador')
    const nome = await indicarVenda(page)
    await verComo(page, 'Admin')
    await navegar(page, '/equipe')
    const card = cardProposta(page, nome)
    await expect(card).toContainText('Roberto Indicações')
    await expect(card).toContainText('iPhone 14 128 GB preto')
    await card.locator('[data-recusar-proposta]').click()
    await page.fill('#mRecusaProposta', 'Sem renda comprovada')
    await page.getByRole('button', { name: 'Recusar proposta' }).click()
    await expect(card).toHaveCount(0)
    await verComo(page, 'Indicador')
    await navegar(page, '/indicar')
    const linha = page.locator('[data-proposta]').filter({ hasText: nome })
    await expect(linha.locator('[data-status]')).toHaveText('recusada')
    await expect(linha).toContainText('Sem renda comprovada')
    await expect(linha.locator('[data-cancelar]')).toHaveCount(0)
  })

  test('"Só aceitar" marca como aceita sem lançar nada', async ({ page }) => {
    await entrar(page, 'indicador')
    const nome = await indicarVenda(page)
    await verComo(page, 'Admin')
    await navegar(page, '/equipe')
    await cardProposta(page, nome).locator('[data-so-aceitar]').click()
    await expect(cardProposta(page, nome)).toHaveCount(0)
    await verComo(page, 'Indicador')
    await navegar(page, '/indicar')
    await expect(page.locator('[data-proposta]').filter({ hasText: nome }).locator('[data-status]')).toHaveText('aceita')
  })

  test('aceitar e lançar a venda: abre Vender com cliente e indicador, e a proposta fica ligada à venda', async ({ page }) => {
    await entrar(page, 'indicador')
    const nome = await indicarVenda(page)
    await verComo(page, 'Admin')
    await navegar(page, '/equipe')
    await cardProposta(page, nome).locator('[data-lancar]').click()
    await expect(page).toHaveURL(/\/vender\?.*proposta=/)
    await page.locator('[data-aparelho]').first().click()
    // passo 3: o cliente já vem escolhido e o indicador preenchido
    await expect(page.locator('#vInd')).toHaveValue('1')
    await expect(page.getByText(nome).first()).toBeVisible()
    await page.getByRole('button', { name: /Confirmar venda|Fazer a venda/ }).click()
    await expect(page.getByText('Proposta aceita e ligada a esta venda.')).toBeVisible()
    await navegar(page, '/equipe')
    await expect(cardProposta(page, nome)).toHaveCount(0)
    await verComo(page, 'Indicador')
    await navegar(page, '/indicar')
    const linha = page.locator('[data-proposta]').filter({ hasText: nome })
    await expect(linha.locator('[data-status]')).toHaveText('aceita')
    await expect(linha).toContainText('venda cadastrada pela loja')
  })

  test('aceitar e lançar o empréstimo: abre o formulário com cliente, valor e parcelas, e liga a proposta', async ({ page }) => {
    await entrar(page, 'indicador')
    await navegar(page, '/indicar')
    await page.getByTestId('nova-proposta').click()
    await page.getByTestId('escolher-cliente').locator('[data-cliente]').first().click()
    await page.getByRole('button', { name: 'Empréstimo', exact: true }).click()
    await page.fill('#pValor', '300000'); await page.fill('#pParcelas', '6')
    await page.getByRole('button', { name: 'Mandar proposta' }).click()
    await expect(page.locator('[data-proposta]').first()).toContainText('Empréstimo')
    await verComo(page, 'Admin')
    await navegar(page, '/equipe')
    await page.locator('[data-proposta]').filter({ hasText: 'quer um empréstimo' }).locator('[data-lancar]').click()
    await expect(page.getByRole('heading', { name: 'Novo empréstimo' })).toBeVisible()
    await expect(page.locator('#eCapital')).toHaveValue('3.000,00')
    await page.getByRole('button', { name: 'Continuar' }).click()
    await expect(page.locator('#eParcelas')).toHaveValue('6')
    await page.getByRole('button', { name: 'Continuar' }).click()
    await page.getByRole('button', { name: 'Fazer empréstimo' }).click()
    await expect(page.getByText('Proposta aceita e ligada a este empréstimo.')).toBeVisible()
    await navegar(page, '/equipe')
    await expect(page.locator('[data-proposta]').filter({ hasText: 'quer um empréstimo' })).toHaveCount(0)
  })

  test('o número da Equipe conta as propostas esperando', async ({ page }) => {
    test.skip(test.info().project.name !== 'computador', 'só no computador')
    await entrar(page)
    const antes = Number((await page.locator('aside.side [data-menu="equipe"] .cnt').innerText()).trim())
    await verComo(page, 'Indicador')
    await indicarVenda(page)
    await verComo(page, 'Admin')
    await expect(page.locator('aside.side [data-menu="equipe"] .cnt')).toHaveText(String(antes + 1))
  })
})

test.describe('quem não é indicador', () => {
  for (const perfil of ['Admin', 'Cobrador', 'Vendedor'] as const) {
    test(`${perfil} não tem a tela de propostas do indicador`, async ({ page }) => {
      await entrar(page)
      await verComo(page, perfil)
      await navegar(page, '/indicar')
      await expect(page.getByTestId('nova-proposta')).toHaveCount(0)
    })
  }
})
