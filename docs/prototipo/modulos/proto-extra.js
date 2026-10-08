// ===== Telas que vieram do sistema atual: Cronograma, Indicadores, Relatórios, Configurações, Renegociar =====
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const MES3 = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const kfmt = (v) => v >= 1000 ? (Math.round(v / 100) / 10).toLocaleString('pt-BR') + 'k' : String(Math.round(v))
const mesLabel = (ym) => `${MESES[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`
const mesCurto = (ym) => MES3[Number(ym.slice(5, 7)) - 1]
const somaYm = (ym, n) => somaMes(ym + '-01', n, 1).slice(0, 7)
const filtroTipo = (x) => S.cobTipo === 'todos' || (x.v.tipo === 'EMP') === (S.cobTipo === 'emp')
Object.assign(parceiros[1], { fone: '(11) 98877-6655', pix: 'roberto@exemplo.com' })
Object.assign(parceiros[2], { fone: '(11) 3344-5566', pix: '00.000.000/0001-99' })

// ----- Cronograma -----
function telaCronograma() {
  const ym = S.cronMes || HOJE.slice(0, 7)
  const todas = cobrancas().filter(filtroTipo)
  const doMes = todas.filter((x) => x.p.venc.slice(0, 7) === ym)
  const previsto = doMes.reduce((s, x) => s + x.p.valor, 0)
  const recebido = doMes.reduce((s, x) => s + pagoP(x.p), 0)
  const atrasado = doMes.filter((x) => !x.p.pago && x.p.venc < HOJE).reduce((s, x) => s + faltaP(x.p), 0)
  const [y, m] = ym.split('-').map(Number)
  const primeiro = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(), dias = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const sel = S.cronDia && S.cronDia.slice(0, 7) === ym ? S.cronDia : (ym === HOJE.slice(0, 7) ? HOJE : null)
  const cel = []
  for (let i = 0; i < primeiro; i++) cel.push('<span></span>')
  for (let d = 1; d <= dias; d++) {
    const iso = `${ym}-${String(d).padStart(2, '0')}`, xs = doMes.filter((x) => x.p.venc === iso)
    const aberto = xs.filter((x) => !x.p.pago), tot = xs.reduce((s, x) => s + (x.p.pago ? pagoP(x.p) : faltaP(x.p)), 0)
    const cor = !xs.length ? '' : aberto.some((x) => iso < HOJE) ? 'var(--bad)' : aberto.length ? (iso === HOJE || diasEntre(HOJE, iso) <= 7 ? 'var(--warn)' : 'var(--dim)') : 'var(--ok)'
    cel.push(`<button class="d ${iso === HOJE ? 'hoje' : ''} ${iso === sel ? 'sel' : ''}" data-cron-dia="${iso}"><span class="n">${d}</span>${xs.length ? `<span class="v num" style="color:${cor}">${kfmt(tot)}</span><span class="q">${xs.length} ${xs.length === 1 ? 'parcela' : 'parcelas'}</span>` : ''}</button>`)
  }
  const doDia = sel ? doMes.filter((x) => x.p.venc === sel) : []
  return `${abasTipo([['todos', 'Tudo', 'layers', 0], ['iphone', 'iPhones', 'smartphone', 0], ['emp', 'Empréstimos', 'landmark', 0]], S.cobTipo, 'cobtipo')}
    <div class="between" style="gap:8px"><div class="row" style="gap:6px"><button class="btn b-out b-sm" data-cron-mes="-1" aria-label="Mês anterior">${ic('chevron-left', 'i-sm')}</button><b style="color:var(--strong);font-size:15px;min-width:140px;text-align:center;text-transform:capitalize">${mesLabel(ym)}</b><button class="btn b-out b-sm" data-cron-mes="1" aria-label="Próximo mês">${ic('chevron-right', 'i-sm')}</button></div>${ym !== HOJE.slice(0, 7) ? '<button class="btn b-ghost b-sm" data-cron-mes="0">Hoje</button>' : ''}</div>
    <div class="resumo3"><div><div class="lbl">Previsto</div><div class="val num">${fmt0(previsto)}</div></div><div><div class="lbl">Recebido</div><div class="val num" style="color:var(--ok)">${fmt0(recebido)}</div></div><div><div class="lbl">Em atraso</div><div class="val num" style="color:${atrasado ? 'var(--bad)' : 'var(--strong)'}">${fmt0(atrasado)}</div></div></div>
    <div class="card pad"><div class="cal sem">${['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'].map((d) => `<span>${d}</span>`).join('')}</div><div class="cal">${cel.join('')}</div>
      <div class="small" style="margin-top:10px">Vermelho atrasado · laranja vence esta semana · verde pago</div></div>
    ${sel ? `<div class="card"><div class="totbar"><b style="color:var(--strong)">${Number(sel.slice(8))} de ${MESES[Number(sel.slice(5, 7)) - 1]}</b><span class="small">${doDia.length ? `${doDia.length} ${doDia.length === 1 ? 'parcela' : 'parcelas'}` : 'nada vence neste dia'}</span></div>${doDia.length ? `<div class="list">${doDia.map(cobLinha).join('')}</div>` : ''}</div>` : ''}`
}

