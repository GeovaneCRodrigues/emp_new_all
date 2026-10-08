// ===== Níveis dos indicadores + área do indicador (o que o Roberto vê quando entra) =====
const NIVEIS = [
  { id: 'BRONZE', nome: 'Bronze', min: 0, pct: 0.3, cor: '#a8692f', fundo: '#f6e8da' },
  { id: 'PRATA', nome: 'Prata', min: 3, pct: 0.4, cor: '#6b7785', fundo: '#e9edf1' },
  { id: 'OURO', nome: 'Ouro', min: 5, pct: 0.5, cor: '#a77d0c', fundo: '#f8efcf' },
  { id: 'DIAMANTE', nome: 'Diamante', min: 10, pct: 0.55, cor: '#1f86a8', fundo: '#dcf0f6' },
]
const NIV_CFG = { auto: true, conta: 'OPS' }
const leads = [{ id: 901, pid: 1, nome: 'Marcos Vieira', fone: '(11) 98111-2233', quer: 'iPhone 15 128 GB', obs: 'Quer dar entrada de R$ 1.500', data: '2026-10-07' }]
const opsDoIndicador = (pid) => [...vendas, ...emprestimos].filter((o) => o.parceiroId === pid)
function nivelDe(pid) {
  const n = opsDoIndicador(pid).length
  const i = NIVEIS.reduce((a, l, k) => (n >= l.min ? k : a), 0)
  return { n, nivel: NIVEIS[i], prox: NIVEIS[i + 1] || null }
}
// com "subir automático", o % do indicador acompanha o nível (vale para as próximas operações)
function syncNiveis() { if (NIV_CFG.auto) for (const p of parceiros) if (p.id && !p.pctManual) p.pct = nivelDe(p.id).nivel.pct }
const selo = (l, grande) => `<span class="selo ${grande ? 'g' : ''}" style="color:${l.cor};background:${l.fundo}">${ic('award', 'i-sm')}${l.nome}</span>`

function telaNiveisAdmin() {
  syncNiveis()
  const ps = parceiros.filter((p) => p.id)
  return `<div class="card pad" style="display:flex;flex-direction:column;gap:12px">
      <div class="between" style="gap:10px"><div><div class="val">Níveis dos indicadores</div><div class="small">Quanto mais indica, mais sobe e mais ganha do lucro.</div></div></div>
      <div class="niveis">${NIVEIS.map((l, i) => `<div class="niv" style="border-color:${l.cor}33">
        ${selo(l, true)}
        <div class="field"><label>A partir de</label><div class="inp" style="height:38px"><input inputmode="numeric" data-niv-min="${i}" value="${l.min}" ${i === 0 ? 'disabled' : ''} style="font-size:14px"><span class="small">operações</span></div></div>
        <div class="field"><label>Ganha do lucro</label><div class="inp" style="height:38px"><input inputmode="numeric" data-niv-pct="${i}" value="${Math.round(l.pct * 100)}" style="font-size:14px"><span>%</span></div></div>
        <div class="small">${ps.filter((p) => nivelDe(p.id).nivel.id === l.id).map((p) => p.nome.split(' ')[0]).join(', ') || 'ninguém ainda'}</div>
      </div>`).join('')}</div>
      <div class="between" style="gap:10px"><span><span class="val" style="display:block;font-size:14px">Subir o % sozinho quando mudar de nível</span><span class="small">Vale para as próximas operações. As antigas continuam com o % de quando foram feitas.</span></span>${sw(NIV_CFG.auto, 'data-niv-auto')}</div>
    </div>
    <div class="card list">${ps.map((p) => { const x = nivelDe(p.id); return `<div class="li"><span class="ini" style="background:${x.nivel.fundo};color:${x.nivel.cor}">${iniciais(p.nome)}</span>
      <span class="mid"><span class="t" style="display:block">${p.nome}</span><span class="s" style="display:block">${x.n} operações · ${Math.round(p.pct * 100)}% do lucro${x.prox ? ` · faltam ${x.prox.min - x.n} para ${x.prox.nome}` : ' · nível máximo'}${p.pctManual ? ' · % fixado à mão' : ''}</span></span>
      ${selo(x.nivel)}<button class="btn b-out b-sm" data-portal="${p.id}">Ver área dele</button></div>` }).join('')}</div>`
}

