import { expect, test, type Page } from '@playwright/test'
import { entrar, navegar } from './helpers'

// Demonstração: "hoje" é 08/10/2026; o caixa abre com um aporte de R$ 100.000 (01/01/2026).
/** "R$ 1.234,50" → 1234.5; "−R$ 5,00" → -5 (o menos do sistema é o sinal de menos tipográfico). */
const numero = (t: string) => (/^[−-]/.test(t.trim()) ? -1 : 1) * Number(t.replace(/[^\d,]/g, '').replace(',', '.'))
const txt = async (page: Page, id: string) => numero((await page.getByTestId(id).textContent()) ?? '')
const aba = (page: Page, nome: string | RegExp) => page.getByTestId('rel-abas').getByRole('button', { name: nome })
const semRolagemLateral = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)

test.describe('relatórios (administrador)', () => {
  test.beforeEach(async ({ page }) => { await entrar(page, 'admin'); await navegar(page, '/relatorios'); await expect(page.getByTestId('rel-abas')).toBeVisible() })

  test('abre no Resumo: barras de 6 meses terminando em outubro, lucro por tipo e modelos que mais vendem', async ({ page }) => {
    const cols = page.getByTestId('rel-resumo').locator('.col')
    await expect(cols).toHaveCount(6)
    await expect(cols.last()).toContainText(/out/i)
    await expect(page.getByTestId('rel-lucro-iphones')).toHaveText(/R\$/)
    await expect(page.getByTestId('rel-lucro-emprestimos')).toHaveText(/R\$/)
    await expect(page.getByTestId('rel-modelos').locator('[data-modelo]').first()).toBeVisible()
  })

  test('Investimento e lucro: três séries por mês e a tabela com o total das duas linhas', async ({ page }) => {
    await aba(page, 'Investimento e lucro').click()
    const painel = page.getByTestId('rel-lucro')
    await expect(painel.locator('.col')).toHaveCount(6)
    await expect(painel.locator('.leg')).toContainText('Investido'); await expect(painel.locator('.leg')).toContainText('Recebido'); await expect(painel.locator('.leg')).toContainText('Seu lucro')
    const celula = async (g: string, i: number) => numero((await page.locator(`[data-grupo="${g}"] td`).nth(i).textContent()) ?? '')
    for (const i of [1, 2, 3, 4]) expect(Math.abs((await celula('iphones', i)) + (await celula('emprestimos', i)) - (await celula('total', i)))).toBeLessThanOrEqual(1)
  })

  test('Capital: as quatro partes somam o total, em porcentagens que fecham', async ({ page }) => {
    await aba(page, 'Capital').click()
    const partes = page.locator('[data-parte]')
    await expect(partes).toHaveCount(4)
    let soma = 0
    for (let i = 0; i < 4; i++) soma += numero((await partes.nth(i).locator('b').textContent()) ?? '')
    expect(Math.abs(soma - (await txt(page, 'rel-capital-total')))).toBeLessThanOrEqual(2)
    await expect(partes.filter({ hasText: 'Em caixa' })).toBeVisible()
  })

  test('Por indicador: a linha "Direto" vem primeiro, e a parte dele mais a sua parte dá o lucro total', async ({ page }) => {
    await aba(page, 'Por indicador').click()
    const linhas = page.getByTestId('rel-indicador').locator('[data-indicador]')
    await expect(linhas.first()).toHaveAttribute('data-indicador', 'direto')
    await expect(linhas.first()).toContainText('sem indicador')
    const n = await linhas.count()
    expect(n).toBeGreaterThan(1)
    for (let i = 0; i < n; i++) {
      const c = linhas.nth(i).locator('td')
      const [total, dele, sua] = [numero((await c.nth(3).textContent()) ?? ''), numero((await c.nth(4).textContent()) ?? ''), numero((await c.nth(5).textContent()) ?? '')]
      expect(Math.abs(total - dele - sua)).toBeLessThanOrEqual(1)
    }
  })

  test('Controle mensal: sete meses de julho a janeiro, com o atraso em vermelho e "—" nos meses que ainda não fecharam', async ({ page }) => {
    await aba(page, 'Controle mensal').click()
    const linhas = page.getByTestId('rel-mensal-tabela').locator('tr[data-mes]')
    await expect(linhas).toHaveCount(7)
    await expect(linhas.first()).toHaveAttribute('data-mes', '2026-07'); await expect(linhas.last()).toHaveAttribute('data-mes', '2027-01')
    await expect(linhas.last().locator('td').last()).toHaveText('—')
    await expect(linhas.first().locator('td').nth(3)).toHaveText('—') // julho fechou sem atraso: traço, não R$ 0
    await expect(page.getByTestId('rel-mensal').locator('.col .hj')).toHaveText(/out/i) // o mês de hoje fica em destaque
    await expect(linhas.first().locator('td').last()).toHaveText(/%/)
  })

  test('Balancete: patrimônio = o que você tem − o que você deve, e o caixa é o saldo da tela Caixa', async ({ page }) => {
    await aba(page, 'Balancete').click()
    const [ativo, passivo, patrimonio, caixa] = [await txt(page, 'rel-ativo'), await txt(page, 'rel-passivo'), await txt(page, 'rel-patrimonio'), await txt(page, 'rel-b-caixa')]
    expect(Math.abs(ativo - passivo - patrimonio)).toBeLessThanOrEqual(0.02)
    await expect(page.getByTestId('rel-aportes')).toContainText('Você colocou R$ 100.000')
    // cresceu ou está abaixo, conforme o patrimônio contra o que foi colocado
    const aportes = numero(((await page.getByTestId('rel-aportes').textContent()) ?? '').match(/colocou (R\$ [\d.,]+)/)![1])
    await expect(page.getByTestId('rel-aportes')).toContainText(patrimonio >= aportes ? 'cresceu' : 'abaixo')
    await navegar(page, '/caixa')
    expect(await txt(page, 'caixa-saldo')).toBe(caixa)
  })

  test('um aporte lançado no Caixa aparece no balancete (patrimônio e "Você colocou")', async ({ page }) => {
    await aba(page, 'Balancete').click()
    const antes = await txt(page, 'rel-patrimonio')
    await navegar(page, '/caixa')
    await page.getByTestId('caixa-lancar').click()
    await page.locator('#lcValor').fill('1000000') // R$ 10.000,00
    await page.getByTestId('lanc-salvar').click()
    await expect(page.getByTestId('lanc-salvar')).toHaveCount(0)
    await navegar(page, '/relatorios'); await aba(page, 'Balancete').click()
    await expect.poll(async () => txt(page, 'rel-patrimonio')).toBe(antes + 10000)
    await expect(page.getByTestId('rel-aportes')).toContainText('Você colocou R$ 110.000')
  })

  test('a aba escolhida é lembrada ao voltar para a tela', async ({ page }) => {
    await aba(page, 'Capital').click()
    await navegar(page, '/caixa'); await navegar(page, '/relatorios')
    await expect(page.getByTestId('rel-capital')).toBeVisible()
  })

  test('as seis abas abrem sem rolagem lateral na página (as tabelas rolam por dentro)', async ({ page }) => {
    for (const nome of ['Resumo', 'Investimento e lucro', 'Capital', 'Por indicador', 'Controle mensal', 'Balancete']) {
      await aba(page, nome).click()
      expect(await semRolagemLateral(page), nome).toBe(true)
    }
  })
})

test.describe('relatórios: só o administrador', () => {
  for (const conta of ['vendedor', 'cobrador', 'indicador'] as const) {
    test(`${conta} não vê os relatórios`, async ({ page }) => {
      await entrar(page, conta); await navegar(page, '/relatorios')
      await expect(page.getByTestId('rel-abas')).toHaveCount(0)
      await expect(page.getByText('Esta tela entra nas próximas etapas.')).toBeVisible()
    })
  }
})
