// ----- Controle de repasses: capital volta primeiro, depois o indicador leva o % dele do lucro -----
// Pagamentos são por indicador; aqui eles abatem as operações em ordem de data, pra mostrar o que falta em cada uma.
function repassesDoIndicador(pid) {
  const ops = [...vendas, ...emprestimos].filter((o) => o.parceiroId === pid).sort((a, b) => a.data.localeCompare(b.data))
  let pago = repassesPagos.filter((r) => r.parceiroId === pid).reduce((s, r) => s + r.valor, 0)
  const linhas = ops.map((o) => {
    const k = contasOp(o), pc = pctOp(o)
    const liberado = Math.max(0, k.recebido - k.inv), parte = Math.round(liberado * pc * 100) / 100
    const usado = Math.min(parte, pago); pago -= usado
    return { o, k, pc, liberado, parte, pago: usado, aPagar: Math.round((parte - usado) * 100) / 100, parteTotal: Math.max(0, k.lucroTotal) * pc, volta: voltaDoCapital(o, k) }
  })
  return { linhas, aPagar: linhas.reduce((s, l) => s + l.aPagar, 0), sobra: Math.max(0, pago) }
}
// em qual parcela o capital termina de voltar (pelo plano), e quanto cada parcela libera depois disso
function voltaDoCapital(o, k) {
  let acum = o.tipo === 'EMP' ? 0 : o.entrada + o.troca
  if (acum >= k.inv) return { jaVoltou: true }
  for (const p of o.parcelas) { acum += p.valor; if (acum >= k.inv) return { jaVoltou: k.capitalDeVolta >= k.inv, n: p.n, venc: p.venc, de: o.parcelas.length } }
  return { nunca: true }
}
function previsaoRepasse(pid, meses) {
  const m = Object.fromEntries(meses.map((k) => [k, 0]))
  for (const o of [...vendas, ...emprestimos].filter((x) => x.parceiroId === pid)) {
    const k = contasOp(o), pc = pctOp(o)
    let acum = k.recebido
    for (const p of o.parcelas.filter((x) => !x.pago).sort((a, b) => a.venc.localeCompare(b.venc))) {
      const antes = acum; acum += faltaP(p)
      const lucro = Math.max(0, acum - Math.max(antes, k.inv)), ym = (p.venc < HOJE ? HOJE : p.venc).slice(0, 7)
      if (lucro > 0 && ym in m) m[ym] += lucro * pc
    }
  }
  return m
}
function telaRepasses() {
  const ps = parceiros.filter((p) => p.id), meses = mesesJanela(0, 2)
  const info = ps.map((p) => ({ p, r: repassesDoIndicador(p.id), prev: previsaoRepasse(p.id, meses) }))
  const pagoMes = repassesPagos.filter((r) => r.data.slice(0, 7) === HOJE.slice(0, 7)).reduce((s, r) => s + r.valor, 0)
  const f = S.repF || 'APAGAR'
  const mostrar = info.filter(({ r }) => f === 'TODOS' || r.aPagar > 0)
  return `<div class="resumo3">
      <div><div class="lbl">A pagar agora</div><div class="val num" style="color:var(--warn)">${fmt0(info.reduce((s, i) => s + i.r.aPagar, 0))}</div></div>
      <div><div class="lbl">Pago em ${MES3[Number(HOJE.slice(5, 7)) - 1]}.</div><div class="val num">${fmt0(pagoMes)}</div></div>
      <div><div class="lbl">Vai liberar até ${MES3[Number(meses.at(-1).slice(5, 7)) - 1]}.</div><div class="val num">${fmt0(info.reduce((s, i) => s + Object.values(i.prev).reduce((a, b) => a + b, 0), 0))}</div></div>
    </div>
    <div class="filtros"><span class="seg"><button class="${f === 'APAGAR' ? 'on' : ''}" data-rep-f="APAGAR">Com valor a pagar</button><button class="${f === 'TODOS' ? 'on' : ''}" data-rep-f="TODOS">Todos</button></span></div>
    ${mostrar.length ? mostrar.map(({ p, r, prev }) => `<div class="card">
      <div class="li" style="padding:14px"><span class="ini" style="background:var(--primary-soft);color:var(--primary)">${iniciais(p.nome)}</span>
        <span class="mid"><span class="t" style="display:block;font-weight:600;color:var(--strong)">${p.nome}</span><span class="s" style="display:block">${Math.round(p.pct * 100)}% do lucro${p.pix ? ` · Pix ${p.pix}` : ''}</span></span>
        <span style="text-align:right"><span class="lbl" style="display:block">A pagar</span><b class="num" style="font-size:17px;color:${r.aPagar ? 'var(--warn)' : 'var(--dim)'}">${fmt(r.aPagar)}</b></span></div>
      <div class="list" style="border-top:1px solid var(--border)">${r.linhas.map((l) => `<button class="li" data-venda="${l.o.id}" style="align-items:flex-start">
        <span class="mid"><span class="t" style="display:block">${cliente(l.o.clienteId).nome} <span class="small">· ${nomeItem(l.o)}</span></span>
          <span class="s" style="display:block;white-space:normal">Investido ${fmt0(l.k.inv)} · recebido ${fmt0(l.k.recebido)}${l.pc !== p.pct ? ` · ${Math.round(l.pc * 100)}% nesta` : ''}</span>
          <span class="bar" style="margin-top:6px;display:block"><i style="width:${Math.min(100, Math.round(l.k.capitalDeVolta / l.k.inv * 100))}%"></i></span>
          <span class="s" style="display:block;margin-top:4px;white-space:normal">${l.volta.jaVoltou ? `Capital já voltou · lucro liberado ${fmt0(l.liberado)}, parte dele ${fmt0(l.parte)}` : l.volta.n ? `Capital ${Math.round(l.k.capitalDeVolta / l.k.inv * 100)}% de volta · termina na ${l.volta.n}ª parcela (${dmy(l.volta.venc)})` : 'Esta operação não cobre o capital'}</span></span>
        <span style="text-align:right;white-space:nowrap">${l.aPagar ? `<b class="num" style="color:var(--warn)">${fmt0(l.aPagar)}</b><span class="small" style="display:block">a pagar</span>` : l.parte ? `<span class="chip c-ok">pago</span>` : `<span class="small">${fmt0(l.parteTotal)} no fim</span>`}</span>
      </button>`).join('')}</div>
      <div class="totbar" style="border-top:1px solid var(--border);border-bottom:0;flex-wrap:wrap;gap:10px"><span class="small">Vai liberar: ${meses.map((k) => `${mesCurto(k)} <b class="num" style="color:var(--strong)">${fmt0(prev[k])}</b>`).join(' · ')}</span>
        <span class="row" style="gap:8px"><button class="btn b-out b-sm" data-ind-extrato="${p.id}">${ic('message-circle', 'i-sm')}Extrato</button>${r.aPagar ? `<button class="btn b-pri b-sm" data-repasse="${p.id}">${ic('send', 'i-sm')}Pagar</button>` : ''}</span></div>
    </div>`).join('') : '<div class="card empty">Nenhum repasse a pagar agora.</div>'}
    <p class="small" style="margin:0">Regra: cada parcela primeiro devolve o seu capital. O que passa disso é lucro, e o indicador leva o % dele. O % fica guardado em cada operação.</p>`
}
function telaRepHistorico() {
  const lista = repassesPagos.slice().sort((a, b) => b.data.localeCompare(a.data))
  return `<div class="card list">${lista.map((r) => `<div class="li"><span class="wa" style="width:32px;height:32px;background:var(--warn-soft);color:var(--warn)">${ic('send', 'i-sm')}</span>
      <span class="mid"><span class="t" style="display:block">${parceiro(r.parceiroId).nome}</span><span class="s" style="display:block">${dmyA(r.data)} · ${r.forma || 'Pix'}${r.obs ? ` · ${r.obs}` : ''}</span></span>
      <b class="num">${fmt(r.valor)}</b><button class="btn b-ghost b-sm" data-rep-desfazer="${repassesPagos.indexOf(r)}">Desfazer</button></div>`).join('') || '<div class="empty">Nenhum repasse pago ainda.</div>'}</div>`
}
function folhaPagarRepasse(pid) {
  const p = parceiro(pid), r = repassesDoIndicador(pid)
  if (!S.pr || S.pr.pid !== pid) S.pr = { pid, valor: r.aPagar, data: HOJE, forma: 'Pix', wa: true }
  const x = S.pr
  return `<h3>Pagar ${p.nome}</h3><div class="small">${Math.round(p.pct * 100)}% do lucro${p.pix ? ` · Pix ${p.pix}` : ''}</div>
    <div style="display:flex;flex-direction:column;gap:12px;margin-top:14px">
      <div class="dl"><div><div class="lbl">Liberado pra ele</div><div class="val num">${fmt(r.linhas.reduce((s, l) => s + l.parte, 0))}</div></div><div><div class="lbl">A pagar agora</div><div class="val num" style="color:var(--warn)">${fmt(r.aPagar)}</div></div></div>
      <div class="field"><label>Quanto você está pagando</label><div class="inp"><span>R$</span><input id="prValor" class="money" inputmode="numeric" value="${moneyBR(x.valor)}"></div><div class="small">Pode pagar uma parte. O resto continua a pagar.</div></div>
      <div class="field"><label>Data</label><div class="inp" style="max-width:220px"><input type="date" id="prData" value="${x.data}" max="${HOJE}" style="font-size:14px"></div></div>
      <div class="field"><label>Como</label><div class="pills">${['Pix', 'Dinheiro', 'Transferência'].map((fm) => `<button class="pill ${x.forma === fm ? 'on' : ''}" data-pr-forma="${fm}">${fm}</button>`).join('')}</div></div>
      <button class="opt ${x.wa ? 'on' : ''}" data-pr-wa><span class="radio"></span><span><span class="val" style="display:block">Mandar o extrato no WhatsApp dele</span><span class="small">Com cada operação, quanto liberou e quanto foi pago.</span></span></button>
      <button class="btn b-pri b-block" data-pr-salvar>${ic('check', 'i-sm')}Registrar repasse</button></div>`
}
function cliquesRepasses(t, d) {
  if (d.repF) { S.repF = d.repF; render(); return true }
  if (d.indaba) { S.indAba = d.indaba; render(); return true }
  if (d.repasse) { S.pr = null; abrir('pagarRepasse', Number(d.repasse)); return true }
  if (d.prForma) { S.pr.forma = d.prForma; renderCamada(); return true }
  if ('prWa' in d) { S.pr.wa = !S.pr.wa; renderCamada(); return true }
  if ('prSalvar' in d) {
    const x = S.pr, v = Math.round(numBR(x.valor) * 100) / 100; if (!(v > 0)) return true
    const p = parceiro(x.pid); repassesPagos.push({ parceiroId: x.pid, data: x.data, valor: v, forma: x.forma })
    S.pr = null; S.folha = null; render(); toast(`Repasse de ${fmt(v)} para ${p.nome} registrado${x.wa ? ' · extrato enviado' : ''}`); return true
  }
  if (d.repDesfazer) { const r = repassesPagos.splice(Number(d.repDesfazer), 1)[0]; render(); toast(`Repasse de ${fmt(r.valor)} desfeito`); return true }
  return false
}
function inputsRepasses(t) {
  if (t.id === 'prValor') { S.pr.valor = t.value; return true }
  if (t.id === 'prData') { if (t.value) S.pr.data = t.value; return true }
  return false
}
