// ----- área da equipe: cobrador e vendedor (cada um vê só o que é dele) -----
function eu() { return usuarios.find((u) => u.id === S.eqUid) }
function ehEquipe() { return S.modo === 'equipe' }
function ehVendedor() { return ehEquipe() && eu()?.perfil === 'VENDEDOR' }
function ehCobrador() { return ehEquipe() && eu()?.perfil === 'COBRADOR' }
function quemRecebe() { return typeof S !== 'undefined' && ehEquipe() ? S.eqUid : 1 }
const nomeUsuario = (id) => (usuarios.find((u) => u.id === id) || usuarios[0]).nome
const carteira = (uid) => clientes.filter((c) => c.resp === uid)
const cobDaCarteira = (uid) => { const ids = new Set(carteira(uid).map((c) => c.id)); return cobrancas().filter((x) => ids.has(x.c.id)) }
const minhasVendas = (uid) => vendas.filter((v) => (v.vendedor ?? cliente(v.clienteId).resp) === uid)
const recebidosHoje = (uid) => cobrancas().flatMap((x) => x.p.pagos.filter((g) => g.data === HOJE && g.por === uid).map((g) => ({ ...x, g })))
const pedidosDe = (uid) => aprovacoes.filter((a) => a.por === uid)
S.fechado = {}
S.pedHist = [{ por: 3, tipo: 'Desconto', texto: 'R$ 20,00 na 4ª parcela da Ana Paula Ribeiro', quando: '02/10', ok: true }]

function entrarEquipe(uid) { S.modo = 'equipe'; S.eqUid = uid; S.eTela = 'inicio'; S.folha = null; S.nv = null; render(); document.querySelector('.main')?.scrollTo(0, 0) }

function equipeShell() {
  const u = eu(), cob = u.perfil === 'COBRADOR', t = S.eTela || 'inicio'
  const NAVE = cob
    ? [['inicio', 'Hoje', 'calendar-days'], ['carteira', 'Carteira', 'users'], ['caixa', 'Meu caixa', 'wallet'], ['pedidos', 'Pedidos', 'send']]
    : [['inicio', 'Início', 'house'], ['estoque', 'Estoque', 'smartphone'], ['carteira', 'Clientes', 'users'], ['vendas', 'Vendas', 'receipt-text']]
  const telas = cob ? { inicio: cHoje, carteira: eCarteira, caixa: cCaixa, pedidos: cPedidos } : { inicio: vInicio, estoque: vEstoque, carteira: eCarteira, vendas: vVendas, vender: telaVender }
  const titulo = { inicio: cob ? 'Hoje' : `Olá, ${u.nome.split(' ')[0]}`, carteira: cob ? 'Minha carteira' : 'Meus clientes', caixa: 'Meu caixa', pedidos: 'Pedidos', estoque: 'Estoque', vendas: 'Minhas vendas', vender: 'Nova venda' }[t]
  const fab = cob ? ['eReceber', 'hand-coins', 'Recebi'] : ['vender', 'plus', 'Vender']
  const nPed = pedidosDe(u.id).length
  const cnt = (id) => (id === 'pedidos' && nPed ? `<span class="cnt" style="background:var(--warn)">${nPed}</span>` : '')
  const banner = `<div class="banner-ind">${ic('user-cog', 'i-sm')}<span>Você está vendo o que <b>${u.nome}</b> (${PERFIS[u.perfil].label.toLowerCase()}) vê quando entra.</span><button class="btn b-sm" data-portal-sair>Voltar pro sistema</button></div>`
  const side = `<aside class="side">
      <div class="marca">${logo()}<span>Mundo dos<br><em>iPhones</em></span></div>
      <div class="me-card"><span class="ini" style="background:var(--primary-soft);color:var(--primary)">${iniciais(u.nome)}</span><div style="min-width:0"><div class="val" style="font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${u.nome}</div><span class="chip ${PERFIS[u.perfil].cor}">${PERFIS[u.perfil].label}</span></div></div>
      <button class="novo" ${cob ? 'data-folha="eReceber"' : 'data-evender'}>${ic(fab[1])}${cob ? 'Registrar recebimento' : 'Nova venda'}</button>
      ${NAVE.map(([id, l, i]) => `<button class="item ${t === id ? 'on' : ''}" data-etela="${id}">${ic(i)}${l}${cnt(id)}</button>`).join('')}
      <div class="rod" style="flex-direction:column;align-items:stretch;gap:4px"><div class="small">${carteira(u.id).length} clientes na carteira</div><div class="small">${cob ? 'Desconto e retomada vão pro Geovane aprovar.' : 'Custo e lucro só o Geovane vê.'}</div></div>
    </aside>`
  const tb = ([id, l, i]) => `<button class="${t === id ? 'on' : ''}" data-etela="${id}">${ic(i, 'icon')}${l.replace('Meu caixa', 'Caixa')}${id === 'pedidos' && nPed ? `<span class="badge-dot" style="background:var(--warn)">${nPed}</span>` : ''}</button>`
  const tabs = `<nav class="tabs">${NAVE.slice(0, 2).map(tb).join('')}<button class="vender ${t === 'vender' ? 'on' : ''}" ${cob ? 'data-folha="eReceber"' : 'data-evender'}><span class="fab">${ic(fab[1])}</span>${fab[2]}</button>${NAVE.slice(2).map(tb).join('')}</nav>`
  return `${side}<div class="main">${banner}<header class="top"><span class="logo-m">${logo(true)}</span><h1>${titulo}</h1><span class="chip ${PERFIS[u.perfil].cor}">${PERFIS[u.perfil].label}</span></header><div class="content">${telas[t]()}</div></div>${tabs}`
}

