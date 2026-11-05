/** Em que pé estão os avisos no celular deste aparelho — define o que o app mostra no sino. */
export type SituacaoPush =
  | 'indisponivel' // este navegador não sabe receber aviso (ou é o modo demonstração)
  | 'servidor-desligado' // o servidor está sem as chaves
  | 'instalar' // iPhone: só recebe com o app instalado na Tela de Início
  | 'bloqueado' // a pessoa negou a permissão nos ajustes
  | 'desativado' // pode ativar
  | 'ativo'

export interface EntradaPush {
  suportado: boolean
  servidorLigado: boolean
  ios: boolean
  instalado: boolean
  permissao: 'default' | 'granted' | 'denied'
  inscrito: boolean
}

export function situacaoPush(e: EntradaPush): SituacaoPush {
  if (!e.suportado && !(e.ios && !e.instalado)) return 'indisponivel'
  if (e.ios && !e.instalado) return 'instalar' // no Safari comum o iPhone nem oferece a permissão
  if (!e.servidorLigado) return 'servidor-desligado'
  if (e.permissao === 'denied') return 'bloqueado'
  return e.inscrito && e.permissao === 'granted' ? 'ativo' : 'desativado'
}
