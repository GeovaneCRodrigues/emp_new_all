// ----- Contratos (espelha o módulo de hoje: modelo editável, dados da empresa, taxas, PDF e assinatura) -----
const EMPRESA = {
  nome: 'Mundo dos iPhones LTDA', cnpj: '00.000.000/0001-00', email: 'contato@exemplo.com.br',
  endereco: 'Rua de Exemplo, 100 - Centro, São Paulo - SP', atendente: 'Geovane',
  avaria: 350, reposicao: 1500, seguro: 39.9, cancelamento: 20, recuperacao: 250,
}
const RUAS = ['Rua das Flores, 120', 'Av. Brasil, 2300 ap. 41', 'Rua XV de Novembro, 88', 'Rua Santa Rita, 45', 'Av. Paulista, 900 ap. 12', 'Rua do Comércio, 310', 'Rua Ipiranga, 77', 'Rua Bela Vista, 15']
const docCliente = (c) => c.id === 9 ? { cpf: '', end: '' } : { cpf: `${String(100 + c.id * 37).padStart(3, '0')}.${String(200 + c.id * 13).slice(-3)}.${String(400 + c.id * 29).slice(-3)}-${String(10 + c.id * 7).slice(-2)}`, end: `${RUAS[c.id % RUAS.length]}, São Paulo - SP` }
const numContrato = (v) => `${v.data.slice(0, 4)}-${String(v.id).padStart(4, '0')}`
const temSeguro = (v) => v.seguro ?? v.id % 3 === 0
const addDia = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

// variáveis que o modelo aceita: chave, rótulo, valor
const VARS = [
  ['Contrato', [
    ['contrato_numero', 'Número do contrato', (x) => numContrato(x.v)],
    ['data_venda', 'Data da venda', (x) => dmyA(x.v.data)],
    ['data_fim', 'Fim previsto', (x) => dmyA(x.v.parcelas.at(-1).venc)],
    ['atendente', 'Atendente', () => EMPRESA.atendente],
  ]],
  ['Cliente', [
    ['cliente_nome', 'Nome', (x) => x.c.nome],
    ['cliente_cpf', 'CPF', (x) => x.d.cpf],
    ['cliente_telefone', 'Telefone', (x) => x.c.fone],
    ['cliente_endereco', 'Endereço', (x) => x.d.end],
  ]],
  ['Aparelho', [
    ['aparelho_modelo', 'Modelo', (x) => x.b.modelo],
    ['aparelho_capacidade', 'Capacidade', (x) => `${x.b.gb} GB`],
    ['aparelho_cor', 'Cor', (x) => x.b.cor],
    ['aparelho_estado', 'Estado', (x) => x.b.cond],
    ['aparelho_imei', 'IMEI', (x) => x.b.imei],
  ]],
  ['Pagamento', [
    ['entrada_valor', 'Entrada (caução)', (x) => fmt(x.v.entrada + x.v.troca)],
    ['entrada_composicao', 'Como foi a entrada', (x) => x.v.entrada && x.v.troca ? `${fmt(x.v.entrada)} em dinheiro e um aparelho na troca, avaliado em ${fmt(x.v.troca)}` : x.v.troca ? `aparelho na troca, avaliado em ${fmt(x.v.troca)}` : x.v.entrada ? `${fmt(x.v.entrada)} em dinheiro` : 'sem entrada'],
    ['parcelas_qtd', 'Nº de parcelas', (x) => String(x.v.parcelas.length)],
    ['parcela_valor', 'Valor da parcela', (x) => fmt(x.v.parcelas[0].valor)],
    ['primeiro_vencimento', '1º vencimento', (x) => dmyA(x.v.parcelas[0].venc)],
    ['valor_total', 'Valor total', (x) => fmt(x.k.total)],
    ['seguro_texto', 'Seguro', (x) => temSeguro(x.v) ? `contratado, ${fmt(EMPRESA.seguro)} por mês junto da parcela` : 'não contratado pelo cliente'],
  ]],
  ['Empresa e taxas', [
    ['empresa_nome', 'Razão social', () => EMPRESA.nome],
    ['empresa_cnpj', 'CNPJ', () => EMPRESA.cnpj],
    ['empresa_endereco', 'Endereço', () => EMPRESA.endereco],
    ['empresa_email', 'E-mail', () => EMPRESA.email],
    ['taxa_avaria', 'Taxa de avaria', () => fmt(EMPRESA.avaria)],
    ['taxa_reposicao', 'Reposição (perda/roubo)', () => fmt(EMPRESA.reposicao)],
    ['taxa_cancelamento', 'Multa de cancelamento', () => `${String(EMPRESA.cancelamento).replace('.', ',')}%`],
    ['taxa_recuperacao', 'Taxa de recuperação', () => fmt(EMPRESA.recuperacao)],
  ]],
]
const VAR_MAP = Object.fromEntries(VARS.flatMap(([, l]) => l.map(([k, r, f]) => [k, { r, f }])))
const dmyA = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

