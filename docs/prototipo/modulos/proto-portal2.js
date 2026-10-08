// ----- área do indicador: Clientes, Cobrança e Repasse (só olhar; baixa é só com a gente) -----
function cobrancasDoIndicador(pid) { return cobrancas().filter((x) => x.v.parceiroId === pid) }
function pClientes(D) {
  const meus = leads.filter((l) => l.pid === D.p.id)
  const porCli = {}
  for (const l of D.r.linhas) (porCli[l.o.clienteId] ||= []).push(l)
  const f = S.pCliF || 'TODOS'
  const lista = Object.entries(porCli).map(([cid, ls]) => ({ c: cliente(Number(cid)), ls, atr: ls.reduce((s, l) => s + l.k.atrasadas.length, 0), ativa: ls.some((l) => l.k.status === 'ATIVA') }))
    .filter((x) => f === 'TODOS' || (f === 'ATRASO' ? x.atr : x.ativa && !x.atr)).sort((a, b) => b.atr - a.atr || a.c.nome.localeCompare(b.c.nome))
  return `${meus.length ? `<div class="card list"><div class="totbar"><b style="color:var(--strong)">Indicações esperando</b><span class="small">${meus.length}</span></div>${meus.map((l) => `<div class="li"><span class="ini">${iniciais(l.nome)}</span><span class="mid"><span class="t" style="display:block">${l.nome}</span><span class="s" style="display:block">${l.quer} · enviada ${dmy(l.data)}</span></span><span class="chip c-warn">em análise</span></div>`).join('')}</div>` : ''}
    <div class="filtros"><span class="seg">${[['TODOS', 'Todos'], ['ATRASO', 'Atrasados'], ['EMDIA', 'Em dia']].map(([v, l]) => `<button class="${f === v ? 'on' : ''}" data-pcli-f="${v}">${l}</button>`).join('')}</span></div>
    <div class="card list">${lista.map(({ c, ls, atr }) => `<button class="li" data-pcli="${c.id}"><span class="ini" style="${atr ? 'background:var(--bad-soft);color:var(--bad)' : ''}">${iniciais(c.nome)}</span>
      <span class="mid"><span class="t" style="display:block">${c.nome}</span><span class="s" style="display:block;white-space:normal">${ls.map((l) => nomeItem(l.o)).join(' + ')} · ${atr ? `<b style="color:var(--bad)">${atr} parcela${atr > 1 ? 's' : ''} atrasada${atr > 1 ? 's' : ''}</b>` : ls.every((l) => l.k.status === 'QUITADA') ? 'quitado' : 'pagando em dia'}</span></span>
      <span style="text-align:right;white-space:nowrap"><span class="lbl" style="display:block">Sua parte</span><b class="num">${fmt0(ls.reduce((s, l) => s + l.parteTotal, 0))}</b></span>${ic('chevron-right', 'i-sm')}</button>`).join('') || '<div class="empty">Ninguém aqui.</div>'}</div>`
}
function folhaPCliente(cid) {
  const pid = S.portalPid, c = cliente(cid), ops = opsDoIndicador(pid).filter((o) => o.clienteId === cid), D = repassesDoIndicador(pid)
  return `<div class="row" style="gap:12px"><span class="ini">${iniciais(c.nome)}</span><div style="flex:1;min-width:0"><h3>${c.nome}</h3><div class="small">${c.fone} · cliente desde ${dmyA(c.desde)}</div></div></div>
    ${ops.map((o) => {
      const k = contasOp(o), l = D.linhas.find((x) => x.o.id === o.id), cap = Math.min(100, Math.round(k.capitalDeVolta / k.inv * 100))
      const tl = o.parcelas.map((p) => `<i class="${p.pago ? 'p' : p.venc < HOJE ? 'a' : diasEntre(HOJE, p.venc) <= 7 ? 'h' : ''}" title="${p.n}ª · ${dmy(p.venc)}">${p.n}</i>`).join('')
      const abertas = o.parcelas.filter((p) => !p.pago).slice(0, 4)
      return `<div class="card pad" style="margin-top:14px;display:flex;flex-direction:column;gap:12px">
        <div class="between"><b style="color:var(--strong)">${nomeItem(o)}</b><span class="small">desde ${dmy(o.data)}</span></div>
        <div class="dl" style="grid-template-columns:repeat(3,minmax(0,1fr))"><div><div class="lbl">Já pagou</div><div class="val num">${fmt0(k.recebido)}</div></div><div><div class="lbl">Falta</div><div class="val num">${fmt0(k.falta)}</div></div><div><div class="lbl">Sua parte</div><div class="val num" style="color:var(--ok)">${fmt0(l.parteTotal)}</div></div></div>
        <div><div class="between small"><span>${l.volta.jaVoltou ? 'Sua parte já está liberando' : `Até sua parte começar: ${cap}%`}</span><span class="num">${fmt0(l.parte)} liberado</span></div><div class="bar" style="margin-top:5px"><i style="width:${cap}%"></i></div></div>
        <div><div class="lbl" style="margin-bottom:6px">Parcelas</div><div class="timeline">${tl}</div><div class="small" style="margin-top:6px">Verde pago · vermelho atrasado · laranja vence esta semana</div></div>
        ${abertas.length ? `<div class="list" style="border-top:1px solid var(--border)">${abertas.map((p) => `<div class="li" style="padding:8px 0"><span class="mid"><span class="t" style="display:block">${p.n}ª parcela · ${fmt(faltaP(p))}</span><span class="s" style="display:block">${p.venc < HOJE ? `<b style="color:var(--bad)">venceu ${dmy(p.venc)} · ${diasEntre(p.venc, HOJE)} dias</b>` : `vence ${dmy(p.venc)}`}</span></span>${p.venc <= HOJE ? `<button class="wa" data-wa="${o.id}:${p.n}" aria-label="Chamar no WhatsApp">${ic('message-circle', 'i-sm')}</button>` : ''}</div>`).join('')}</div>` : ''}
      </div>`
    }).join('')}
    <div class="small" style="margin-top:12px">Pagamento só é dado como recebido pela loja. Se o cliente disser que pagou, peça o comprovante e mande pro Geovane.</div>`
}
function pCobranca(D) {
  const todas = cobrancasDoIndicador(D.p.id), abertas = todas.filter((x) => !x.p.pago)
  const G = {
    atrasadas: abertas.filter((x) => x.p.venc < HOJE).sort((a, b) => a.p.venc.localeCompare(b.p.venc)),
    semana: abertas.filter((x) => x.p.venc >= HOJE && diasEntre(HOJE, x.p.venc) <= 7).sort((a, b) => a.p.venc.localeCompare(b.p.venc)),
    proximas: abertas.filter((x) => diasEntre(HOJE, x.p.venc) > 7 && diasEntre(HOJE, x.p.venc) <= 45).sort((a, b) => a.p.venc.localeCompare(b.p.venc)),
    pagas: todas.filter((x) => x.p.pagos.some((g) => g.data >= '2026-09-08')).sort((a, b) => b.p.pagos.at(-1).data.localeCompare(a.p.pagos.at(-1).data)),
  }
  const aba = S.pCobAba || 'atrasadas', lista = G[aba]
  const total = lista.reduce((s, x) => s + (aba === 'pagas' ? pagoP(x.p) : faltaP(x.p)), 0)
  return `<div class="filtros"><span class="seg">${[['atrasadas', 'Atrasadas'], ['semana', 'Esta semana'], ['proximas', 'Próximas'], ['pagas', 'Pagas']].map(([v, l]) => `<button class="${aba === v ? 'on' : ''}" data-pcob="${v}">${l}${G[v].length && v !== 'pagas' ? ` · ${G[v].length}` : ''}</button>`).join('')}</span></div>
    <div class="card"><div class="totbar"><span class="small">${lista.length} ${lista.length === 1 ? 'parcela' : 'parcelas'}</span><b class="num" style="color:${aba === 'atrasadas' ? 'var(--bad)' : aba === 'pagas' ? 'var(--ok)' : 'var(--strong)'}">${fmt(total)}</b></div>
    <div class="list">${lista.map((x) => { const atr = !x.p.pago && x.p.venc < HOJE ? diasEntre(x.p.venc, HOJE) : 0; return `<div class="li"><span class="ini">${iniciais(x.c.nome)}</span>
      <button class="mid" style="text-align:left" data-pcli="${x.c.id}"><span class="t" style="display:block">${x.c.nome}</span><span class="s" style="display:block">${aba === 'pagas' ? `pagou ${fmt(pagoP(x.p))} em ${dmy(x.p.pagos.at(-1).data)}` : `<b style="color:var(--strong)">${fmt(faltaP(x.p))}</b> · ${atr ? `<b style="color:var(--bad)">${atr} ${atr === 1 ? 'dia' : 'dias'}</b>` : x.p.venc === HOJE ? '<b style="color:var(--warn)">vence hoje</b>' : `vence ${dmy(x.p.venc)}`}`} · ${nomeItem(x.v)} · ${x.p.n}/${x.v.parcelas.length}</span></button>
      ${aba !== 'pagas' && x.p.venc <= HOJE ? `<button class="wa" data-wa="${x.v.id}:${x.p.n}" aria-label="Chamar no WhatsApp">${ic('message-circle', 'i-sm')}</button>` : ''}</div>` }).join('') || '<div class="empty">Nada aqui.</div>'}</div></div>
    <p class="small" style="margin:0">Aqui você só acompanha. Quem dá baixa nos pagamentos é a loja.</p>`
}
function pRepasse(D) {
  const { r, pagos, meses, prev } = D
  return `<div class="hero" style="gap:6px"><div class="lbl">Liberado e ainda não pago</div><div class="big disp num">${fmt(r.aPagar)}</div><div class="lbl">Já recebeu ${fmt0(r.jaPago)} · vai ganhar ${fmt0(Math.max(0, r.vaiGanhar - r.liberado))} ainda</div></div>
    <div class="card"><div class="totbar"><b style="color:var(--strong)">Por cliente</b><span class="small">sua parte · liberado · pago</span></div>
    <div class="list">${r.linhas.map((l) => `<button class="li" data-pcli="${l.o.clienteId}"><span class="mid"><span class="t" style="display:block">${cliente(l.o.clienteId).nome}</span><span class="s" style="display:block">${nomeItem(l.o)} · ${Math.round(l.pc * 100)}% · ${l.volta.jaVoltou ? 'liberando' : `${Math.min(100, Math.round(l.k.capitalDeVolta / l.k.inv * 100))}% até liberar`}</span></span>
      <span style="text-align:right;white-space:nowrap"><b class="num">${fmt0(l.parteTotal)}</b><span class="small" style="display:block">${fmt0(l.parte)} lib. · ${fmt0(l.pago)} pago</span></span></button>`).join('')}</div></div>
    <div class="card pad"><b style="color:var(--strong)">Vai liberar</b><div class="dl" style="grid-template-columns:repeat(3,minmax(0,1fr));margin-top:10px">${meses.map((k) => `<div><div class="lbl" style="text-transform:capitalize">${MESES[Number(k.slice(5, 7)) - 1]}</div><div class="val num">${fmt0(prev[k])}</div></div>`).join('')}</div></div>
    <div class="sec-t"><h2>Repasses recebidos</h2></div>
    <div class="card list">${pagos.map((x) => `<div class="li"><span class="wa" style="width:32px;height:32px">${ic('arrow-down-left', 'i-sm')}</span><span class="mid"><span class="t" style="display:block">Repasse recebido</span><span class="s" style="display:block">${dmyA(x.data)} · ${x.forma || 'Pix'}</span></span><b class="num" style="color:var(--ok)">+ ${fmt(x.valor)}</b></div>`).join('') || '<div class="empty">Nenhum repasse recebido ainda.</div>'}</div>`
}
function cliquesPortal2(t, d) {
  if (d.pcliF) { S.pCliF = d.pcliF; render(); return true }
  if (d.pcli) { abrir('pCliente', Number(d.pcli)); return true }
  if (d.pcob) { S.pCobAba = d.pcob; render(); return true }
  return false
}