// ----- Indicadores -----
function infoIndicador(p) {
  const r = repasseDevido(p.id), ks = r.ops.map((o) => ({ o, k: contasOp(o) }))
  const ativas = ks.filter(({ k }) => k.status === 'ATIVA')
  return { r, ks, ativas, naRua: ativas.reduce((s, { k }) => s + Math.max(0, k.inv - k.capitalDeVolta), 0), lucroDele: ks.reduce((s, { k }) => s + Math.max(0, k.lucroTotal) * p.pct, 0) }
}
function telaIndicadores() {
  const ps = parceiros.filter((p) => p.id)
  const tot = ps.map(infoIndicador)
  return `<p class="small" style="margin:0">Quem traz cliente ganha uma parte do lucro. A parte dele só começa depois que o seu capital volta.</p>
    <div class="resumo3"><div><div class="lbl">Indicadores</div><div class="val num">${ps.length}</div></div><div><div class="lbl">Capital via eles</div><div class="val num">${fmt0(tot.reduce((s, i) => s + i.naRua, 0))}</div></div><div><div class="lbl">A repassar</div><div class="val num" style="color:var(--warn)">${fmt0(tot.reduce((s, i) => s + i.r.devido, 0))}</div></div></div>
    <div class="fones">${ps.map((p, i) => { const x = tot[i]; return `<button class="card pad" style="text-align:left;display:flex;flex-direction:column;gap:12px" data-indicador="${p.id}">
      <div class="row"><span class="ini" style="background:var(--primary-soft);color:var(--primary)">${iniciais(p.nome)}</span><div style="flex:1;min-width:0"><div class="val">${p.nome}</div><div class="small">${p.fone || 'sem WhatsApp'}</div></div><span class="chip c-pri">${Math.round(p.pct * 100)}% do lucro</span></div>
      <div class="dl" style="grid-template-columns:repeat(3,minmax(0,1fr))"><div><div class="lbl">Operações</div><div class="val num">${x.ativas.length} ativas</div></div><div><div class="lbl">Capital na rua</div><div class="val num">${fmt0(x.naRua)}</div></div><div><div class="lbl">A repassar</div><div class="val num" style="color:${x.r.devido ? 'var(--warn)' : 'var(--dim)'}">${fmt0(x.r.devido)}</div></div></div>
    </button>` }).join('')}</div>`
}
function folhaIndicador(id) {
  const p = parceiros.find((x) => x.id === id), x = infoIndicador(p)
  return `<div class="row" style="gap:12px"><span class="ini" style="background:var(--primary-soft);color:var(--primary)">${iniciais(p.nome)}</span><div style="flex:1;min-width:0"><h3>${p.nome}</h3><div class="small">${p.fone || ''}${p.pix ? ` · Pix ${p.pix}` : ''}</div></div></div>
    <div class="dl" style="margin-top:14px"><div><div class="lbl">Já ganhou</div><div class="val num">${fmt(x.r.gerado)}</div><div class="small">você pagou ${fmt(x.r.pago)}</div></div><div><div class="lbl">A repassar agora</div><div class="val num" style="color:${x.r.devido ? 'var(--warn)' : 'var(--dim)'}">${fmt(x.r.devido)}</div><div class="small">vai ganhar ${fmt(x.lucroDele)} no total</div></div></div>
    <div class="field" style="margin-top:14px"><label>Parte do lucro nas próximas operações</label><div class="pills">${[0.1, 0.2, 0.3, 0.4, 0.5].map((v) => `<button class="pill ${Math.abs(p.pct - v) < 0.001 ? 'on' : ''}" data-ind-pct="${p.id}:${v}">${v * 100}%</button>`).join('')}</div><div class="small">Operações que já existem continuam com o % de quando foram feitas.</div></div>
    <div class="lbl" style="margin:14px 0 6px">Operações dele</div>
    <div class="card list">${x.ks.map(({ o, k }) => `<button class="li" data-venda="${o.id}"><span class="mid"><span class="t" style="display:block">${cliente(o.clienteId).nome}</span><span class="s" style="display:block">${o.tipo === 'EMP' ? MOD[o.mod].label : itemOp(o).modelo} · ${dmy(o.data)} · ${k.status === 'ATIVA' ? (k.capitalDeVolta >= k.inv ? 'capital já voltou' : `${Math.round(k.capitalDeVolta / k.inv * 100)}% do capital de volta`) : 'quitada'}</span></span><span class="small num">${fmt0(Math.max(0, k.lucroTotal) * p.pct)}</span></button>`).join('') || '<div class="empty">Nenhuma operação ainda.</div>'}</div>
    <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">${x.r.devido ? `<button class="btn b-pri" style="flex:1" data-repasse="${p.id}">${ic('send', 'i-sm')}Paguei ${fmt(x.r.devido)}</button>` : ''}<button class="btn b-out" style="flex:1" data-ind-extrato="${p.id}">${ic('message-circle', 'i-sm')}Mandar extrato no WhatsApp</button></div>`
}
function folhaNovoIndicador() {
  const pct = S.niPct ?? 0.3
  return `<h3>Indicador novo</h3><div style="display:flex;flex-direction:column;gap:12px;margin-top:14px">
    <div class="field"><label>Nome</label><div class="inp"><input id="iNome" placeholder="Nome ou loja" style="font-size:15px"></div></div>
    <div class="field"><label>WhatsApp</label><div class="inp"><input id="iFone" inputmode="tel" placeholder="(11) 9...." style="font-size:15px"></div></div>
    <div class="field"><label>Chave Pix</label><div class="inp"><input id="iPix" placeholder="Para pagar os repasses" style="font-size:15px"></div></div>
    <div class="field"><label>Parte do lucro</label><div class="pills">${[0.1, 0.2, 0.3, 0.4, 0.5].map((v) => `<button class="pill ${Math.abs(pct - v) < 0.001 ? 'on' : ''}" data-ni-pct="${v}">${v * 100}%</button>`).join('')}</div></div>
    <button class="btn b-pri b-block" data-ni-salvar>Cadastrar</button></div>`
}