const MODELO_PADRAO = `CONTRATO DE LOCAÇÃO DE APARELHO CELULAR COM OPÇÃO DE COMPRA

CONTRATO Nº {{contrato_numero}}
INÍCIO: {{data_venda}}   FIM PREVISTO: {{data_fim}}
ATENDENTE: {{atendente}}

LOCADORA: {{empresa_nome}}, CNPJ {{empresa_cnpj}}
{{empresa_endereco}} · {{empresa_email}}

CLIENTE (LOCATÁRIO): {{cliente_nome}}
CPF: {{cliente_cpf}}   TELEFONE: {{cliente_telefone}}
ENDEREÇO: {{cliente_endereco}}

APARELHO: {{aparelho_modelo}} {{aparelho_capacidade}}, {{aparelho_cor}}
ESTADO: {{aparelho_estado}}   IMEI: {{aparelho_imei}}

CAUÇÃO (ENTRADA): {{entrada_valor}}, composta por {{entrada_composicao}}.
PAGAMENTO: {{parcelas_qtd}}x de {{parcela_valor}}, 1º vencimento em {{primeiro_vencimento}} e as demais no mesmo dia dos meses seguintes.
VALOR TOTAL DO CONTRATO: {{valor_total}}
SEGURO: {{seguro_texto}}.

CLÁUSULA PRIMEIRA: DO OBJETO
1.1. Locação do aparelho acima por prazo determinado. Pagas todas as parcelas, o aparelho passa a ser do LOCATÁRIO.

CLÁUSULA SEGUNDA: DAS TAXAS
2.1. Avaria do aparelho: {{taxa_avaria}}.
2.2. Reposição em caso de perda, furto ou roubo: {{taxa_reposicao}}.
2.3. Cancelamento antes do fim: multa de {{taxa_cancelamento}} sobre o saldo em aberto.
2.4. Recuperação do aparelho por falta de pagamento: {{taxa_recuperacao}}.

CLÁUSULA TERCEIRA: DO ATRASO
3.1. Com parcela em atraso, a LOCADORA pode bloquear e recuperar o aparelho, abatendo do saldo o que já foi pago, descontadas as taxas acima.

E, por estarem de acordo, as partes assinam eletronicamente.`

function preencher(texto, v, marcar = true) {
  const x = { v, k: contas(v), c: cliente(v.clienteId), b: bem(v.bemId) }; x.d = docCliente(x.c)
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  const faltam = new Set()
  const html = esc(texto).replace(/\{\{(\w+)\}\}/g, (m, k) => {
    const def = VAR_MAP[k]; if (!def) return marcar ? `<mark class="f">${m}</mark>` : m
    const val = def.f(x)
    if (!val) { faltam.add(def.r); return marcar ? `<mark class="f">${def.r} não cadastrado</mark>` : '' }
    return marcar ? `<mark>${esc(val)}</mark>` : esc(val)
  })
  return { html, faltam: [...faltam] }
}

function stContrato(v) { return v.contrato === 'ASSINADO' ? { k: 'ASSINADO', l: 'assinado', c: 'c-ok' } : { k: 'ENVIADO', l: 'esperando assinatura', c: 'c-warn' } }

