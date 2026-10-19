import { expect, test, type Page } from '@playwright/test'
import { entrar, navegar, verComo } from './helpers'

const ehComputador = () => test.info().project.name === 'computador'
/** Vai a uma tela do indicador pelo menu (computador: lateral; celular: barra de baixo ou o "Mais" do Início). */
async function ir(page: Page, nome: string) {
  if (ehComputador()) { await page.locator('aside.side').getByRole('button', { name: new RegExp('^' + nome) }).click(); return }
  const aba = page.locator('nav.tabs').getByRole('button', { name: new RegExp('^' + nome) })
  if (await aba.count()) await aba.click()
  else { await page.locator('nav.tabs').getByRole('button', { name: /^Início/ }).click(); await page.locator(`[data-mais="${{ Cronograma: 'cronograma', Operações: 'vendas', Simulador: 'simulador', Níveis: 'niveis' }[nome]}"]`).click() }
}
const numero = (t: string) => Number(t.replace(/[^\d,]/g, '').replace(',', '.'))

test.describe('portal do indicador (demonstração)', () => {
  test.beforeEach(async ({ page }) => { await entrar(page, 'indicador') })

  test('menu do design: Início, Cobrança, Meus clientes e Repasse, e o grupo Mais no computador', async ({ page }) => {
    test.skip(!ehComputador(), 'só no computador')
    const lateral = page.locator('aside.side')
    for (const n of ['Início', 'Cobrança', 'Meus clientes', 'Repasse', 'Cronograma', 'Operações', 'Simulador', 'Níveis']) await expect(lateral.getByRole('button', { name: new RegExp('^' + n) })).toBeVisible()
    await expect(lateral.locator('.titulo')).toHaveText('Mais')
  })

  test('celular: barra Início, Cobrança, Novo, Clientes, Repasse; o resto fica no fim do Início', async ({ page }) => {
    test.skip(ehComputador(), 'só no celular')
    const barra = page.locator('nav.tabs')
    for (const n of ['Início', 'Cobrança', 'Novo', 'Clientes', 'Repasse']) await expect(barra.getByRole('button', { name: new RegExp('^' + n) }).first()).toBeVisible()
    await expect(page.locator('[data-mais]')).toHaveCount(4)
  })

  test('Início: pra cobrar hoje, quanto devem, já recebi, vai ganhar e o nível', async ({ page }) => {
    await expect(page.getByTestId('pra-cobrar-hoje')).toContainText('R$')
    await expect(page.getByTestId('devem')).toContainText('R$')
    await expect(page.getByTestId('ja-recebi')).toContainText('R$')
    await expect(page.getByTestId('vai-ganhar')).toContainText('R$')
    await expect(page.getByTestId('nivel')).toContainText('Nível')
    await expect(page.getByTestId('cobrar-hoje').locator('.cob').first().getByRole('link', { name: 'Cobrar no WhatsApp' })).toBeVisible()
    await expect(page.getByTestId('cobrar-hoje').getByRole('button', { name: 'Recebi' }).first()).toBeVisible() // avisa a loja (não dá a baixa)
  })

  test('Início: o atalho Indicar abre a escolha de cliente; o nível leva a Níveis', async ({ page }) => {
    await page.locator('[data-atalho="indicar"]').click()
    await expect(page.getByRole('heading', { name: 'Indicar para quem?' })).toBeVisible()
    await page.keyboard.press('Escape')
    await page.getByTestId('nivel').click()
    await expect(page.locator('h1')).toHaveText('Níveis')
  })

  test('Cobrança: só os clientes dele, com WhatsApp e o Recebi (que só avisa a loja); abas e filtro por tipo', async ({ page }) => {
    await ir(page, 'Cobrança')
    await expect(page.locator('h1')).toHaveText('Cobrança')
    const linha = page.locator('.cob').first()
    await expect(linha).toContainText('venceu')
    await expect(linha.getByRole('link', { name: 'Cobrar no WhatsApp' })).toBeVisible()
    await expect(linha.getByRole('button', { name: 'Recebi' })).toBeVisible()
    const total = numero(await page.getByTestId('cobrancas-total').innerText())
    expect(total).toBeGreaterThan(0)
    await page.getByTestId('filtro-tipo').getByRole('button', { name: 'iPhones' }).click()
    await expect.poll(async () => numero(await page.getByTestId('cobrancas-total').innerText())).toBeLessThanOrEqual(total)
    await page.getByRole('button', { name: /^Pagas/ }).click()
    await expect(page.getByTestId('cobrancas-total')).toBeVisible()
  })

  test('Meus clientes: lista com o que cada um deve e a sua parte; busca e filtros; ficha com Mandar proposta', async ({ page }) => {
    await ir(page, test.info().project.name === 'computador' ? 'Meus clientes' : 'Clientes')
    await expect(page.locator('h1')).toHaveText('Meus clientes')
    const lista = page.getByTestId('meus-clientes')
    await expect(lista.locator('[data-cliente]').first()).toBeVisible()
    await expect(lista).toContainText('sua parte')
    const todos = await lista.locator('[data-cliente]').count()
    await page.getByRole('button', { name: /^Atrasados/ }).click()
    const atrasados = await lista.locator('[data-cliente]').count()
    expect(atrasados).toBeLessThanOrEqual(todos)
    await expect(lista.locator('[data-status]').first()).toContainText('atrasada')
    await page.getByRole('button', { name: /^Todos/ }).click()
    await page.getByLabel('Buscar pelo nome').fill('patr') // sem acento e sem maiúscula
    await expect(lista.locator('[data-cliente]')).toHaveCount(1)
    await lista.locator('[data-cliente]').first().click()
    await expect(page.getByRole('link', { name: 'WhatsApp' })).toBeVisible()
    await page.locator('[data-propor]').click()
    await expect(page.getByRole('heading', { name: 'Mandar proposta' })).toBeVisible()
    await expect(page.getByRole('dialog').getByText('Patrícia Gomes')).toBeVisible()
  })

  test('Operações: iPhones e empréstimos, com a parte dele e sem custo nem lucro da loja', async ({ page }) => {
    await ir(page, 'Operações')
    await expect(page.locator('h1')).toHaveText('Operações')
    const cards = page.getByTestId('minhas-vendas')
    await expect(cards.locator('[data-venda]').first()).toBeVisible()
    await expect(cards.locator('[data-sua-parte]').first()).toContainText('sua parte R$')
    await expect(page.getByTestId('resumo-vendas')).toContainText('A receber')
    await page.getByRole('button', { name: /^Empréstimos/ }).click()
    await expect(cards.locator('[data-venda]').first()).toContainText('Empréstimo')
    const texto = (await page.locator('.content').innerText()).toLowerCase()
    for (const proibido of ['custo', 'lucro', 'capital', 'margem']) expect(texto, proibido).not.toContain(proibido)
  })

  for (const [aba, rotulo] of [['iPhones', 'iPhone'], ['Empréstimos', 'empréstimo']] as const) {
    test(`Operações: tocar num ${rotulo} abre o andamento, parcela a parcela e sem nada da loja`, async ({ page }) => {
      await ir(page, 'Operações')
      if (aba === 'Empréstimos') await page.getByRole('button', { name: /^Empréstimos/ }).click()
      const card = page.getByTestId('minhas-vendas').locator('[data-venda]').first()
      await expect(card).toBeVisible()
      const nParcelas = Number(/\d+\/(\d+) parcelas/.exec(await card.innerText())?.[1] ?? '0')
      expect(nParcelas).toBeGreaterThan(0)
      const nome = (await card.locator('.val').first().innerText()).trim()
      const recebido = (await card.locator('.num').first().innerText()).trim() // "R$ 1.200 de R$ 3.000"
      await card.click()
      const folha = page.locator('[role="dialog"]')
      await expect(folha).toBeVisible()
      await expect(folha.locator('[data-andamento-titulo]')).toBeVisible()
      await expect(folha).toContainText(nome)
      await expect(folha.locator('[data-andamento-status]')).toHaveText(/em dia|atrasada|quitada|retomada|cancelada/)
      await expect(folha.locator('[data-andamento-sua-parte]')).toContainText('sua parte R$')
      await expect(folha.locator('[data-andamento-pagas]')).toContainText(`/${nParcelas} parcelas`)
      expect(recebido).toMatch(/R\$/)
      // a lista tem uma linha por parcela (a entrada, quando há, vem a mais)
      expect(await folha.locator('[data-parcela]:not([data-parcela="entrada"])').count()).toBe(nParcelas)
      await expect(folha.locator('[data-parcela]').first()).toBeVisible()
      // só acompanhamento: nada de custo/lucro/capital da loja nem botão de receber
      const texto = (await folha.innerText()).toLowerCase()
      for (const proibido of ['custo', 'lucro', 'capital', 'margem', 'motivo']) expect(texto, proibido).not.toContain(proibido)
      await expect(folha.getByRole('button', { name: /receb/i })).toHaveCount(0)
      await page.keyboard.press('Escape')
      await expect(folha).toHaveCount(0)
    })
  }

  test('Operações: o andamento também abre pelo teclado (Enter) e mostra as parcelas atrasadas em vermelho', async ({ page }) => {
    await ir(page, 'Operações')
    const cards = page.getByTestId('minhas-vendas').locator('[data-venda]')
    await expect(cards.first()).toBeVisible()
    const comAtraso = cards.filter({ hasText: /atrasadas?/ }).first()
    const alvo = (await comAtraso.count()) ? comAtraso : cards.first()
    await alvo.focus(); await page.keyboard.press('Enter')
    const folha = page.locator('[role="dialog"]')
    await expect(folha).toBeVisible()
    await expect.poll(async () => page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true) // o foco vai para a folha
    if (await comAtraso.count()) {
      await expect(folha.locator('[data-estado="atrasada"]').first()).toBeVisible()
      await expect(folha.locator('[data-andamento-atrasado]')).toContainText('R$')
      await expect(folha.locator('[data-andamento-proxima]')).toContainText(/venceu/)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
    await page.keyboard.press('Escape')
    await expect(folha).toHaveCount(0)
    await expect(alvo).toBeFocused() // ao fechar, o foco volta para o card
  })

  test('Repasse: pra receber, já recebi e vai liberar; por cliente sem o capital da loja', async ({ page }) => {
    await ir(page, 'Repasse')
    await expect(page.locator('h1')).toHaveText('Repasse')
    await expect(page.getByTestId('a-receber')).toContainText('R$')
    await expect(page.getByTestId('ja-recebi')).toContainText('R$')
    await expect(page.getByTestId('vai-liberar')).toContainText('R$')
    const op = page.getByTestId('por-cliente').locator('[data-operacao]').first()
    await expect(op).toContainText(/capital (já voltou|ainda voltando)/)
    await expect(op).toContainText('cliente pagou')
    const texto = await page.getByTestId('por-cliente').innerText()
    expect(texto).not.toMatch(/capital R\$/) // o capital é da loja: sem valores
    await expect(page.getByTestId('repasses-recebidos')).toBeVisible()
  })

  test('Cobrança: o indicador não vê "indicado por" (o nome de indicador não vai para ele)', async ({ page }) => {
    await ir(page, 'Cobrança')
    await expect(page.locator('[data-cobranca]').first()).toBeVisible()
    await expect(page.locator('[data-indicador]')).toHaveCount(0)
    await expect(page.locator('.content')).not.toContainText('indicado por')
  })

  test('Estoque: o indicador não tem a tela (nem no menu, nem digitando o endereço)', async ({ page }) => {
    await expect(page.getByRole('button', { name: /^Estoque/ })).toHaveCount(0)
    await expect(page.locator('[data-mais="estoque"]')).toHaveCount(0)
    await navegar(page, '/estoque')
    await expect(page.getByTestId('resumo-estoque')).toHaveCount(0)
    await expect(page.locator('.fone')).toHaveCount(0) // nenhum aparelho listado
    await expect(page.locator('.content')).not.toContainText(/Capital parado|Margem média|Disponível ·/)
  })

  test('Simulador: "Indicar assim" abre a proposta com as parcelas e a simulação na observação', async ({ page }) => {
    await ir(page, 'Simulador')
    await expect(page.locator('h1')).toHaveText('Simulador')
    await expect(page.getByRole('button', { name: 'Vender assim' })).toHaveCount(0)
    await expect(page.locator('#simBem')).toHaveCount(0) // sem estoque: o indicador digita o preço
    await expect(page.locator('.content')).not.toContainText('seu lucro')
    await page.locator('[data-indicar-assim]').click()
    await page.getByTestId('escolher-cliente').locator('[data-cliente]').first().click()
    await expect(page.locator('#pObs')).toHaveValue(/Simulação: R\$ .* · \d+x R\$/)
    await expect(page.locator('#pParcelas')).not.toHaveValue('')
  })

  test('Níveis: conquistados, o atual e o que falta, com o % de cada um', async ({ page }) => {
    await ir(page, 'Níveis')
    await expect(page.locator('h1')).toHaveText('Níveis')
    const n = page.getByTestId('niveis')
    await expect(n.locator('[data-estado="atual"]')).toHaveCount(1)
    await expect(n.locator('[data-estado="atual"]')).toContainText('você está aqui')
    await expect(n.locator('[data-nivel="BRONZE"]')).toContainText('% do lucro')
    expect(await n.locator('[data-nivel]').count()).toBe(4)
    await expect(n.locator('[data-estado="falta"]').first()).toContainText('faltam')
  })

  test('as telas de gestão não existem para o indicador (Equipe, Operações, Indicadores e repasses)', async ({ page }) => {
    for (const rota of ['/equipe', '/operacoes', '/indicadores', '/caixa']) {
      await navegar(page, rota)
      await expect(page.locator('.content')).not.toContainText('Esperando você')
      await expect(page.getByTestId('totais-repasse')).toHaveCount(0)
    }
  })
})

test.describe('o que o indicador não pode', () => {
  test('o "Ver como" de outro perfil volta com o menu daquele perfil (nada do indicador sobra)', async ({ page }) => {
    await entrar(page, 'indicador')
    await verComo(page, 'Cobrador')
    await expect(page.locator('h1')).toHaveText('Hoje')
  })
})