// linha de cobrança na visão da equipe (sem lucro)
function eCobLinha(x) {
  const atr = !x.p.pago && x.p.venc < HOJE ? diasEntre(x.p.venc, HOJE) : 0
  return `<div class="li"><span class="ini" style="${atr ? 'background:var(--bad-soft);color:var(--bad)' : ''}">${iniciais(x.c.nome)}</span>
    <button class="mid" style="text-align:left" data-ecli="${x.c.id}"><span class="t" style="display:block">${x.c.nome}</span><span class="s" style="display:block;white-space:normal"><b style="color:var(--strong)">${fmt(faltaP(x.p))}</b> · ${atr ? `<b style="color:var(--bad)">${atr} ${atr === 1 ? 'dia' : 'dias'} de atraso</b>` : x.p.venc === HOJE ? '<b style="color:var(--warn)">vence hoje</b>' : `vence ${dmy(x.p.venc)}`} · ${nomeItem(x.v)} ${x.p.n}/${x.v.parcelas.length}</span></button>
    <button class="wa" data-wa="${x.v.id}:${x.p.n}" aria-label="Chamar no WhatsApp">${ic('message-circle', 'i-sm')}</button>
    <button class="btn b-ok b-sm" data-receber="${x.v.id}:${x.p.n}">Recebi</button></div>`
}