// ----- Relatórios -----
function mesesJanela(de, ate) { const out = []; for (let i = de; i <= ate; i++) out.push(somaYm(HOJE.slice(0, 7), i)); return out }
function colocadoPorMes() {
  const m = {}
  for (const v of vendas) { const k = v.data.slice(0, 7); m[k] = (m[k] || 0) + investido(bem(v.bemId)) }
  for (const e of emprestimos) { const k = e.data.slice(0, 7); m[k] = (m[k] || 0) + e.capital }
  return m
}
function recebidoPorMes() {
  const m = {}
  for (const o of [...vendas, ...emprestimos]) {
    if (o.tipo !== 'EMP' && o.entrada + o.troca) m[o.data.slice(0, 7)] = (m[o.data.slice(0, 7)] || 0) + o.entrada + o.troca
    for (const p of o.parcelas) for (const g of p.pagos) m[g.data.slice(0, 7)] = (m[g.data.slice(0, 7)] || 0) + g.valor
  }
  return m
}
function barras(series, meses, alt = 130) {
  const max = Math.max(1, ...meses.flatMap((k) => series.map((s) => s.d[k] || 0)))
  return `<div class="barras" style="height:${alt + 34}px">${meses.map((k) => `<div class="col"><div class="bs" style="height:${alt}px">${series.map((s) => `<span title="${s.l} ${fmt0(s.d[k] || 0)}" style="height:${Math.max(2, (s.d[k] || 0) / max * alt)}px;background:${s.c}"></span>`).join('')}</div><span class="small ${k === HOJE.slice(0, 7) ? 'hj' : ''}">${mesCurto(k)}</span></div>`).join('')}</div>
    <div class="leg">${series.map((s) => `<span><i style="background:${s.c}"></i>${s.l}</span>`).join('')}</div>`
}
function tabela(cab, linhas, total) {
  return `<div class="tab-x"><table class="tb"><thead><tr>${cab.map((c, i) => `<th${i ? ' class="r"' : ''}>${c}</th>`).join('')}</tr></thead><tbody>${linhas.map((l) => `<tr>${l.map((c, i) => `<td${i ? ' class="r num"' : ''}>${c}</td>`).join('')}</tr>`).join('')}</tbody>${total ? `<tfoot><tr>${total.map((c, i) => `<td${i ? ' class="r num"' : ''}>${c}</td>`).join('')}</tr></tfoot>` : ''}</table></div>`
}
function relLucro() {
  const meses = mesesJanela(-5, 0), col = colocadoPorMes(), rec = recebidoPorMes(), luc = lucroPorMes()
  const grupos = [['iPhones', vendas], ['Empréstimos', emprestimos]].map(([l, ops]) => {
    const ks = ops.map(contasOp)
    const inv = ks.reduce((s, k) => s + k.inv, 0), recb = ks.reduce((s, k) => s + k.recebido, 0), real = ks.reduce((s, k) => s + k.lucroRealizado, 0), vir = ks.filter((k) => k.status === 'ATIVA').reduce((s, k) => s + Math.max(0, k.seuLucro - k.lucroRealizado), 0)
    return [l, inv, recb, real, vir, ks.reduce((s, k) => s + Math.max(0, k.seuLucro), 0) / Math.max(1, inv)]
  })
  return `<div class="card pad"><div class="between"><b style="color:var(--strong)">Dinheiro que saiu, voltou e virou lucro</b><span class="small">últimos 6 meses</span></div>
      ${barras([{ l: 'Investido', d: col, c: 'var(--dim)' }, { l: 'Recebido', d: rec, c: 'var(--primary)' }, { l: 'Seu lucro', d: luc, c: 'var(--gold)' }], meses)}</div>
    <div class="card">${tabela(['', 'Investido', 'Recebido', 'Lucro no bolso', 'Lucro por vir', 'Retorno'], grupos.map(([l, a, b, c, d, r]) => [`<b>${l}</b>`, fmt0(a), fmt0(b), `<span style="color:var(--ok)">${fmt0(c)}</span>`, fmt0(d), `${Math.round(r * 100)}%`]),
      ['<b>Total</b>', fmt0(grupos.reduce((s, g) => s + g[1], 0)), fmt0(grupos.reduce((s, g) => s + g[2], 0)), fmt0(grupos.reduce((s, g) => s + g[3], 0)), fmt0(grupos.reduce((s, g) => s + g[4], 0)), ''])}</div>
    <p class="small" style="margin:0">Retorno = seu lucro total ÷ o que você investiu. Com indicador, conta só a sua parte.</p>`
}
function relCapital() {
  const meses = mesesJanela(-5, 0), col = colocadoPorMes()
  const saldo = movimentos().reduce((s, m) => s + (m.ent ? m.valor : -m.valor), 0)
  const estoque = bens.filter((b) => b.estado === 'DISPONIVEL').reduce((s, b) => s + investido(b), 0)
  const naRua = (ops) => ops.map(contasOp).filter((k) => k.status === 'ATIVA').reduce((s, k) => s + Math.max(0, k.inv - k.capitalDeVolta), 0)
  const partes = [['Em caixa', Math.max(0, saldo), 'var(--gold)'], ['No estoque', estoque, 'var(--dim)'], ['Vendas na rua', naRua(vendas), 'var(--primary)'], ['Empréstimos na rua', naRua(emprestimos), 'var(--side)']]
  const tot = partes.reduce((s, p) => s + p[1], 0)
  return `<div class="card pad" style="display:flex;flex-direction:column;gap:12px"><div class="between"><b style="color:var(--strong)">Onde está seu capital hoje</b><b class="num" style="color:var(--strong)">${fmt0(tot)}</b></div>
      <div class="pilha">${partes.map(([l, v, c]) => `<i style="width:${v / tot * 100}%;background:${c}" title="${l}"></i>`).join('')}</div>
      <div class="list">${partes.map(([l, v, c]) => `<div class="li" style="padding:8px 0"><i style="width:10px;height:10px;border-radius:3px;background:${c};flex:none"></i><span class="mid t">${l}</span><span class="small num">${Math.round(v / tot * 100)}%</span><b class="num" style="width:96px;text-align:right">${fmt0(v)}</b></div>`).join('')}</div></div>
    <div class="card pad"><div class="between"><b style="color:var(--strong)">Capital colocado por mês</b><span class="small">iPhones comprados + empréstimos liberados</span></div>${barras([{ l: 'Colocado', d: col, c: 'var(--primary)' }], meses, 110)}</div>`
}
function relIndicador() {
  const linhas = parceiros.map((p) => {
    const ops = [...vendas, ...emprestimos].filter((o) => o.parceiroId === p.id), ks = ops.map(contasOp)
    const lt = ks.reduce((s, k) => s + Math.max(0, k.lucroTotal), 0)
    return [p.id ? `<b>${p.nome}</b>` : '<b>Direto</b> <span class="small">(sem indicador)</span>', String(ops.length), fmt0(ks.filter((k) => k.status === 'ATIVA').reduce((s, k) => s + Math.max(0, k.inv - k.capitalDeVolta), 0)), fmt0(lt), fmt0(lt * p.pct), `<span style="color:var(--ok)">${fmt0(lt * (1 - p.pct))}</span>`]
  })
  return `<div class="card">${tabela(['', 'Operações', 'Capital na rua', 'Lucro total', 'Parte dele', 'Sua parte'], linhas)}</div>
    <p class="small" style="margin:0">Lucro total = tudo que a operação rende acima do capital, contando o que ainda vai entrar.</p>`
}
function relMensal() {
  const meses = mesesJanela(-3, 3), todas = cobrancas()
  const prev = {}, rec = {}, atr = {}
  for (const x of todas) { const k = x.p.venc.slice(0, 7); prev[k] = (prev[k] || 0) + x.p.valor; rec[k] = (rec[k] || 0) + pagoP(x.p); if (!x.p.pago && x.p.venc < HOJE) atr[k] = (atr[k] || 0) + faltaP(x.p) }
  return `<div class="card pad"><div class="between"><b style="color:var(--strong)">Previsto x recebido</b><span class="small">pelo mês do vencimento</span></div>${barras([{ l: 'Previsto', d: prev, c: 'var(--border)' }, { l: 'Recebido', d: rec, c: 'var(--primary)' }, { l: 'Em atraso', d: atr, c: 'var(--bad)' }], meses)}</div>
    <div class="card">${tabela(['Mês', 'Previsto', 'Recebido', 'Em atraso', 'Recebeu'], meses.map((k) => [`<span style="text-transform:capitalize">${mesLabel(k)}</span>`, fmt0(prev[k] || 0), fmt0(rec[k] || 0), atr[k] ? `<span style="color:var(--bad)">${fmt0(atr[k])}</span>` : '—', k > HOJE.slice(0, 7) ? '—' : `${Math.round((rec[k] || 0) / Math.max(1, prev[k] || 0) * 100)}%`]))}</div>`
}
function relBalancete() {
  const saldo = movimentos().reduce((s, m) => s + (m.ent ? m.valor : -m.valor), 0)
  const estoque = bens.filter((b) => b.estado === 'DISPONIVEL').reduce((s, b) => s + investido(b), 0)
  const aRec = (ops) => ops.map(contasOp).filter((k) => k.status === 'ATIVA').reduce((s, k) => s + k.falta, 0)
  const repasses = parceiros.filter((p) => p.id).reduce((s, p) => s + repasseDevido(p.id).devido, 0)
  const futuroParc = [...vendas, ...emprestimos].filter((o) => o.parceiroId).map((o) => ({ o, k: contasOp(o) })).filter(({ k }) => k.status === 'ATIVA').reduce((s, { o, k }) => s + Math.max(0, k.lucroTotal - Math.max(0, k.recebido - k.inv)) * parceiro(o.parceiroId).pct, 0)
  const aportes = movManuais.filter((m) => m.tipo === 'APORTE').reduce((s, m) => s + m.valor, 0) - movManuais.filter((m) => m.tipo === 'RETIRADA').reduce((s, m) => s + m.valor, 0)
  const ativo = saldo + estoque + aRec(vendas) + aRec(emprestimos), passivo = repasses + futuroParc, pl = ativo - passivo
  const linha = (l, v, s = '') => `<div class="li" style="padding:9px 14px"><span class="mid"><span class="t" style="display:block">${l}</span>${s ? `<span class="s" style="display:block">${s}</span>` : ''}</span><b class="num">${fmt(v)}</b></div>`
  return `<div class="duo">
      <div class="card"><div class="totbar"><b style="color:var(--strong)">O que você tem</b><b class="num" style="color:var(--strong)">${fmt(ativo)}</b></div><div class="list">${linha('Caixa', saldo)}${linha('Estoque', estoque, 'pelo custo dos aparelhos')}${linha('A receber de vendas', aRec(vendas), 'parcelas em aberto')}${linha('A receber de empréstimos', aRec(emprestimos), 'parcelas em aberto')}</div></div>
      <div class="card"><div class="totbar"><b style="color:var(--strong)">O que você deve</b><b class="num" style="color:var(--bad)">${fmt(passivo)}</b></div><div class="list">${linha('Repasses a pagar', repasses, 'já liberados para os indicadores')}${linha('Parte futura dos indicadores', futuroParc, 'do que ainda vai entrar')}</div></div>
    </div>
    <div class="hero" style="gap:6px"><div class="lbl">Patrimônio do negócio</div><div class="big disp num">${fmt(pl)}</div><div class="lbl">Você colocou ${fmt0(aportes)} · ${pl >= aportes ? `cresceu <b style="color:#d8f5c0">${fmt0(pl - aportes)}</b>` : `está <b style="color:#ffd6cf">${fmt0(aportes - pl)}</b> abaixo`}</div></div>`
}
function telaRelatorios() {
  const aba = S.relAba || 'resumo'
  const A = [['resumo', 'Resumo', 'house', 0], ['lucro', 'Investimento e lucro', 'arrow-up-right', 0], ['capital', 'Capital', 'wallet', 0], ['indicador', 'Por indicador', 'users', 0], ['mensal', 'Controle mensal', 'calendar-days', 0], ['balancete', 'Balancete', 'landmark', 0]]
  const corpo = { resumo: caixaRelatorios, lucro: relLucro, capital: relCapital, indicador: relIndicador, mensal: relMensal, balancete: relBalancete }[aba]()
  return abasTipo(A, aba, 'relaba') + corpo
}