// ----- área do indicador -----
function portalDados(pid) {
  const p = parceiro(pid), r = repassesDoIndicador(pid), nv = nivelDe(pid)
  const meses = mesesJanela(0, 2), prev = previsaoRepasse(pid, meses)
  return { p, r, nv, meses, prev, pagos: repassesPagos.filter((x) => x.parceiroId === pid).sort((a, b) => b.data.localeCompare(a.data)) }
}
const nomeCurto = (n) => { const [a, ...b] = n.split(' '); return b.length ? `${a} ${b.at(-1)[0]}.` : a }
function portalShell() {
  syncNiveis()
  const D = portalDados(S.portalPid), t = S.pTela || 'inicio'
  const NAVP = [['inicio', 'Início', 'house'], ['clientes', 'Meus clientes', 'users'], ['extrato', 'Extrato', 'receipt-text'], ['niveis', 'Níveis', 'award']]
  const telas = { inicio: pInicio, clientes: pClientes, extrato: pExtrato, niveis: pNiveis }
  const banner = `<div class="banner-ind">${ic('share-2', 'i-sm')}<span>Você está vendo o que <b>${D.p.nome}</b> vê quando entra.</span><button class="btn b-sm" data-portal-sair>Voltar pro sistema</button></div>`
  const side = `<aside class="side">
      <div class="marca">${logo()}<span>Mundo dos<br><em>iPhones</em></span></div>
      <div class="me-card"><span class="ini" style="background:${D.nv.nivel.fundo};color:${D.nv.nivel.cor}">${iniciais(D.p.nome)}</span><div style="min-width:0"><div class="val" style="font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${D.p.nome}</div>${selo(D.nv.nivel)}</div></div>
      <button class="novo" data-folha="indicar">${ic('user-plus')}Indicar cliente</button>
      ${NAVP.map(([id, l, i]) => `<button class="item ${t === id ? 'on' : ''}" data-ptela="${id}">${ic(i)}${l}</button>`).join('')}
      <div class="rod" style="flex-direction:column;align-items:stretch;gap:6px"><div class="small">Nível ${D.nv.nivel.nome} · ${Math.round(D.p.pct * 100)}% do lucro</div>${D.nv.prox ? `<div class="bar"><i style="width:${Math.round((D.nv.n - D.nv.nivel.min) / (D.nv.prox.min - D.nv.nivel.min) * 100)}%;background:${D.nv.prox.cor}"></i></div><div class="small">Faltam ${D.nv.prox.min - D.nv.n} para ${D.nv.prox.nome}</div>` : '<div class="small">Nível máximo</div>'}</div>
    </aside>`
  const tabs = `<nav class="tabs">${NAVP.slice(0, 2).map(([id, l, i]) => `<button class="${t === id ? 'on' : ''}" data-ptela="${id}">${ic(i, 'icon')}${l.replace('Meus ', '')}</button>`).join('')}<button class="vender" data-folha="indicar"><span class="fab">${ic('user-plus')}</span>Indicar</button>${NAVP.slice(2).map(([id, l, i]) => `<button class="${t === id ? 'on' : ''}" data-ptela="${id}">${ic(i, 'icon')}${l}</button>`).join('')}</nav>`
  return `${side}<div class="main">${banner}<header class="top"><span class="logo-m">${logo(true)}</span><h1>${{ inicio: `Olá, ${D.p.nome.split(' ')[0]}`, clientes: 'Meus clientes', extrato: 'Extrato', niveis: 'Níveis' }[t]}</h1>${selo(D.nv.nivel)}</header><div class="content">${telas[t](D)}</div></div>${tabs}`
}
function pInicio(D) {
  const { p, r, nv, meses, prev } = D
  const vai = Math.max(0, r.vaiGanhar - r.liberado)
  return `<div class="hero" style="gap:6px"><div class="lbl">Você tem pra receber</div><div class="big disp num">${fmt(r.aPagar)}</div><div class="lbl">${r.aPagar ? 'Já liberado. O Geovane faz o Pix pra você.' : 'Nada liberado no momento.'}${p.pix ? ` Pix: ${p.pix}` : ''}</div></div>
    <div class="resumo3"><div><div class="lbl">Já recebeu</div><div class="val num" style="color:var(--ok)">${fmt0(r.jaPago)}</div></div><div><div class="lbl">Ainda vai ganhar</div><div class="val num">${fmt0(vai)}</div></div><div><div class="lbl">Clientes</div><div class="val num">${new Set(r.linhas.map((l) => l.o.clienteId)).size}</div></div></div>
    <div class="card pad" style="display:flex;flex-direction:column;gap:10px">
      <div class="between"><span class="row" style="gap:8px">${selo(nv.nivel, true)}<span class="small">${Math.round(p.pct * 100)}% do lucro</span></span>${nv.prox ? `<span class="small">próximo: ${selo(nv.prox)}</span>` : ''}</div>
      ${nv.prox ? `<div class="bar" style="height:10px"><i style="width:${Math.round((nv.n - nv.nivel.min) / (nv.prox.min - nv.nivel.min) * 100)}%;background:linear-gradient(90deg,${nv.nivel.cor},${nv.prox.cor})"></i></div>
      <div class="small">Você já indicou <b style="color:var(--strong)">${nv.n}</b> ${nv.n === 1 ? 'venda ou empréstimo' : 'vendas e empréstimos'}. Faltam <b style="color:var(--strong)">${nv.prox.min - nv.n}</b> para virar ${nv.prox.nome} e ganhar ${Math.round(nv.prox.pct * 100)}% do lucro.</div>` : '<div class="small">Você está no nível máximo.</div>'}
    </div>
    <div class="card pad"><div class="between"><b style="color:var(--strong)">Quando o dinheiro libera</b><span class="small">pelas parcelas previstas</span></div>
      <div class="dl" style="grid-template-columns:repeat(3,minmax(0,1fr));margin-top:10px">${meses.map((k) => `<div><div class="lbl" style="text-transform:capitalize">${MESES[Number(k.slice(5, 7)) - 1]}</div><div class="val num">${fmt0(prev[k])}</div></div>`).join('')}</div>
      <div class="small" style="margin-top:8px">A sua parte só começa depois que o cliente devolve o valor do aparelho ou do empréstimo.</div></div>
    <button class="btn b-pri b-block" data-folha="indicar">${ic('user-plus', 'i-sm')}Indicar um cliente</button>`
}
function pClientes(D) {
  const meus = leads.filter((l) => l.pid === D.p.id)
  return `${meus.length ? `<div class="card list"><div class="totbar"><b style="color:var(--strong)">Indicações esperando</b><span class="small">${meus.length}</span></div>${meus.map((l) => `<div class="li"><span class="ini">${iniciais(l.nome)}</span><span class="mid"><span class="t" style="display:block">${l.nome}</span><span class="s" style="display:block">${l.quer} · enviada ${dmy(l.data)}</span></span><span class="chip c-warn">em análise</span></div>`).join('')}</div>` : ''}
    <div class="card list">${D.r.linhas.map((l) => { const atr = l.k.atrasadas.length, cap = Math.min(100, Math.round(l.k.capitalDeVolta / l.k.inv * 100)); return `<div class="li" style="align-items:flex-start;flex-wrap:wrap">
      <span class="ini">${iniciais(cliente(l.o.clienteId).nome)}</span>
      <span class="mid"><span class="t" style="display:block">${nomeCurto(cliente(l.o.clienteId).nome)} <span class="small">· ${nomeItem(l.o)}</span></span>
        <span class="s" style="display:block">${l.k.status === 'QUITADA' ? 'Quitado' : atr ? `${atr} parcela${atr > 1 ? 's' : ''} atrasada${atr > 1 ? 's' : ''}` : 'Pagando em dia'} · ${l.volta.jaVoltou ? 'sua parte já está liberando' : `${cap}% até sua parte começar`}</span>
        <span class="bar" style="display:block;margin-top:6px"><i style="width:${cap}%;${atr ? 'background:var(--bad)' : ''}"></i></span></span>
      <span style="text-align:right;white-space:nowrap"><span class="lbl" style="display:block">Sua parte</span><b class="num">${fmt0(l.parteTotal)}</b><span class="small" style="display:block">${fmt0(l.parte)} liberado</span></span></div>` }).join('') || '<div class="empty">Nenhum cliente ainda.</div>'}</div>
    <p class="small" style="margin:0">Cliente atrasado segura a sua parte. Se puder, dá um toque nele.</p>`
}
function pExtrato(D) {
  const { r, pagos } = D
  return `<div class="dl" style="grid-template-columns:repeat(3,minmax(0,1fr))"><div><div class="lbl">Liberado</div><div class="val num">${fmt0(r.liberado)}</div></div><div><div class="lbl">Recebido</div><div class="val num" style="color:var(--ok)">${fmt0(r.jaPago)}</div></div><div><div class="lbl">A receber</div><div class="val num" style="color:var(--warn)">${fmt0(r.aPagar)}</div></div></div>
    <div class="card list">${pagos.map((x) => `<div class="li"><span class="wa" style="width:32px;height:32px">${ic('arrow-down-left', 'i-sm')}</span><span class="mid"><span class="t" style="display:block">Repasse recebido</span><span class="s" style="display:block">${dmyA(x.data)} · ${x.forma || 'Pix'}</span></span><b class="num" style="color:var(--ok)">+ ${fmt(x.valor)}</b></div>`).join('') || '<div class="empty">Nenhum repasse recebido ainda.</div>'}</div>`
}
function pNiveis(D) {
  const { nv } = D
  return `<p class="small" style="margin:0">Cada venda ou empréstimo que você indicar conta. Quanto mais sobe, maior a sua parte do lucro nas próximas indicações.</p>
    <div class="escada">${NIVEIS.map((l) => { const atual = l.id === nv.nivel.id, feito = nv.n >= l.min; return `<div class="degrau ${atual ? 'atual' : ''} ${feito ? 'feito' : ''}" style="--c:${l.cor};--f:${l.fundo}">
      <span class="marco">${feito ? ic('check', 'i-sm') : ''}</span>
      <div style="flex:1;min-width:0"><div class="row" style="gap:8px">${selo(l, true)}${atual ? '<span class="chip c-pri">você está aqui</span>' : ''}</div><div class="small" style="margin-top:4px">${l.min ? `A partir de ${l.min} indicações` : 'Começo'}</div></div>
      <div style="text-align:right"><div class="val num" style="font-size:20px;color:${l.cor}">${Math.round(l.pct * 100)}%</div><div class="small">do lucro</div></div></div>` }).join('')}</div>`
}
function folhaIndicar() {
  const x = S.ind || {}
  return `<h3>Indicar um cliente</h3><div class="small">O Geovane recebe na hora e chama o cliente.</div><div style="display:flex;flex-direction:column;gap:12px;margin-top:14px">
    <div class="field"><label>Nome do cliente</label><div class="inp"><input id="ldNome" value="${x.ldNome || ''}" placeholder="Nome" style="font-size:15px"></div></div>
    <div class="field"><label>WhatsApp dele</label><div class="inp"><input id="ldFone" value="${x.ldFone || ''}" inputmode="tel" placeholder="(11) 9...." style="font-size:15px"></div></div>
    <div class="field"><label>O que ele quer</label><div class="pills">${['iPhone', 'Empréstimo'].map((q) => `<button class="pill ${(x.tipo || 'iPhone') === q ? 'on' : ''}" data-ld-tipo="${q}">${q}</button>`).join('')}</div></div>
    <div class="field"><label>${(x.tipo || 'iPhone') === 'iPhone' ? 'Qual modelo' : 'Quanto'}</label><div class="inp"><input id="ldQuer" value="${x.ldQuer || ''}" placeholder="${(x.tipo || 'iPhone') === 'iPhone' ? 'Ex.: iPhone 14 128 GB' : 'Ex.: R$ 2.000'}" style="font-size:15px"></div></div>
    <div class="field"><label>Observação</label><div class="inp"><input id="ldObs" value="${x.ldObs || ''}" placeholder="Opcional" style="font-size:15px"></div></div>
    <button class="btn b-pri b-block" data-ld-enviar>${ic('send', 'i-sm')}Mandar indicação</button></div>`
}
// indicações que chegaram, na visão do Geovane
function leadsAdmin() {
  if (!leads.length) return ''
  return `<div class="card list"><div class="totbar"><b style="color:var(--strong)">Indicações novas</b><span class="chip c-warn">${leads.length}</span></div>${leads.map((l) => `<div class="li" style="flex-wrap:wrap"><span class="ini">${iniciais(l.nome)}</span>
    <span class="mid" style="min-width:160px"><span class="t" style="display:block">${l.nome} <span class="small">· por ${parceiro(l.pid).nome.split(' ')[0]}</span></span><span class="s" style="display:block;white-space:normal">${l.quer}${l.obs ? ` · ${l.obs}` : ''} · ${l.fone}</span></span>
    <span class="row" style="gap:6px"><button class="btn b-ghost b-sm" data-ld-recusar="${l.id}">Recusar</button><button class="btn b-pri b-sm" data-ld-aceitar="${l.id}">Virar cliente</button></span></div>`).join('')}</div>`
}