// ---------- cobrador ----------
function cHoje() {
  const u = eu(), abertas = cobDaCarteira(u.id).filter((x) => !x.p.pago)
  const atr = abertas.filter((x) => x.p.venc < HOJE).sort((a, b) => a.p.venc.localeCompare(b.p.venc))
  const hoje = abertas.filter((x) => x.p.venc === HOJE)
  const sem = abertas.filter((x) => x.p.venc > HOJE && diasEntre(HOJE, x.p.venc) <= 7).sort((a, b) => a.p.venc.localeCompare(b.p.venc))
  const rec = recebidosHoje(u.id), totRec = rec.reduce((s, x) => s + x.g.valor, 0)
  const meta = [...atr, ...hoje].reduce((s, x) => s + faltaP(x.p), 0)
  const bloco = (titulo, l, cor) => l.length ? `<div class="card"><div class="totbar"><b style="color:${cor}">${titulo} · ${l.length}</b><b class="num" style="color:${cor}">${fmt(l.reduce((s, x) => s + faltaP(x.p), 0))}</b></div><div class="list">${l.map(eCobLinha).join('')}</div></div>` : ''
  return `<div class="hero" style="gap:6px"><div class="lbl">Pra cobrar hoje</div><div class="big disp num">${fmt(meta)}</div><div class="lbl">${new Set([...atr, ...hoje].map((x) => x.c.id)).size} clientes · já recebeu ${fmt(totRec)} hoje</div>
      ${meta ? `<div class="bar" style="margin-top:6px;background:rgba(255,255,255,.18)"><i style="width:${Math.min(100, Math.round(totRec / (meta + totRec) * 100))}%;background:var(--gold)"></i></div>` : ''}</div>
    ${bloco('Atrasadas', atr, 'var(--bad)')}${bloco('Vencem hoje', hoje, 'var(--warn)')}${bloco('Próximos 7 dias', sem, 'var(--strong)')}
    ${!atr.length && !hoje.length && !sem.length ? '<div class="card empty">Ninguém pra cobrar agora.</div>' : ''}
    <p class="small" style="margin:0">Aparecem só os clientes da sua carteira. O que você recebe vai pro seu caixa do dia.</p>`
}
function eCarteira() {
  const u = eu(), f = S.eCartF || 'TODOS'
  const lista = carteira(u.id).map((c) => ({ c, s: situacaoCliente(c) }))
    .filter(({ s }) => f === 'TODOS' || (f === 'ATRASO' ? s.atraso > 0 : s.ativas && !s.atraso))
    .sort((a, b) => b.s.atraso - a.s.atraso || a.c.nome.localeCompare(b.c.nome))
  return `<div class="filtros"><span class="seg">${[['TODOS', 'Todos'], ['ATRASO', 'Atrasados'], ['DIA', 'Em dia']].map(([v, l]) => `<button class="${f === v ? 'on' : ''}" data-ecart-f="${v}">${l}</button>`).join('')}</span></div>
    <div class="card list">${lista.map(({ c, s }) => `<button class="li" data-ecli="${c.id}"><span class="ini" style="${s.atraso ? 'background:var(--bad-soft);color:var(--bad)' : ''}">${iniciais(c.nome)}</span>
      <span class="mid"><span class="t" style="display:block">${c.nome}</span><span class="s" style="display:block">${c.fone} · ${s.atraso ? `<b style="color:var(--bad)">${fmt0(s.atraso)} atrasado</b>` : s.ativas ? 'em dia' : 'sem nada aberto'}</span></span>
      <span style="text-align:right;white-space:nowrap"><span class="lbl" style="display:block">Em aberto</span><b class="num">${fmt0(s.aberto)}</b></span>${ic('chevron-right', 'i-sm')}</button>`).join('') || '<div class="empty">Ninguém aqui.</div>'}</div>`
}
function cCaixa() {
  const u = eu(), rec = recebidosHoje(u.id).sort((a, b) => a.c.nome.localeCompare(b.c.nome))
  const por = (f) => rec.filter((x) => (x.g.forma || 'Pix') === f).reduce((s, x) => s + x.g.valor, 0)
  const din = por('Dinheiro'), pix = por('Pix'), cart = por('Cartão'), fech = S.fechado[u.id]
  return `<div class="resumo3"><div><div class="lbl">Dinheiro na mão</div><div class="val num" style="color:var(--warn)">${fmt0(din)}</div></div><div><div class="lbl">Pix (já na conta)</div><div class="val num">${fmt0(pix)}</div></div><div><div class="lbl">Total hoje</div><div class="val num" style="color:var(--ok)">${fmt0(din + pix + cart)}</div></div></div>
    <div class="card"><div class="totbar"><b style="color:var(--strong)">Recebido hoje · ${dmyA(HOJE)}</b><span class="small">${rec.length} ${rec.length === 1 ? 'pagamento' : 'pagamentos'}</span></div>
      <div class="list">${rec.map((x) => `<div class="li"><span class="ini">${iniciais(x.c.nome)}</span><span class="mid"><span class="t" style="display:block">${x.c.nome}</span><span class="s" style="display:block">${nomeItem(x.v)} ${x.p.n}/${x.v.parcelas.length} · ${x.g.forma || 'Pix'}</span></span><b class="num" style="color:var(--ok)">+ ${fmt(x.g.valor)}</b><button class="btn b-ghost b-sm" data-recibo="${x.v.id}:${x.p.n}:${x.p.pagos.indexOf(x.g)}">Recibo</button></div>`).join('') || '<div class="empty">Nada recebido hoje ainda.</div>'}</div></div>
    ${fech ? `<div class="card pad row" style="gap:10px">${ic('check')}<div><div class="val">Dia fechado e enviado pro Geovane</div><div class="small">${fmt(fech.din)} em dinheiro pra entregar · ${fech.st === 'ok' ? '<b style="color:var(--ok)">conferido</b>' : 'esperando conferência'}</div></div></div>`
      : `<button class="btn b-pri b-block" data-efechar ${rec.length ? '' : 'disabled style="opacity:.5"'}>${ic('check', 'i-sm')}Fechar o dia e entregar ${fmt(din)} em dinheiro</button>`}
    <p class="small" style="margin:0">Quando você fecha o dia, o Geovane confere o dinheiro que você entregou e o Pix que caiu na conta.</p>`
}
function cPedidos() {
  const u = eu(), abertos = pedidosDe(u.id), hist = S.pedHist.filter((h) => h.por === u.id)
  return `<div class="card"><div class="totbar"><b style="color:var(--strong)">Esperando o Geovane</b><span class="small">${abertos.length}</span></div>
      <div class="list">${abertos.map((a) => `<div class="li" style="align-items:flex-start"><span class="chip ${a.tipo === 'Retomada' ? 'c-bad' : 'c-warn'}" style="margin-top:2px">${a.tipo}</span><span class="mid"><span class="t" style="display:block;white-space:normal">${a.texto}</span><span class="s" style="display:block;white-space:normal">${a.quando}${a.motivo ? ` · “${a.motivo}”` : ''}</span></span></div>`).join('') || '<div class="empty">Nenhum pedido aberto.</div>'}</div></div>
    <div class="sec-t"><h2>Respondidos</h2></div>
    <div class="card list">${hist.map((h) => `<div class="li"><span class="chip ${h.ok ? 'c-ok' : 'c-bad'}">${h.ok ? 'aprovado' : 'recusado'}</span><span class="mid"><span class="t" style="display:block;white-space:normal">${h.tipo}: ${h.texto}</span><span class="s" style="display:block">${h.quando}</span></span></div>`).join('') || '<div class="empty">Nada ainda.</div>'}</div>
    <p class="small" style="margin:0">Pra pedir desconto, acordo ou retomada, abra o cliente na carteira.</p>`
}
function folhaEReceber() {
  const u = eu(), abertas = cobDaCarteira(u.id).filter((x) => !x.p.pago && diasEntre(HOJE, x.p.venc) <= 7).sort((a, b) => a.p.venc.localeCompare(b.p.venc))
  return `<h3>Quem pagou?</h3><div class="small">Parcelas da sua carteira vencidas ou que vencem esta semana.</div>
    <div class="card list" style="margin-top:12px">${abertas.map((x) => { const atr = x.p.venc < HOJE ? diasEntre(x.p.venc, HOJE) : 0; return `<button class="li" data-receber="${x.v.id}:${x.p.n}"><span class="ini">${iniciais(x.c.nome)}</span><span class="mid"><span class="t" style="display:block">${x.c.nome}</span><span class="s" style="display:block">${nomeItem(x.v)} ${x.p.n}/${x.v.parcelas.length} · ${atr ? `<b style="color:var(--bad)">${atr} dias</b>` : `vence ${dmy(x.p.venc)}`}</span></span><b class="num">${fmt(faltaP(x.p))}</b>${ic('chevron-right', 'i-sm')}</button>` }).join('') || '<div class="empty">Nada pra receber agora.</div>'}</div>`
}

