// ----- comparação: o menu de cada perfil -----
function folhaMenus() {
  const atr = qtdAtraso(), pid = S.portalPid || 1, p = parceiro(pid), nv = nivelDe(pid)
  const tab = (l, i, on, cnt) => `<span class="${on ? 'on' : ''}">${ic(i, 'icon')}${l}${cnt ? `<span class="badge-dot">${cnt}</span>` : ''}</span>`
  const fab = (l, i) => `<span><span class="fab">${ic(i)}</span>${l}</span>`
  const item = (l, i, extra = '') => `<span>${ic(i)}${l}${extra}</span>`
  const pode = (sim, nao) => `<ul class="pode">${sim.map((x) => `<li>${ic('check')}${x}</li>`).join('')}${nao.map((x) => `<li class="nao">${ic('x')}${x}</li>`).join('')}</ul>`
  const admin = `<section>
      <div class="quem"><span class="avatar">GC</span><div><h4>Admin</h4><div class="small">Você e quem cuida da loja</div></div></div>
      <div><div class="lbl" style="margin-bottom:8px">Menu de baixo (celular)</div>
        <div class="mtabs">${tab('Início', 'house', true)}${tab('Cobranças', 'hand-coins', false, atr)}${fab('Vender', 'plus')}${tab('Estoque', 'smartphone')}${tab('Mais', 'menu')}</div></div>
      <div><div class="lbl" style="margin-bottom:8px">Dentro do “Mais” (no computador fica tudo na lateral)</div>
        <div class="mlist">${[NAV.find((n) => n.id === 'vendas'), ...MAIS].map((n) => item(n.label, n.icon)).join('')}</div></div>
      ${pode(['Vende, empresta e dá baixa nas parcelas', 'Paga repasse e muda o % de cada indicador', 'Vê caixa, lucro e relatórios'], [])}
      <button class="btn b-pri b-block" data-ver-como="admin">Abrir como admin</button>
    </section>`
  const ind = `<section>
      <div class="quem"><span class="ini" style="background:${nv.nivel.fundo};color:${nv.nivel.cor}">${iniciais(p.nome)}</span><div><h4>Indicador</h4><div class="small">${p.nome} · ${selo(nv.nivel)}</div></div></div>
      <div><div class="lbl" style="margin-bottom:8px">Menu de baixo (celular)</div>
        <div class="mtabs">${tab('Início', 'house', true)}${tab('Clientes', 'users')}${fab('Indicar', 'user-plus')}${tab('Cobrança', 'hand-coins')}${tab('Repasse', 'wallet')}</div></div>
      <div><div class="lbl" style="margin-bottom:8px">Lateral (computador)</div>
        <div class="mlist">${item('Início', 'house')}${item('Meus clientes', 'users')}${item('Cobrança', 'hand-coins')}${item('Repasse', 'wallet')}${item('Níveis', 'award', '<span class="small">no celular, pelo card do Início</span>')}</div></div>
      ${pode(['Vê só os clientes que ele indicou', 'Acompanha parcelas e chama o cliente no WhatsApp', 'Vê quanto tem pra receber e o nível dele', 'Manda indicação nova'], ['Não dá baixa, não vê caixa nem estoque', 'Não vê cliente de outro indicador'])}
      <button class="btn b-pri b-block" data-ver-como="indicador">Abrir como ${p.nome.split(' ')[0]}</button>
    </section>`
  return `<h3>Menu de cada perfil</h3><div class="small">Quem entra vê só o menu do perfil dele.</div><div class="cmp">${admin}${ind}</div>`
}
