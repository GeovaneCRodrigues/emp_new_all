// ----- Simulador: X% por parcela sobre o que sobra depois da entrada -----
// 10% e até 10x: em 10x o cliente paga o dobro do que ficou pra parcelar.
const JUROS = { pct: 10, max: 10 }
function planoParc(fin, n) {
  const total = Math.round(fin * (1 + JUROS.pct / 100 * n) * 100) / 100
  return { total, parc: n > 0 ? Math.ceil(total / n * 100) / 100 : 0, juros: total - fin }
}
function simDados() {
  const s = S.sim, b = s.bemId ? bem(s.bemId) : null
  const preco = numBR(s.preco), entrada = Math.min(numBR(s.entrada), preco), fin = Math.max(0, preco - entrada)
  const linhas = Array.from({ length: JUROS.max }, (_, i) => { const n = i + 1, pl = planoParc(fin, n); return { n, ...pl, totalCli: entrada + pl.total, lucro: b ? entrada + pl.total - investido(b) : null } })
  return { s, b, preco, entrada, fin, linhas }
}
function telaSimulador() {
  S.sim ||= { bemId: null, preco: 7500, entrada: 0, n: 10 }
  const s = S.sim, disp = bens.filter((b) => b.estado === 'DISPONIVEL')
  return `<div class="vender-grid"><div style="display:flex;flex-direction:column;gap:14px">
      <div class="field"><label>Aparelho</label><div class="inp"><select id="simBem" style="font-size:15px"><option value="">Digitar o preço</option>${disp.map((b) => `<option value="${b.id}" ${s.bemId === b.id ? 'selected' : ''}>${b.modelo} ${b.gb} GB ${b.cor} · ${fmt0(b.preco)}</option>`).join('')}</select></div></div>
      <div class="grid2">
        <div class="field"><label>Preço de venda</label><div class="inp"><span>R$</span><input id="simPreco" class="money" inputmode="numeric" value="${moneyBR(s.preco)}"></div></div>
        <div class="field"><label>Entrada</label><div class="inp"><span>R$</span><input id="simEntrada" class="money" inputmode="numeric" value="${moneyBR(s.entrada)}"></div></div>
      </div>
      <div class="pills">${[0, 10, 20, 30, 50].map((p) => `<button class="pill" data-sim-ent="${p}">${p ? `Entrada ${p}%` : 'Sem entrada'}</button>`).join('')}</div>
      <div class="card pad small">Regra: <b style="color:var(--strong)">${JUROS.pct}% por parcela</b> sobre o que fica depois da entrada, em até ${JUROS.max}x. Em ${JUROS.max}x o cliente paga ${JUROS.pct * JUROS.max === 100 ? 'o dobro' : `${100 + JUROS.pct * JUROS.max}%`} do valor parcelado. Muda em Configurações.</div>
    </div>
    <div class="card sim" id="simRes" style="padding:0">${simRes()}</div></div>`
}
function simRes() {
  const D = simDados(), s = D.s, sel = D.linhas.find((l) => l.n === s.n) || D.linhas.at(-1), vend = ehVendedor()
  return `<div style="padding:16px 16px 8px"><div class="lbl">Fica pra parcelar</div><div class="disp num" style="font-size:24px;color:var(--strong)">${fmt(D.fin)}</div>
      <div class="small">${fmt(D.preco)}${D.entrada ? ` − ${fmt(D.entrada)} de entrada` : ' · sem entrada'}</div></div>
    <div class="list simtab">${D.linhas.map((l) => `<button class="li ${l.n === s.n ? 'on' : ''}" data-sim-n="${l.n}">
        <span class="mid"><b class="num" style="color:var(--strong);font-size:15px">${l.n}x ${fmt(l.parc)}</b><span class="s" style="display:block">total ${fmt0(l.totalCli)} · juros ${fmt0(l.juros)}</span></span>
        ${!vend && l.lucro !== null ? `<span style="text-align:right"><span class="lbl" style="display:block">seu lucro</span><b class="num" style="color:${l.lucro >= 0 ? 'var(--ok)' : 'var(--bad)'}">${fmt0(l.lucro)}</b></span>` : ''}</button>`).join('')}</div>
    <div style="padding:12px 16px 16px;display:flex;flex-direction:column;gap:8px">
      <div class="small" style="text-align:center">Escolhido: <b style="color:var(--strong)">${D.entrada ? `${fmt(D.entrada)} + ` : ''}${sel.n}x ${fmt(sel.parc)}</b></div>
      <div class="row" style="gap:8px"><button class="btn b-out" style="flex:1" data-sim-wa>${ic('message-circle', 'i-sm')}Mandar pro cliente</button><button class="btn b-pri" style="flex:1" data-sim-vender>${ic('plus', 'i-sm')}Vender assim</button></div></div>`
}
function folhaSimWa() {
  const D = simDados(), nome = D.b ? `${D.b.modelo} ${D.b.gb} GB` : 'iPhone'
  const pick = [...new Set([1, 3, 5, 6, 8, 10].filter((n) => n <= JUROS.max).concat(D.s.n))].sort((a, b) => a - b)
  const msg = `*${nome}* · ${fmt(D.preco)}\n${D.entrada ? `Entrada: ${fmt(D.entrada)}\n` : ''}\n${pick.map((n) => { const l = D.linhas[n - 1]; return `${n}x de ${fmt(l.parc)}${n === D.s.n ? '  ⭐' : ''}` }).join('\n')}\n\nQualquer dúvida me chama aqui!`
  return `<h3>Mandar simulação</h3><div class="small" style="margin:2px 0 12px">Copie e mande no WhatsApp do cliente.</div><div class="msg" id="msgWa">${msg}</div>
    <div style="display:flex;gap:8px;margin-top:14px"><button class="btn b-ok b-block" data-copiar>${ic('copy', 'i-sm')}Copiar mensagem</button></div>`
}
function cliquesSim(t, d) {
  if (d.simEnt !== undefined && d.simEnt !== '') { S.sim.entrada = Math.round(numBR(S.sim.preco) * Number(d.simEnt) / 100 / 50) * 50; render(); return true }
  if (d.simN) { S.sim.n = Number(d.simN); document.getElementById('simRes').innerHTML = simRes(); return true }
  if ('simWa' in d) { abrir('simWa'); return true }
  if ('simVender' in d) {
    const s = S.sim
    novaVenda(s.bemId); Object.assign(S.nv, { preco: numBR(s.preco), entrada: numBR(s.entrada), n: s.n, passo: s.bemId ? 2 : 1, precoFixo: !s.bemId })
    S.folha = null
    if (ehEquipe()) S.eTela = 'vender'; else S.tela = 'vender'
    render(); document.querySelector('.main')?.scrollTo(0, 0); return true
  }
  if (d.simBem) { S.sim = { bemId: Number(d.simBem), preco: bem(Number(d.simBem)).preco, entrada: 0, n: JUROS.max }; S.folha = null; if (ehEquipe()) S.eTela = 'simulador'; else S.tela = 'simulador'; render(); return true }
  return false
}
function inputsSim(t) {
  if (t.id === 'simPreco') { S.sim.preco = t.value; document.getElementById('simRes').innerHTML = simRes(); return true }
  if (t.id === 'simEntrada') { S.sim.entrada = t.value; document.getElementById('simRes').innerHTML = simRes(); return true }
  if (t.id === 'simBem') { const id = Number(t.value) || null; S.sim.bemId = id; if (id) S.sim.preco = bem(id).preco; render(); return true }
  if (t.id === 'cfgJuros') { JUROS.pct = Number(t.value) || 0; return true }
  return false
}