// ----- Configurações -----
const CFG = {
  waOn: true, waFone: '(11) 99000-1100', lembretes: true, hora: '09:00', pix: 'contato@exemplo.com.br', resumoDia: true, diarias: true,
  regras: { antes2: true, nodia: true, depois1: true, depois3: true, depois7: false },
  msgs: {
    antes: 'Oi {nome}! Passando para lembrar que a parcela {parcela} do seu {aparelho}, de {valor}, vence em {vencimento}. Pix: {pix}',
    nodia: 'Oi {nome}, hoje vence a parcela {parcela} do seu {aparelho}: {valor}. Pix: {pix}. Se já pagou, me manda o comprovante por aqui.',
    atraso: 'Oi {nome}, a parcela {parcela} do seu {aparelho} ({valor}) venceu em {vencimento} e ainda não consta aqui. Consegue acertar hoje? Pix: {pix}',
  },
  bot: [{ id: 1, nome: 'Geovane', fone: '(11) 99000-1100' }, { id: 2, nome: 'Diego Ramos', fone: '(11) 97788-2201' }],
}
const MSG_VARS = [['nome', 'Nome'], ['parcela', 'Nº da parcela'], ['valor', 'Valor'], ['vencimento', 'Vencimento'], ['aparelho', 'Aparelho'], ['pix', 'Pix']]
function msgExemplo(t) { return t.replace(/\{(\w+)\}/g, (m, k) => ({ nome: 'Juliana', parcela: '4/12', valor: 'R$ 250,00', vencimento: '20/10', aparelho: 'iPhone 13', pix: CFG.pix }[k] ?? m)) }
const sw = (on, attr) => `<button class="sw ${on ? 'on' : ''}" ${attr} role="switch" aria-checked="${on}"></button>`
function telaConfig() {
  const msg = S.cfgMsg || 'antes'
  const qr = Array.from({ length: 21 * 21 }, (_, i) => { const x = i % 21, y = (i / 21) | 0, borda = (a, b) => a < 7 && b < 7; const f = borda(x, y) || borda(20 - x, y) || borda(x, 20 - y); const on = f ? (x % 6 === 0 || y % 6 === 0 || (x % 6 > 1 && x % 6 < 5 && y % 6 > 1 && y % 6 < 5) || x === 20 || y === 20 || x === 14 || y === 14) : ((x * 7 + y * 13 + x * y) % 3 === 0); return on ? `<i style="grid-column:${x + 1};grid-row:${y + 1}"></i>` : '' }).join('')
  return `<div class="card pad" style="display:flex;flex-direction:column;gap:12px">
      <div class="between" style="gap:10px"><div><div class="val">WhatsApp da loja</div><div class="small">Por onde saem os lembretes, os contratos e o bot.</div></div>${CFG.waOn ? '<span class="chip c-ok">conectado</span>' : '<span class="chip c-bad">desconectado</span>'}</div>
      ${CFG.waOn ? `<div class="between"><span class="row" style="gap:8px">${ic('message-circle', 'i-sm')}<b class="num">${CFG.waFone}</b></span><button class="btn b-out b-sm" data-cfg-wa="0">Desconectar</button></div>`
        : `<div class="row" style="gap:16px;flex-wrap:wrap"><div class="qr">${qr}</div><div style="flex:1;min-width:180px" class="small">No celular da loja, abra o WhatsApp › Aparelhos conectados › Conectar aparelho e aponte para o código.<div style="margin-top:10px"><button class="btn b-pri b-sm" data-cfg-wa="1">Já escaneei</button></div></div></div>`}
    </div>
    <div class="card pad" style="display:flex;flex-direction:column;gap:14px">
      <div class="between"><div><div class="val">Lembretes automáticos</div><div class="small">Mandados todo dia às ${CFG.hora} para quem tem parcela.</div></div>${sw(CFG.lembretes, 'data-cfg-tg="lembretes"')}</div>
      <div class="field"><label>Quando mandar</label><div class="pills">${[['antes2', '2 dias antes'], ['nodia', 'No dia'], ['depois1', '1 dia depois'], ['depois3', '3 dias depois'], ['depois7', '7 dias depois']].map(([k, l]) => `<button class="pill ${CFG.regras[k] ? 'on' : ''}" data-cfg-regra="${k}">${l}</button>`).join('')}</div></div>
      <div class="duo"><div class="field"><label>Horário</label><div class="pills">${['08:00', '09:00', '10:00', '14:00'].map((h) => `<button class="pill ${CFG.hora === h ? 'on' : ''}" data-cfg-hora="${h}">${h}</button>`).join('')}</div></div>
        <div class="field"><label>Chave Pix que vai na mensagem</label><div class="inp"><input id="cfgPix" value="${CFG.pix}" style="font-size:14px"></div></div></div>
      <div class="field"><label>Mensagem</label><span class="seg" style="align-self:flex-start">${[['antes', 'Antes'], ['nodia', 'No dia'], ['atraso', 'Atrasado']].map(([k, l]) => `<button class="${msg === k ? 'on' : ''}" data-cfg-msg="${k}">${l}</button>`).join('')}</span>
        <textarea id="cfgTexto" class="ta" style="min-height:96px;font-family:inherit;font-size:14px">${CFG.msgs[msg]}</textarea>
        <div class="pills">${MSG_VARS.map(([k, l]) => `<button class="pill" style="height:30px;font-size:12px" data-cfg-var="${k}">${l}</button>`).join('')}</div></div>
      <div><div class="lbl" style="margin-bottom:6px">Como o cliente recebe</div><div class="bolha" id="cfgPrev">${msgExemplo(CFG.msgs[msg])}</div></div>
      <div class="row" style="gap:8px;justify-content:flex-end;flex-wrap:wrap"><button class="btn b-out" data-cfg-teste>${ic('send', 'i-sm')}Mandar teste pra mim</button><button class="btn b-pri" data-cfg-salvar>${ic('check', 'i-sm')}Salvar mensagens</button></div>
    </div>
    <div class="card list">
      <div class="li"><span class="mid"><span class="t" style="display:block">Diárias: cobrança todo dia</span><span class="s" style="display:block">Quem tem diária recebe o lembrete diário, menos domingo</span></span>${sw(CFG.diarias, 'data-cfg-tg="diarias"')}</div>
      <div class="li"><span class="mid"><span class="t" style="display:block">Resumo do dia pra você</span><span class="s" style="display:block">Quanto vence hoje, quem atrasou e quanto entrou ontem</span></span>${sw(CFG.resumoDia, 'data-cfg-tg="resumoDia"')}</div>
    </div>
    <div class="card pad" style="display:flex;flex-direction:column;gap:12px">
      <div><div class="val">Bot do WhatsApp</div><div class="small">Esses números podem perguntar "quem paga hoje?", dar baixa e cadastrar cliente mandando mensagem pro WhatsApp da loja.</div></div>
      <div class="list" style="border-top:1px solid var(--border)">${CFG.bot.map((n) => `<div class="li" style="padding:9px 0"><span class="ini" style="width:32px;height:32px;font-size:11px">${iniciais(n.nome)}</span><span class="mid"><span class="t" style="display:block">${n.nome}</span><span class="s" style="display:block">${n.fone}</span></span><button class="btn b-ghost b-sm" data-bot-del="${n.id}">Tirar</button></div>`).join('')}</div>
      <div class="row" style="gap:8px;flex-wrap:wrap"><div class="inp" style="flex:1;min-width:130px;height:38px"><input id="botNome" placeholder="Nome" style="font-size:14px"></div><div class="inp" style="flex:1;min-width:130px;height:38px"><input id="botFone" inputmode="tel" placeholder="WhatsApp" style="font-size:14px"></div><button class="btn b-pri" data-bot-add>${ic('plus', 'i-sm')}Liberar</button></div>
    </div>`
}