function cliquesPortal(t, d) {
  if (d.portal) { S.modo = 'indicador'; S.portalPid = Number(d.portal); S.pTela = 'inicio'; S.folha = null; render(); document.querySelector('.main')?.scrollTo(0, 0); return true }
  if ('portalSair' in d) { S.modo = null; S.folha = null; render(); return true }
  if (d.ptela) { S.pTela = d.ptela; render(); document.querySelector('.main')?.scrollTo(0, 0); return true }
  if ('nivAuto' in d) { NIV_CFG.auto = !NIV_CFG.auto; render(); return true }
  if (d.ldTipo) { (S.ind ||= {}).tipo = d.ldTipo; renderCamada(); return true }
  if ('ldEnviar' in d) {
    const x = S.ind || {}; if (!(x.ldNome || '').trim()) return true
    leads.unshift({ id: ++seq, pid: S.portalPid, nome: x.ldNome.trim(), fone: x.ldFone || '—', quer: x.ldQuer || x.tipo || 'iPhone', obs: x.ldObs || '', data: HOJE })
    S.ind = null; S.folha = null; S.pTela = 'clientes'; render(); toast('Indicação enviada. O Geovane foi avisado.'); return true
  }
  if (d.ldAceitar) { const i = leads.findIndex((l) => l.id === Number(d.ldAceitar)), l = leads.splice(i, 1)[0]; const c = { id: ++seq, nome: l.nome, fone: l.fone, desde: HOJE }; clientes.push(c); S.clienteId = c.id; ir('cliente'); toast(`${l.nome} virou cliente. Venda com indicação do ${parceiro(l.pid).nome.split(' ')[0]}.`); return true }
  if (d.ldRecusar) { const i = leads.findIndex((l) => l.id === Number(d.ldRecusar)); const l = leads.splice(i, 1)[0]; render(); toast(`Indicação de ${l.nome} recusada`); return true }
  return false
}
function inputsPortal(t) {
  if (['ldNome', 'ldFone', 'ldQuer', 'ldObs'].includes(t.id)) { (S.ind ||= {})[t.id] = t.value; return true }
  if (t.dataset.nivMin != null) { const v = Number(t.value); if (v >= 0) NIVEIS[Number(t.dataset.nivMin)].min = v; return true }
  if (t.dataset.nivPct != null) { const v = Number(t.value); if (v >= 0 && v <= 100) NIVEIS[Number(t.dataset.nivPct)].pct = v / 100; return true }
  return false
}