// ficha do cliente na visão da equipe
function folhaECliente(cid) {
  const c = cliente(cid), cob = ehCobrador()
  const ops = opsDoCliente(cid).filter((o) => o.status !== 'RETOMADA')
  return `<div class="row" style="gap:12px"><span class="ini">${iniciais(c.nome)}</span><div style="flex:1;min-width:0"><h3>${c.nome}</h3><div class="small">${c.fone} · cliente desde ${dmyA(c.desde)}</div></div></div>
    ${ops.map((o) => {
      const k = contasOp(o), abertas = o.parcelas.filter((p) => !p.pago), atrs = abertas.filter((p) => p.venc < HOJE)
      const tl = o.parcelas.map((p) => `<i class="${p.pago ? 'p' : p.venc < HOJE ? 'a' : diasEntre(HOJE, p.venc) <= 7 ? 'h' : ''}">${p.n}</i>`).join('')
      return `<div class="card pad" style="margin-top:14px;display:flex;flex-direction:column;gap:12px">
        <div class="between"><b style="color:var(--strong)">${nomeItem(o)}</b><span class="small">desde ${dmy(o.data)}</span></div>
        <div class="dl" style="grid-template-columns:repeat(3,minmax(0,1fr))"><div><div class="lbl">Já pagou</div><div class="val num">${fmt0(k.recebido)}</div></div><div><div class="lbl">Falta</div><div class="val num">${fmt0(k.falta)}</div></div><div><div class="lbl">Atrasado</div><div class="val num" style="${atrs.length ? 'color:var(--bad)' : ''}">${fmt0(atrs.reduce((s, p) => s + faltaP(p), 0))}</div></div></div>
        <div class="timeline">${tl}</div>
        ${abertas.length ? `<div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn b-ok" style="flex:1" data-receber="${o.id}:${abertas[0].n}">Recebi a ${abertas[0].n}ª · ${fmt0(faltaP(abertas[0]))}</button><button class="wa" style="width:46px;height:38px" data-wa="${o.id}:${abertas[0].n}">${ic('message-circle', 'i-sm')}</button></div>
        ${cob ? `<div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn b-out b-sm" style="flex:1" data-pedir="Desconto:${o.id}">Pedir desconto</button><button class="btn b-out b-sm" style="flex:1" data-pedir="Acordo:${o.id}">Pedir acordo</button>${atrs.length && o.tipo !== 'EMP' ? `<button class="btn b-out b-sm" style="flex:1;color:var(--bad)" data-pedir="Retomada:${o.id}">Pedir retomada</button>` : ''}</div>` : ''}` : '<span class="chip c-ok">quitado</span>'}
      </div>`
    }).join('') || '<div class="card empty" style="margin-top:14px">Nenhuma compra ou empréstimo.</div>'}`
}
function folhaPedido(chave) {
  const [tipo, oid] = chave.split(':'), o = opById(Number(oid)), c = cliente(o.clienteId)
  S.ped ||= { valor: 0 }
  return `<h3>Pedir ${tipo.toLowerCase()}</h3><div class="small">${c.nome} · ${nomeItem(o)}</div>
    <div style="display:flex;flex-direction:column;gap:12px;margin-top:14px">
      ${tipo === 'Desconto' ? `<div class="field"><label>Quanto de desconto</label><div class="inp"><span>R$</span><input id="pedValor" class="money" inputmode="numeric" value="${moneyBR(S.ped.valor)}"></div></div>` : ''}
      ${tipo === 'Acordo' ? `<div class="field"><label>O que o cliente propôs</label><div class="inp"><input id="pedProp" placeholder="Ex.: pagar as 2 atrasadas em 4x" style="font-size:14px"></div></div>` : ''}
      <div class="field"><label>Por quê?</label><div class="inp"><input id="pedMotivo" placeholder="${tipo === 'Retomada' ? 'Ex.: não atende mais' : 'Ex.: perdeu o emprego'}" style="font-size:14px"></div></div>
      <button class="btn b-pri b-block" data-ped-enviar="${chave}">${ic('send', 'i-sm')}Mandar pro Geovane aprovar</button>
      <div class="small">Nada muda no cliente até o Geovane aprovar.</div></div>`
}

// ---------- vendedor ----------
function vInicio() {
  const u = eu(), mv = minhasVendas(u.id), mes = mv.filter((v) => v.data.slice(0, 7) === HOJE.slice(0, 7))
  const espera = mv.filter((v) => v.contrato === 'AGUARDANDO' && v.status !== 'RETOMADA')
  const disp = bens.filter((b) => b.estado === 'DISPONIVEL')
  const atr = cobDaCarteira(u.id).filter((x) => !x.p.pago && x.p.venc < HOJE)
  return `<div class="hero" style="gap:6px"><div class="lbl">Suas vendas em ${MESES[Number(HOJE.slice(5, 7)) - 1]}</div><div class="big disp num">${mes.length} ${mes.length === 1 ? 'venda' : 'vendas'}</div><div class="lbl">${fmt0(mes.reduce((s, v) => s + contas(v).total, 0))} vendidos · ${mv.length} no total</div></div>
    <button class="btn b-pri b-block" data-evender>${ic('plus', 'i-sm')}Nova venda</button>
    ${espera.length ? `<div class="card"><div class="totbar"><b style="color:var(--warn)">Contrato esperando assinatura · ${espera.length}</b></div><div class="list">${espera.map((v) => `<div class="li"><span class="ini">${iniciais(cliente(v.clienteId).nome)}</span><span class="mid"><span class="t" style="display:block">${cliente(v.clienteId).nome}</span><span class="s" style="display:block">${nomeItem(v)} · vendido ${dmy(v.data)}</span></span><button class="btn b-out b-sm" data-ereenviar="${v.id}">${ic('send', 'i-sm')}Reenviar</button></div>`).join('')}</div></div>` : ''}
    <button class="card pad between" data-etela="estoque" style="text-align:left"><span><span class="val" style="display:block">${disp.length} aparelhos disponíveis</span><span class="small">${[...new Set(disp.map((b) => b.modelo.replace('iPhone ', '')))].slice(0, 5).join(' · ')}</span></span>${ic('chevron-right', 'i-sm')}</button>
    ${atr.length ? `<div class="card"><div class="totbar"><b style="color:var(--bad)">Seus clientes com atraso · ${new Set(atr.map((x) => x.c.id)).size}</b></div><div class="list">${atr.slice(0, 4).map(eCobLinha).join('')}</div></div>` : ''}`
}
function vEstoque() {
  const disp = bens.filter((b) => b.estado === 'DISPONIVEL'), q = (S.eBusca || '').trim().toLowerCase()
  const lista = disp.filter((b) => !q || `${b.modelo} ${b.gb} ${b.cor}`.toLowerCase().includes(q))
  return `<div class="busca">${ic('search', 'i-sm')}<input id="eBusca" placeholder="Modelo ou cor" value="${S.eBusca || ''}"></div>
    <div class="fones">${lista.map((b) => `<div class="card fone"><span class="pic">${ic('smartphone')}<span class="cor" style="background:${CORES[b.cor] || '#999'}"></span></span>
      <span class="info"><span class="nome"><span>${b.modelo} · ${b.gb} GB</span></span>
        <span class="specs"><span>${b.cor}</span><span>${b.cond}</span><span>${ic('battery-medium', 'i-sm')}${b.bateria}%</span></span>
        <span class="precos"><b class="num" style="color:var(--strong);font-size:16px">${fmt0(b.preco)}</b><button class="btn b-pri b-sm" data-evender="${b.id}">Vender</button></span></span></div>`).join('') || '<div class="card empty">Nada por aqui.</div>'}</div>
    <p class="small" style="margin:0">Você vê o preço de venda. Custo e lucro ficam só com o Geovane.</p>`
}
function vVendas() {
  const mv = minhasVendas(eu().id).slice().sort((a, b) => b.data.localeCompare(a.data))
  return `<div class="card list">${mv.map((v) => { const k = contas(v); return `<button class="li" data-ecli="${v.clienteId}"><span class="ini" style="${k.atrasadas.length ? 'background:var(--bad-soft);color:var(--bad)' : ''}">${iniciais(cliente(v.clienteId).nome)}</span>
      <span class="mid"><span class="t" style="display:block">${cliente(v.clienteId).nome}</span><span class="s" style="display:block">${nomeItem(v)} · ${dmyA(v.data)} · ${v.parcelas.length}x ${fmt0(v.parcelas[0]?.valor || 0)}</span></span>
      ${v.status === 'RETOMADA' ? '<span class="chip c-neu">retomada</span>' : k.status === 'QUITADA' ? '<span class="chip c-ok">quitada</span>' : k.atrasadas.length ? '<span class="chip c-bad">atraso</span>' : v.contrato === 'AGUARDANDO' ? '<span class="chip c-warn">assinar</span>' : '<span class="chip c-ok">em dia</span>'}</button>` }).join('') || '<div class="empty">Nenhuma venda ainda.</div>'}</div>`
}

// ---------- recibo ----------
function numRecibo(vid, n, i) { return `${String(vid).padStart(3, '0')}${String(n).padStart(2, '0')}${i + 1}` }
function textoRecibo(vid, n, i) {
  const v = opById(vid), p = v.parcelas.find((x) => x.n === n), g = p.pagos[i], c = cliente(v.clienteId), k = contasOp(v)
  const prox = v.parcelas.find((x) => !x.pago), resta = v.parcelas.filter((x) => !x.pago).length
  return { v, p, g, c, k, prox, resta, num: numRecibo(vid, n, i),
    msg: `*${EMPRESA.nome.replace(' LTDA', '')}* · Recibo nº ${numRecibo(vid, n, i)}\n\nOi ${c.nome.split(' ')[0]}! Recebemos ${fmt(g.valor)} em ${dmyA(g.data)} (${g.forma || 'Pix'}), referente à parcela ${p.n}/${v.parcelas.length} do seu ${nomeItem(v)}.${p.pago ? '' : `\nNesta parcela ainda ficam ${fmt(faltaP(p))}.`}\n\n${prox ? `Próxima: ${prox.n}ª, ${fmt(faltaP(prox))}, vence ${dmy(prox.venc)}. Faltam ${resta} ${resta === 1 ? 'parcela' : 'parcelas'} (${fmt(k.falta)}).` : 'Tudo quitado! Obrigado pela confiança.'}\n\nObrigado!` }
}
function folhaRecibo(chave) {
  const [vid, n, i] = chave.split(':').map(Number), R = textoRecibo(vid, n, i)
  return `<div class="between"><h3>Recibo</h3><span class="chip c-ok">${ic('check', 'i-sm')}pago</span></div>
    <div class="recibo">
      <div class="between" style="align-items:flex-start"><div class="row" style="gap:10px">${logo()}<div><b style="color:var(--strong)">${EMPRESA.nome}</b><div class="small">CNPJ ${EMPRESA.cnpj}</div></div></div><div style="text-align:right"><div class="lbl">Recibo nº</div><b class="mono" style="color:var(--strong)">${R.num}</b></div></div>
      <div class="rc-valor"><div class="lbl">Valor recebido</div><div class="disp num" style="font-size:28px;color:var(--strong)">${fmt(R.g.valor)}</div></div>
      <div class="dl">
        <div><div class="lbl">Cliente</div><div class="val">${R.c.nome}</div></div>
        <div><div class="lbl">Referente a</div><div class="val">${nomeItem(R.v)} · ${R.p.n}/${R.v.parcelas.length}</div></div>
        <div><div class="lbl">Data</div><div class="val">${dmyA(R.g.data)}</div></div>
        <div><div class="lbl">Forma</div><div class="val">${R.g.forma || 'Pix'}</div></div>
        <div><div class="lbl">Recebido por</div><div class="val">${nomeUsuario(R.g.por || 1).split(' ')[0]}</div></div>
        <div><div class="lbl">Ainda falta</div><div class="val num">${fmt(R.k.falta)}</div></div>
      </div>
      ${R.prox ? `<div class="small">Próxima parcela: ${R.prox.n}ª de ${fmt(faltaP(R.prox))}, vence ${dmyA(R.prox.venc)}.</div>` : '<div class="small" style="color:var(--ok);font-weight:600">Tudo quitado.</div>'}
    </div>
    <div class="lbl" style="margin:14px 0 6px">Mensagem que vai no WhatsApp</div>
    <div class="msg" id="msgWa">${R.msg}</div>
    <div style="display:flex;gap:8px;margin-top:14px"><button class="btn b-ok" style="flex:1" data-recibo-wa>${ic('message-circle', 'i-sm')}Mandar pro ${R.c.nome.split(' ')[0]}</button><button class="btn b-out" data-copiar>${ic('copy', 'i-sm')}Copiar</button></div>
    <div class="small" style="margin-top:8px;text-align:center">No sistema de verdade sai pelo WhatsApp da loja, já com o recibo em PDF.</div>`
}
// lista de pagamentos dentro da ficha da venda/empréstimo, com o recibo de cada um
function ultimosPag(o) {
  const l = o.parcelas.flatMap((p) => p.pagos.map((g, i) => ({ p, g, i }))).sort((a, b) => b.g.data.localeCompare(a.g.data)).slice(0, 4)
  if (!l.length) return ''
  return `<div style="margin-top:14px"><div class="lbl" style="margin-bottom:4px">Últimos pagamentos</div><div class="list">${l.map(({ p, g, i }) => `<div class="li" style="padding:7px 0"><span class="mid"><span class="t" style="display:block">${p.n}ª parcela · ${fmt(g.valor)}</span><span class="s" style="display:block">${dmyA(g.data)} · ${g.forma || 'Pix'} · ${nomeUsuario(g.por || 1).split(' ')[0]}</span></span><button class="btn b-ghost b-sm" data-recibo="${o.id}:${p.n}:${i}">${ic('receipt-text', 'i-sm')}Recibo</button></div>`).join('')}</div></div>`
}

// ---------- cliques ----------
function cliquesEquipe(t, d) {
  if (d.recibo) { abrir('recibo', d.recibo); return true }
  if ('reciboWa' in d) { S.folha = null; renderCamada(); toast('Recibo enviado no WhatsApp do cliente'); return true }
  if (d.perfil === 'cobrador' || d.verComo === 'cobrador') { entrarEquipe(3); return true }
  if (d.perfil === 'vendedor' || d.verComo === 'vendedor') { entrarEquipe(2); return true }
  if (!ehEquipe()) return false
  if ('portalSair' in d) { S.modo = null; S.folha = null; S.nv = null; render(); return true }
  if (d.etela) { S.eTela = d.etela; S.folha = null; render(); document.querySelector('.main')?.scrollTo(0, 0); return true }
  if ('evender' in d) { S.nv = null; novaVenda(d.evender ? Number(d.evender) : null); S.eTela = 'vender'; S.folha = null; render(); document.querySelector('.main')?.scrollTo(0, 0); return true }
  if (d.ir) { if (d.ir === 'vender') { S.nv = null; novaVenda(null); S.eTela = 'vender' } else S.eTela = 'inicio'; S.folha = null; render(); return true }
  if ('confirmar' in d) { const n0 = vendas.length; queueMicrotask(() => { for (const v of vendas.slice(n0)) { v.vendedor = S.eqUid; cliente(v.clienteId).resp ??= S.eqUid } render() }); return false }
  if (d.ecartF) { S.eCartF = d.ecartF; render(); return true }
  if (d.ecli) { abrir('eCliente', Number(d.ecli)); return true }
  if (d.ereenviar) { toast('Link de assinatura reenviado no WhatsApp do cliente'); return true }
  if (d.pedir) { S.ped = { valor: 0 }; abrir('pedido', d.pedir); return true }
  if (d.pedEnviar) {
    const [tipo, oid] = d.pedEnviar.split(':'), o = opById(Number(oid)), c = cliente(o.clienteId)
    const motivo = document.getElementById('pedMotivo').value.trim(), val = numBR(document.getElementById('pedValor')?.value), prop = document.getElementById('pedProp')?.value.trim()
    if (tipo === 'Desconto' && !(val > 0)) return true
    const p = o.parcelas.find((x) => !x.pago)
    const texto = tipo === 'Desconto' ? `${fmt(val)} de desconto na ${p.n}ª parcela de ${c.nome} (${nomeItem(o)})` : tipo === 'Acordo' ? `Acordo pra ${c.nome} (${nomeItem(o)})${prop ? `: ${prop}` : ''}` : `Retomar o ${nomeItem(o)} de ${c.nome}`
    const acao = tipo === 'Desconto' ? () => { p.desconto += Math.min(val, faltaP(p)); if (faltaP(p) <= 0.009) p.pago = HOJE } : tipo === 'Retomada' ? () => { o.status = 'RETOMADA'; const b = bem(o.bemId); b.estado = 'DISPONIVEL'; b.desde = HOJE; b.origem = 'TROCA' } : null
    aprovacoes.push({ id: ++seq, tipo, por: S.eqUid, quando: 'agora', texto, motivo, acao })
    S.ped = null; S.folha = null; S.eTela = 'pedidos'; render(); toast('Pedido enviado pro Geovane'); return true
  }
  if ('efechar' in d) {
    const u = eu(), rec = recebidosHoje(u.id), din = rec.filter((x) => x.g.forma === 'Dinheiro').reduce((s, x) => s + x.g.valor, 0), tot = rec.reduce((s, x) => s + x.g.valor, 0)
    S.fechado[u.id] = { din, tot, st: 'enviado' }
    aprovacoes.push({ id: ++seq, tipo: 'Fechamento', por: u.id, quando: 'agora', texto: `Fechamento do dia: ${fmt(tot)} recebidos, ${fmt(din)} em dinheiro pra entregar`, motivo: '', acao: () => { S.fechado[u.id].st = 'ok' } })
    render(); toast('Dia fechado. O Geovane vai conferir.'); return true
  }
  return false
}
function inputsEquipe(t) {
  if (t.id === 'eBusca') { S.eBusca = t.value; const pos = t.selectionStart; render(); const el = document.getElementById('eBusca'); el?.focus(); el?.setSelectionRange(pos, pos); return true }
  if (t.id === 'pedValor') { S.ped.valor = t.value; return true }
  return false
}

// pagamento de exemplo de hoje, feito pelo Diego, pra o caixa dele ter algo
{
  const x = cobDaCarteira(3).filter((y) => !y.p.pago && y.p.venc < HOJE).sort((a, b) => a.p.venc.localeCompare(b.p.venc))[0]
  if (x) registrar(x.v, x.p.n, HOJE, faltaP(x.p), 'Dinheiro', 'FICA', 3)
}

// simulação do vendedor: sem custo e sem lucro
function simCardVend(r, nv) {
  const primeiro = somaMes(HOJE, 1, nv.dia)
  return `<div class="lbl">Cliente paga</div>
    <div class="parc disp num">${nv.n}x ${fmt(r.parc)}</div>
    <div class="small">${r.entrada ? `+ ${fmt(r.entrada)} de entrada` : 'sem entrada'}${r.troca ? ` + aparelho na troca (${fmt0(r.troca)})` : ''} · 1ª em ${dmy(primeiro)}</div>
    <div class="linhas" style="margin-top:14px"><div><span>Preço do aparelho</span><span class="num">${fmt(r.preco)}</span></div><div class="tot"><span>Total que o cliente paga</span><b class="num">${fmt(r.total)}</b></div></div>
    ${r.lucro < 0 ? '<div class="chip c-warn" style="margin-top:10px;white-space:normal">Esse preço precisa do OK do Geovane</div>' : ''}
    <button class="btn b-pri b-block" style="margin-top:16px" data-confirmar>${ic('file-signature', 'i-sm')}Fechar venda e enviar contrato</button>`
}
