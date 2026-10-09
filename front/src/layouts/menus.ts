import type { Perfil } from '@/domain/types'

export interface ItemMenu {
  id: string
  label: string
  icon: string
  /** botão central em destaque na barra de baixo */
  fab?: boolean
}

export interface MenuPerfil {
  /** barra de baixo (celular) */
  abas: ItemMenu[]
  /** menu lateral (computador): itens principais */
  lateral: ItemMenu[]
  /** "Mais" (admin) ou itens extras da lateral */
  mais: ItemMenu[]
  nomePerfil: string
  inicio: string
}

const i = (id: string, label: string, icon: string, fab = false): ItemMenu => ({ id, label, icon, fab })

export const MENUS: Record<Perfil, MenuPerfil> = {
  ADMIN: {
    nomePerfil: 'Administrador',
    inicio: 'inicio',
    abas: [i('inicio', 'Início', 'house'), i('cobrancas', 'Cobranças', 'hand-coins'), i('novo', 'Novo', 'plus', true), i('estoque', 'Estoque', 'smartphone')],
    lateral: [i('inicio', 'Início', 'house'), i('cobrancas', 'Cobranças', 'hand-coins'), i('estoque', 'Estoque', 'smartphone'), i('operacoes', 'Operações', 'receipt-text')],
    mais: [
      i('operacoes', 'Operações', 'receipt-text'), i('simulador', 'Simulador', 'calculator'), i('clientes', 'Clientes', 'users'),
      i('cronograma', 'Cronograma', 'calendar-range'), i('caixa', 'Caixa', 'wallet'), i('relatorios', 'Relatórios', 'chart-no-axes-combined'),
      i('contratos', 'Contratos', 'file-signature'), i('indicadores', 'Indicadores e repasses', 'share-2'), i('equipe', 'Equipe', 'user-cog'),
      i('config', 'Configurações', 'settings'),
    ],
  },
  COBRADOR: {
    nomePerfil: 'Cobrador',
    inicio: 'hoje',
    abas: [i('hoje', 'Hoje', 'house'), i('carteira', 'Carteira', 'users'), i('recebi', 'Recebi', 'hand-coins', true), i('caixa', 'Caixa', 'wallet'), i('pedidos', 'Pedidos', 'clipboard-list')],
    lateral: [i('hoje', 'Hoje', 'house'), i('carteira', 'Carteira', 'users'), i('recebi', 'Recebi', 'hand-coins'), i('caixa', 'Caixa', 'wallet'), i('pedidos', 'Pedidos', 'clipboard-list')],
    mais: [],
  },
  VENDEDOR: {
    nomePerfil: 'Vendedor',
    inicio: 'inicio',
    abas: [i('inicio', 'Início', 'house'), i('estoque', 'Estoque', 'smartphone'), i('vender', 'Vender', 'plus', true), i('clientes', 'Clientes', 'users'), i('vendas', 'Vendas', 'receipt-text')],
    lateral: [i('inicio', 'Início', 'house'), i('estoque', 'Estoque', 'smartphone'), i('vender', 'Vender', 'plus'), i('clientes', 'Clientes', 'users'), i('vendas', 'Vendas', 'receipt-text'), i('simulador', 'Simulador', 'calculator')],
    mais: [],
  },
  INDICADOR: {
    nomePerfil: 'Indicador',
    inicio: 'inicio',
    abas: [i('inicio', 'Início', 'house'), i('clientes', 'Clientes', 'users'), i('indicar', 'Indicar', 'share-2', true), i('cobranca', 'Cobrança', 'hand-coins'), i('repasse', 'Repasse', 'wallet')],
    lateral: [i('inicio', 'Início', 'house'), i('clientes', 'Clientes', 'users'), i('indicar', 'Indicar', 'share-2'), i('cobranca', 'Cobrança', 'hand-coins'), i('repasse', 'Repasse', 'wallet'), i('niveis', 'Níveis', 'award')],
    mais: [],
  },
}

export const TITULOS: Record<string, string> = {
  inicio: 'Início', cobrancas: 'Cobranças', vender: 'Nova venda', estoque: 'Estoque', operacoes: 'Operações', simulador: 'Simulador',
  clientes: 'Clientes', cronograma: 'Cronograma', caixa: 'Caixa', relatorios: 'Relatórios', contratos: 'Contratos',
  indicadores: 'Indicadores', equipe: 'Equipe', config: 'Configurações', hoje: 'Hoje', carteira: 'Carteira', recebi: 'Recebi',
  pedidos: 'Pedidos', vendas: 'Vendas', indicar: 'Indicar', cobranca: 'Cobrança', repasse: 'Repasse', niveis: 'Níveis',
}