function telaContratos() {
  const aba = S.ctAba || 'lista'
  const head = abasTipo([['lista', 'Contratos', 'file-signature', vendas.filter((v) => v.contrato !== 'ASSINADO' && v.status !== 'RETOMADA').length], ['modelo', 'Modelo', 'receipt-text', 0], ['empresa', 'Empresa e taxas', 'landmark', 0]], aba, 'ctaba')
  if (aba === 'modelo') return head + ctModelo()
  if (aba === 'empresa') return head + ctEmpresa()
  const f = S.ctFiltro || 'TODOS'
  const todos = vendas.slice().sort((a, b) => b.data.localeCompare(a.data))
  const lista = todos.filter((v) => f === 'TODOS' || stContrato(v).k === f)
  const pend = todos.filter((v) => stContrato(v).k === 'ENVIADO')
  const F = [['TODOS', 'Todos'], ['ENVIADO', `Esperando · ${pend.length}`], ['ASSINADO', 'Assinados']]
  return `${head}<div class="resumo3">
      <div><div class="lbl">Assinados</div><div class="val num" style="color:var(--ok)">${todos.length - pend.length}</div></div>
      <div><div class="lbl">Esperando</div><div class="val num" style="color:${pend.length ? 'var(--warn)' : 'var(--strong)'}">${pend.length}</div></div>
      <div><div class="lbl">Com seguro</div><div class="val num">${todos.filter(temSeguro).length}</div></div>
    </div>
    <div class="filtros"><span class="seg">${F.map(([v, l]) => `<button class="${f === v ? 'on' : ''}" data-ctf="${v}">${l}</button>`).join('')}</span></div>
    <div class="card list">${lista.map((v) => { const s = stContrato(v), b = bem(v.bemId), c = cliente(v.clienteId); return `<button class="li" data-contrato="${v.id}">
      <span class="ini" style="background:var(--primary-soft);color:var(--primary)">${ic('file-signature', 'i-sm')}</span>
      <span class="mid"><span class="t" style="display:block">${c.nome}</span><span class="s" style="display:block">Nº ${numContrato(v)} · ${b.modelo} ${b.gb} GB · ${dmy(v.data)}${temSeguro(v) ? ' · com seguro' : ''}</span></span>
      <span class="chip ${s.c}">${s.l}</span></button>` }).join('') || '<div class="empty">Nada aqui.</div>'}</div>`
}

function ctModelo() {
  if (S.ctModelo == null) S.ctModelo = MODELO_PADRAO
  const ex = vendas.find((v) => v.id === (S.ctExemplo || vendas[0].id))
  return `<div class="ct-grid">
    <div class="card pad" style="display:flex;flex-direction:column;gap:12px;min-width:0">
      <div class="between" style="flex-wrap:wrap;gap:8px"><div><div class="val">Locação de aparelho</div><div class="small">Versão ${S.ctVersao || 3} · usado em todas as vendas novas</div></div>
        <span class="seg"><button class="${S.ctPrev ? '' : 'on'}" data-ct-prev="0">Editar</button><button class="${S.ctPrev ? 'on' : ''}" data-ct-prev="1">Ver preenchido</button></span></div>
      ${S.ctPrev ? `<div class="small">Exemplo com a venda de <b>${cliente(ex.clienteId).nome}</b>. Em verde o que veio do sistema, em laranja o que falta cadastrar.</div><div class="papel">${preencher(S.ctModelo, ex).html}</div>`
        : `<textarea id="ctTexto" class="ta" spellcheck="false">${S.ctModelo.replace(/</g, '&lt;')}</textarea>`}
      <div class="row" style="gap:8px;flex-wrap:wrap;justify-content:flex-end"><button class="btn b-ghost" data-ct-padrao>Voltar ao padrão</button><button class="btn b-pri" data-ct-salvar>${ic('check', 'i-sm')}Salvar modelo</button></div>
      <div class="small">Contratos já enviados não mudam. O modelo novo vale a partir da próxima venda.</div>
    </div>
    <div class="card pad" style="display:flex;flex-direction:column;gap:12px;align-self:start">
      <div><div class="val">Campos automáticos</div><div class="small">${S.ctPrev ? 'Volte em Editar para inserir.' : 'Toque para inserir onde está o cursor.'}</div></div>
      ${VARS.map(([g, l]) => `<div><div class="lbl" style="margin-bottom:6px">${g}</div><div class="pills">${l.map(([k, r]) => `<button class="pill" data-ct-var="${k}" ${S.ctPrev ? 'disabled' : ''}>${r}</button>`).join('')}</div></div>`).join('')}
    </div></div>`
}