// ----- Renegociar: mudar vencimento ou reparcelar o saldo -----
function folhaReneg(id) {
  const o = opById(id), emp = o.tipo === 'EMP', abertas = o.parcelas.filter((p) => !p.pago)
  const modo = S.rg?.modo || 'venc'
  if (!S.rg || S.rg.id !== id) S.rg = { id, modo, n: abertas[0]?.n, data: abertas[0] ? addDia(abertas[0].venc, 7) : HOJE, empurrar: false, qtd: Math.min(6, Math.max(1, abertas.length)), acresc: '0', primeira: somaMes(HOJE, 1, Number(abertas[0]?.venc.slice(8)) || 10) }
  const r = S.rg
  const head = `<h3>${emp ? 'Acordo' : 'Renegociar'} · ${cliente(o.clienteId).nome}</h3><div class="small">${nomeItem(o)} · ${abertas.length} ${abertas.length === 1 ? 'parcela aberta' : 'parcelas abertas'}</div>
    <span class="seg" style="margin-top:12px"><button class="${r.modo === 'venc' ? 'on' : ''}" data-rg-modo="venc">Mudar vencimento</button><button class="${r.modo === 'repar' ? 'on' : ''}" data-rg-modo="repar">${emp ? 'Fazer acordo' : 'Reparcelar o saldo'}</button></span>`
  if (r.modo === 'venc') {
    const p = o.parcelas.find((x) => x.n === r.n)
    return `${head}<div style="display:flex;flex-direction:column;gap:12px;margin-top:14px">
      <div class="field"><label>Qual parcela</label><div class="pills">${abertas.slice(0, 12).map((x) => `<button class="pill ${x.n === r.n ? 'on' : ''}" data-rg-n="${x.n}">${x.n}ª · ${dmy(x.venc)}</button>`).join('')}</div></div>
      <div class="field"><label>Nova data</label><div class="inp" style="max-width:220px"><input type="date" id="rgData" value="${r.data}" style="font-size:14px"></div>${p.vencOriginal ? `<div class="small">Vencimento original: ${dmy(p.vencOriginal)}</div>` : ''}</div>
      <button class="opt ${r.empurrar ? 'on' : ''}" data-rg-empurrar><span class="radio"></span><span><span class="val" style="display:block">Empurrar as próximas também</span><span class="small">As parcelas seguintes andam o mesmo número de dias.</span></span></button>
      <div class="small">Quem não for admin precisa de aprovação para mudar vencimento.</div>
      <button class="btn b-pri b-block" data-rg-salvar>Mudar vencimento</button></div>`
  }
  const saldo = abertas.reduce((s, x) => s + faltaP(x), 0), acresc = Number(String(r.acresc).replace(/\./g, '').replace(',', '.')) || 0
  const novo = Math.round((saldo + acresc) / r.qtd * 100) / 100
  return `${head}<div style="display:flex;flex-direction:column;gap:12px;margin-top:14px">
    <div class="dl"><div><div class="lbl">Saldo em aberto</div><div class="val num">${fmt(saldo)}</div></div><div><div class="lbl">Já pagou</div><div class="val num">${fmt(contasOp(o).recebido)}</div></div></div>
    <div class="field"><label>Acréscimo do acordo (juros, multa)</label><div class="inp" style="max-width:220px"><span>R$</span><input id="rgAcresc" inputmode="decimal" value="${r.acresc}" style="font-size:14px"></div></div>
    <div class="field"><label>Em quantas vezes</label><div class="pills">${[1, 2, 3, 4, 6, 8, 10, 12].map((q) => `<button class="pill ${q === r.qtd ? 'on' : ''}" data-rg-qtd="${q}">${q}x</button>`).join('')}</div></div>
    <div class="field"><label>Primeira parcela</label><div class="inp" style="max-width:220px"><input type="date" id="rgPrim" value="${r.primeira}" style="font-size:14px"></div></div>
    <div class="card pad" style="background:var(--primary-soft);border-color:transparent"><div class="between"><span class="small" style="color:var(--strong)">Novo plano</span><b class="num" id="rgPrev" style="color:var(--primary);font-size:16px">${r.qtd}x de ${fmt(novo)}</b></div><div class="small" id="rgPrev2">As ${abertas.length} parcelas abertas viram ${r.qtd} novas, a partir de ${dmy(r.primeira)}. Total ${fmt(saldo + acresc)}.</div></div>
    <button class="btn b-pri b-block" data-rg-salvar>${emp ? 'Fechar acordo' : 'Reparcelar'}</button></div>`
}
function rgPreview() {
  const o = opById(S.rg.id), abertas = o.parcelas.filter((p) => !p.pago), saldo = abertas.reduce((s, x) => s + faltaP(x), 0)
  const acresc = Number(String(S.rg.acresc).replace(/\./g, '').replace(',', '.')) || 0
  const a = document.getElementById('rgPrev'), b = document.getElementById('rgPrev2')
  if (a) a.textContent = `${S.rg.qtd}x de ${fmt(Math.round((saldo + acresc) / S.rg.qtd * 100) / 100)}`
  if (b) b.textContent = `As ${abertas.length} parcelas abertas viram ${S.rg.qtd} novas, a partir de ${dmy(S.rg.primeira)}. Total ${fmt(saldo + acresc)}.`
}
function salvarReneg() {
  const r = S.rg, o = opById(r.id)
  if (r.modo === 'venc') {
    const p = o.parcelas.find((x) => x.n === r.n), dias = diasEntre(p.venc, r.data), antes = p.venc
    for (const x of o.parcelas.filter((x) => !x.pago && (x.n === r.n || (r.empurrar && x.n > r.n)))) { x.vencOriginal ||= x.venc; x.venc = addDia(x.venc, dias) }
    S.rg = null; abrir(o.tipo === 'EMP' ? 'emprestimo' : 'venda', o.id); render()
    toast(`${p.n}ª parcela passou de ${dmy(antes)} para ${dmy(p.venc)}${r.empurrar ? ', e as próximas junto' : ''}`); return
  }
  const abertas = o.parcelas.filter((p) => !p.pago), saldo = abertas.reduce((s, x) => s + faltaP(x), 0)
  const acresc = Number(String(r.acresc).replace(/\./g, '').replace(',', '.')) || 0, valor = Math.round((saldo + acresc) / r.qtd * 100) / 100
  // parcela com pagamento parcial fecha no que já pagou; as outras abertas saem e entram as novas
  for (const p of abertas) if (pagoP(p) > 0) { p.valor = pagoP(p); p.desconto = 0; p.pago = p.pagos.at(-1).data }
  o.parcelas = o.parcelas.filter((p) => p.pago)
  const base = o.parcelas.length, dia = Number(r.primeira.slice(8))
  for (let i = 0; i < r.qtd; i++) o.parcelas.push({ n: base + i + 1, venc: i ? somaMes(r.primeira, i, dia) : r.primeira, valor, pago: null, pagos: [], desconto: 0 })
  ;(o.ajustes ||= []).push({ data: HOJE, tipo: o.tipo === 'EMP' ? 'ACORDO' : 'REPARCELAMENTO', de: abertas.length, para: r.qtd, acresc })
  S.rg = null; abrir(o.tipo === 'EMP' ? 'emprestimo' : 'venda', o.id); render()
  toast(`${o.tipo === 'EMP' ? 'Acordo fechado' : 'Reparcelado'}: ${r.qtd}x de ${fmt(valor)}`)
}

