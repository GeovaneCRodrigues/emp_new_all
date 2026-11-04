import type { AparelhoApi } from '@/api/estoque'
import type { ClienteApi } from '@/api/clientes'

export type Pendencia = { chave: string; rotulo: string; de: 'cliente' | 'aparelho' }
export type Pendencias = { obrigatorias: Pendencia[]; recomendadas: Pendencia[] }

/**
 * O que ainda falta cadastrar para o contrato sair completo (espelha o backend).
 * Obrigatório: sem isso não há link de assinatura. Recomendado: sai "Não informado" no contrato.
 * O e-mail só é cobrado de quem enxerga o campo (o administrador).
 */
export function pendenciasDoContrato(c: ClienteApi, a: AparelhoApi): Pendencias {
  const obrigatorias: Pendencia[] = []
  const recomendadas: Pendencia[] = []
  const cl = (chave: string, rotulo: string) => ({ chave, rotulo, de: 'cliente' as const })
  const ap = (chave: string, rotulo: string) => ({ chave, rotulo, de: 'aparelho' as const })
  if (!c.cpf) obrigatorias.push(cl('cpf', 'CPF do cliente'))
  if (!c.endereco) obrigatorias.push(cl('endereco', 'Endereço do cliente'))
  if (!a.imei) obrigatorias.push(ap('imei', 'IMEI do aparelho'))
  if (!a.cor || a.cor.toUpperCase() === 'A DEFINIR') obrigatorias.push(ap('cor', 'Cor do aparelho'))
  if (!c.rg) recomendadas.push(cl('rg', 'RG do cliente'))
  if (c.email === null) recomendadas.push(cl('email', 'E-mail do cliente'))
  if (c.endereco && !c.cidade) recomendadas.push(cl('cidade', 'Cidade do cliente'))
  if (!a.serie) recomendadas.push(ap('serie', 'Número de série do aparelho'))
  return { obrigatorias, recomendadas }
}