function ctEmpresa() {
  const E = EMPRESA
  const campo = (id, l, v, extra = '') => `<div class="field"><label>${l}</label><div class="inp">${extra}<input id="${id}" value="${String(v).replace(/"/g, '&quot;')}" style="font-size:14px"></div></div>`
  const taxa = (id, l, v, ajuda, pct) => `<div class="field"><label>${l}</label><div class="inp">${pct ? '' : '<span>R$</span>'}<input id="${id}" inputmode="decimal" value="${String(v).replace('.', ',')}" style="font-size:14px">${pct ? '<span>%</span>' : ''}</div><div class="small">${ajuda}</div></div>`
  return `<div class="card pad" style="display:flex;flex-direction:column;gap:12px">
      <div><div class="val">Dados da empresa</div><div class="small">Saem no cabeçalho de todo contrato.</div></div>
      <div class="duo">${campo('eNome', 'Razão social', E.nome)}${campo('eCnpj', 'CNPJ', E.cnpj)}${campo('eEmail', 'E-mail', E.email)}${campo('eAtend', 'Atendente que assina', E.atendente)}</div>
      ${campo('eEnd', 'Endereço', E.endereco)}
    </div>
    <div class="card pad" style="display:flex;flex-direction:column;gap:12px">
      <div><div class="val">Taxas do contrato</div><div class="small">Valem para os próximos contratos.</div></div>
      <div class="duo">
        ${taxa('tAvaria', 'Avaria do aparelho', E.avaria, 'Cobrada se o aparelho voltar danificado.')}
        ${taxa('tRepo', 'Reposição (perda, furto ou roubo)', E.reposicao, 'Valor para repor o aparelho.')}
        ${taxa('tSeguro', 'Seguro por mês', E.seguro, 'Opcional. Se o cliente quiser, entra junto da parcela.')}
        ${taxa('tCanc', 'Multa de cancelamento', E.cancelamento, 'Sobre o saldo em aberto, se o cliente desistir.', true)}
        ${taxa('tRecup', 'Recuperação por atraso', E.recuperacao, 'Quando é preciso ir buscar o aparelho.')}
      </div>
    </div>
    <div class="card pad" style="display:flex;flex-direction:column;gap:10px">
      <div class="between"><div><div class="val">Assinatura eletrônica</div><div class="small">ZapSign · o cliente assina pelo link no WhatsApp</div></div><span class="chip c-ok">conectado</span></div>
    </div>
    <button class="btn b-pri b-block" data-emp-salvar>${ic('check', 'i-sm')}Salvar</button>`
}