function cliquesExtra(t, d) {
  if (d.cronDia) { S.cronDia = d.cronDia; render(); return true }
  if (d.cronMes != null) { const n = Number(d.cronMes); S.cronMes = n === 0 ? HOJE.slice(0, 7) : somaYm(S.cronMes || HOJE.slice(0, 7), n); S.cronDia = null; render(); return true }
  if (d.indicador) { abrir('indicador', Number(d.indicador)); return true }
  if (d.indPct) { const [id, v] = d.indPct.split(':'); parceiros.find((p) => p.id === Number(id)).pct = Number(v); renderCamada(); toast('Novo % vale para as próximas operações'); return true }
  if (d.indExtrato) { const p = parceiros.find((x) => x.id === Number(d.indExtrato)); toast(`Extrato enviado para ${p.fone || p.nome}`); return true }
  if (d.niPct) { S.niPct = Number(d.niPct); renderCamada(); return true }
  if ('niSalvar' in d) { const nome = document.getElementById('iNome').value.trim(); if (!nome) return true; parceiros.push({ id: ++seq, nome, pct: S.niPct ?? 0.3, fone: document.getElementById('iFone').value.trim(), pix: document.getElementById('iPix').value.trim() }); S.folha = null; render(); toast(`${nome} cadastrado como indicador`); return true }
  if (d.relaba) { S.relAba = d.relaba; render(); return true }
  if (d.cfgWa) { CFG.waOn = d.cfgWa === '1'; render(); if (CFG.waOn) toast('WhatsApp conectado'); return true }
  if (d.cfgTg) { CFG[d.cfgTg] = !CFG[d.cfgTg]; render(); return true }
  if (d.cfgRegra) { CFG.regras[d.cfgRegra] = !CFG.regras[d.cfgRegra]; render(); return true }
  if (d.cfgHora) { CFG.hora = d.cfgHora; render(); return true }
  if (d.cfgMsg) { guardarMsg(); S.cfgMsg = d.cfgMsg; render(); return true }
  if (d.cfgVar) { const ta = document.getElementById('cfgTexto'); const a = ta.selectionStart ?? ta.value.length, b = ta.selectionEnd ?? a, ins = `{${d.cfgVar}}`; ta.value = ta.value.slice(0, a) + ins + ta.value.slice(b); ta.focus(); ta.setSelectionRange(a + ins.length, a + ins.length); guardarMsg(); return true }
  if ('cfgSalvar' in d) { guardarMsg(); toast('Mensagens salvas'); return true }
  if ('cfgTeste' in d) { guardarMsg(); toast(`Teste enviado para ${CFG.waFone}`); return true }
  if (d.botDel) { CFG.bot = CFG.bot.filter((n) => n.id !== Number(d.botDel)); render(); return true }
  if ('botAdd' in d) { const nome = document.getElementById('botNome').value.trim(), fone = document.getElementById('botFone').value.trim(); if (!nome || !fone) return true; CFG.bot.push({ id: ++seq, nome, fone }); render(); toast(`${nome} pode usar o bot`); return true }
  if (d.reneg) { S.rg = null; abrir('reneg', Number(d.reneg)); return true }
  if (d.rgModo) { S.rg.modo = d.rgModo; renderCamada(); return true }
  if (d.rgN) { const o = opById(S.rg.id), p = o.parcelas.find((x) => x.n === Number(d.rgN)); S.rg.n = p.n; S.rg.data = addDia(p.venc, 7); renderCamada(); return true }
  if ('rgEmpurrar' in d) { S.rg.empurrar = !S.rg.empurrar; renderCamada(); return true }
  if (d.rgQtd) { S.rg.qtd = Number(d.rgQtd); renderCamada(); return true }
  if ('rgSalvar' in d) { salvarReneg(); return true }
  return false
}
function guardarMsg() { const ta = document.getElementById('cfgTexto'); if (ta) CFG.msgs[S.cfgMsg || 'antes'] = ta.value; const p = document.getElementById('cfgPix'); if (p) CFG.pix = p.value; const pv = document.getElementById('cfgPrev'); if (pv && ta) pv.textContent = msgExemplo(ta.value) }
function inputsExtra(t) {
  if (t.id === 'cfgTexto' || t.id === 'cfgPix') { guardarMsg(); return true }
  if (t.id === 'rgData') { if (t.value) S.rg.data = t.value; return true }
  if (t.id === 'rgPrim') { if (t.value) S.rg.primeira = t.value; rgPreview(); return true }
  if (t.id === 'rgAcresc') { S.rg.acresc = t.value; rgPreview(); return true }
  return false
}
