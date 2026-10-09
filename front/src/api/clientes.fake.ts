import { criarSeed } from '@/data/seed'
import { cpfValido, normalizarFone, soDigitos } from '@/domain/documentos'
import type { Sessao } from '@/domain/escopo'
import { ErroApi, type ClienteApi, type ClientesApi, type EntradaCliente, type SalvoCliente } from './clientes'

/**
 * Versão de demonstração: guarda os clientes na memória e aplica as mesmas regras do backend
 * (validação, CPF único, escopo por perfil), para o front se comportar igual com ou sem servidor.
 */
export function criarClientesFake(): ClientesApi {
  const seed = criarSeed()
  let proximoId = 1000
  const lista: Required<ClienteApi>[] = seed.clientes.map((c) => ({
    id: c.id, nome: c.nome, fone: normalizarFone(c.fone) ?? soDigitos(c.fone), desde: c.desde,
    cpf: null, rg: null, endereco: null, origem: null, responsavelId: c.responsavelId, indicadorId: null,
  }))

  const indicados = (indicadorId: number) =>
    new Set([...seed.vendas, ...seed.emprestimos].filter((o) => o.indicadorId === indicadorId).map((o) => o.clienteId))

  const noEscopo = (s: Sessao) => {
    if (s.perfil === 'ADMIN') return lista
    // os que ele mesmo cadastrou, mais os que têm venda ou empréstimo com ele
    if (s.perfil === 'INDICADOR') { const ids = indicados(s.indicadorId ?? -1); return lista.filter((c) => c.indicadorId === s.indicadorId || ids.has(c.id)) }
    return lista.filter((c) => c.responsavelId === s.usuarioId)
  }
  const visao = (c: Required<ClienteApi>, s: Sessao): ClienteApi =>
    s.perfil === 'INDICADOR' ? { id: c.id, nome: c.nome, fone: c.fone, desde: c.desde } : { ...c }

  function validar(e: Partial<EntradaCliente>, parcial: boolean) {
    const d: Partial<Required<EntradaCliente>> = {}
    if (!parcial || 'nome' in e) {
      if (typeof e.nome !== 'string' || e.nome.trim().length < 2) throw new ErroApi(400, 'Informe o nome do cliente (ao menos 2 letras)')
      d.nome = e.nome.trim().replace(/\s+/g, ' ')
    }
    if (!parcial || 'fone' in e) {
      const f = typeof e.fone === 'string' ? normalizarFone(e.fone) : null
      if (!f) throw new ErroApi(400, 'Telefone inválido. Use DDD + número, por exemplo (11) 98812-4410')
      d.fone = f
    }
    if ('cpf' in e) {
      const bruto = (e.cpf ?? '').trim()
      if (!bruto) d.cpf = null
      else if (!cpfValido(bruto)) throw new ErroApi(400, 'CPF inválido')
      else d.cpf = soDigitos(bruto)
    }
    for (const k of ['rg', 'endereco', 'origem'] as const) if (k in e) d[k] = (e[k] ?? '').trim() || null
    return d
  }

  const salvar = (s: Sessao, c: Required<ClienteApi>, avisoDe?: number): SalvoCliente => {
    const outro = lista.find((x) => x.fone === c.fone && x.id !== (avisoDe ?? c.id))
    // o nome só aparece se o outro cliente está no escopo de quem pediu (não vaza carteira alheia)
    const aviso = outro && (noEscopo(s).includes(outro) ? `Já existe um cliente com esse telefone: ${outro.nome}` : 'Já existe um cliente com esse telefone, em outra carteira')
    return { cliente: visao(c, s), avisos: aviso ? [aviso] : [] }
  }
  const podeCriar = (s: Sessao) => {
    if (s.perfil !== 'ADMIN' && s.perfil !== 'VENDEDOR' && s.perfil !== 'INDICADOR') throw new ErroApi(403, 'Você não pode cadastrar clientes', 'SEM_PERMISSAO')
  }
  const podeEditar = (s: Sessao) => {
    if (s.perfil !== 'ADMIN' && s.perfil !== 'VENDEDOR') throw new ErroApi(403, 'Só o administrador e o vendedor cadastram clientes', 'SEM_PERMISSAO')
  }

  return {
    async listar(s, q) {
      const limite = Math.min(Math.max(q.limite ?? 20, 1), 100)
      const pagina = Math.max(q.pagina ?? 1, 1)
      const txt = (q.busca ?? '').trim().toLowerCase()
      const dig = soDigitos(txt)
      const achados = noEscopo(s)
        .filter((c) => !txt || c.nome.toLowerCase().includes(txt) || (dig && (c.fone.includes(dig) || (c.cpf ?? '').includes(dig))))
        .sort((a, b) => a.nome.toLowerCase().localeCompare(b.nome.toLowerCase(), 'pt-BR'))
      return { itens: achados.slice((pagina - 1) * limite, pagina * limite).map((c) => visao(c, s)), total: achados.length, pagina, limite }
    },
    async obter(s, id) {
      const c = noEscopo(s).find((x) => x.id === id)
      if (!c) throw new ErroApi(404, 'Cliente não encontrado', 'NAO_ENCONTRADO')
      return visao(c, s)
    },
    async criar(s, e) {
      podeCriar(s)
      const d = validar(e, false) as Required<EntradaCliente>
      // o indicador entrega a ficha com CPF (é o que evita cadastro repetido)
      if (s.perfil === 'INDICADOR' && !d.cpf) throw new ErroApi(400, 'Informe o CPF do cliente')
      if (d.cpf && lista.some((c) => c.cpf === d.cpf)) throw new ErroApi(409, 'Já existe um cliente com esse CPF', 'CPF_DUPLICADO')
      const novo: Required<ClienteApi> = {
        id: ++proximoId, nome: d.nome, fone: d.fone, cpf: d.cpf ?? null, rg: d.rg ?? null, endereco: d.endereco ?? null, origem: d.origem ?? null,
        // vendedor: na própria carteira; indicador: sem carteira e já vinculado a ele (a loja distribui); admin escolhe
        responsavelId: s.perfil === 'VENDEDOR' ? (s.usuarioId ?? null) : s.perfil === 'INDICADOR' ? null : (e.responsavelId ?? null),
        indicadorId: s.perfil === 'INDICADOR' ? (s.indicadorId ?? null) : null, desde: seed.hoje,
      }
      const r = salvar(s, novo)
      lista.push(novo)
      return r
    },
    async atualizar(s, id, e) {
      podeEditar(s)
      const c = noEscopo(s).find((x) => x.id === id)
      if (!c) throw new ErroApi(404, 'Cliente não encontrado', 'NAO_ENCONTRADO')
      const d = validar(e, true)
      if ('responsavelId' in e) {
        if (s.perfil !== 'ADMIN') throw new ErroApi(403, 'Só o administrador muda o responsável', 'SEM_PERMISSAO')
        d.responsavelId = e.responsavelId ?? null
      }
      if (d.cpf && lista.some((x) => x.cpf === d.cpf && x.id !== id)) throw new ErroApi(409, 'Já existe um cliente com esse CPF', 'CPF_DUPLICADO')
      const mudouFone = d.fone !== undefined && d.fone !== c.fone
      Object.assign(c, d)
      return mudouFone ? salvar(s, c, id) : { cliente: visao(c, s), avisos: [] }
    },
    async responsaveis(s) {
      if (s.perfil !== 'ADMIN') throw new ErroApi(403, 'Só o administrador vê a equipe', 'SEM_PERMISSAO')
      return seed.usuarios.map((u) => ({ id: u.id, nome: u.nome, perfil: u.perfil }))
    },
  }
}