function folhaContrato(id) {
  const v = vendas.find((x) => x.id === id), s = stContrato(v), c = cliente(v.clienteId)
  const { html, faltam } = preencher(S.ctModelo ?? MODELO_PADRAO, v)
  const passos = [
    ['Gerado', dmy(v.data), true],
    ['Enviado no WhatsApp', `${dmy(v.data)} · ${c.fone}`, true],
    ['Assinado', s.k === 'ASSINADO' ? dmy(addDia(v.data, v.id % 2)) : 'esperando o cliente', s.k === 'ASSINADO'],
  ]
  return `<div class="between" style="gap:10px"><div style="min-width:0"><h3>Contrato ${numContrato(v)}</h3><div class="small">${c.nome} · ${bem(v.bemId).modelo}</div></div><span class="chip ${s.c}">${s.l}</span></div>
    <div class="passos">${passos.map(([t, sub, ok]) => `<div class="${ok ? 'ok' : ''}"><span class="dot">${ok ? ic('check', 'i-sm') : ''}</span><span><b>${t}</b><span class="small" style="display:block">${sub}</span></span></div>`).join('')}</div>
    ${faltam.length ? `<div class="aviso">${ic('file-signature', 'i-sm')}<span>Falta ${faltam.join(' e ').toLowerCase()} do cliente. O link pede pra ele completar antes de assinar.</span></div>` : ''}
    <div class="papel" style="margin-top:12px">${html}</div>
    <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
      ${s.k === 'ASSINADO'
        ? `<button class="btn b-pri" style="flex:1" data-ct-pdf="${v.id}">${ic('receipt-text', 'i-sm')}Baixar PDF assinado</button>`
        : `<button class="btn b-ok" style="flex:1" data-ct-reenviar="${v.id}">${ic('send', 'i-sm')}Reenviar no WhatsApp</button><button class="btn b-out" data-ct-link="${v.id}">${ic('copy', 'i-sm')}Copiar link</button><button class="btn b-ghost" data-ct-sinc="${v.id}">Já assinou?</button>`}
    </div>`
}

function cliquesContratos(t, d) {
  if (d.ctaba) { S.ctAba = d.ctaba; render(); return true }
  if (d.ctf) { S.ctFiltro = d.ctf; render(); return true }
  if (d.contrato) { abrir('contrato', Number(d.contrato)); return true }
  if (d.ctPrev != null) { const ta = document.getElementById('ctTexto'); if (ta) S.ctModelo = ta.value; S.ctPrev = d.ctPrev === '1'; render(); return true }
  if (d.ctVar) {
    const ta = document.getElementById('ctTexto'); if (!ta) return true
    const a = ta.selectionStart ?? ta.value.length, b = ta.selectionEnd ?? a, ins = `{{${d.ctVar}}}`
    ta.value = ta.value.slice(0, a) + ins + ta.value.slice(b); S.ctModelo = ta.value
    ta.focus(); ta.setSelectionRange(a + ins.length, a + ins.length); return true
  }
  if ('ctPadrao' in d) { S.ctModelo = MODELO_PADRAO; render(); toast('Modelo padrão de volta. Salve para valer.'); return true }
  if ('ctSalvar' in d) { const ta = document.getElementById('ctTexto'); if (ta) S.ctModelo = ta.value; S.ctVersao = (S.ctVersao || 3) + 1; render(); toast(`Modelo salvo · versão ${S.ctVersao}`); return true }
  if ('empSalvar' in d) {
    const val = (id) => document.getElementById(id).value.trim(), num = (id) => Number(val(id).replace(/\./g, '').replace(',', '.')) || 0
    Object.assign(EMPRESA, { nome: val('eNome'), cnpj: val('eCnpj'), email: val('eEmail'), atendente: val('eAtend'), endereco: val('eEnd'), avaria: num('tAvaria'), reposicao: num('tRepo'), seguro: num('tSeguro'), cancelamento: num('tCanc'), recuperacao: num('tRecup') })
    toast('Dados da empresa e taxas salvos'); return true
  }
  if (d.ctReenviar) { toast(`Link de assinatura reenviado para ${cliente(vendas.find((v) => v.id === Number(d.ctReenviar)).clienteId).fone}`); return true }
  if (d.ctLink) { try { navigator.clipboard.writeText(`https://app.zapsign.com.br/verificar/exemplo-${d.ctLink}`).catch(() => {}) } catch {} toast('Link de assinatura copiado'); return true }
  if (d.ctPdf) { toast('No sistema de verdade, abre o PDF assinado'); return true }
  if (d.ctSinc) { const v = vendas.find((x) => x.id === Number(d.ctSinc)); v.contrato = 'ASSINADO'; S.folha = { tipo: 'contrato', arg: v.id }; render(); toast('Conferido na ZapSign: assinado'); return true }
  return false
}
