/** Erro com status HTTP e uma mensagem segura para mostrar ao cliente. */
export class HttpError extends Error {
  constructor(public readonly status: number, message: string, public readonly code?: string) {
    super(message)
  }
}
export const naoAutenticado = (msg = 'Não autenticado') => new HttpError(401, msg, 'NAO_AUTENTICADO')
export const semPermissao = (msg = 'Sem permissão para isso') => new HttpError(403, msg, 'SEM_PERMISSAO')
export const naoEncontrado = (msg = 'Não encontrado') => new HttpError(404, msg, 'NAO_ENCONTRADO')
export const requisicaoInvalida = (msg: string) => new HttpError(400, msg, 'REQUISICAO_INVALIDA')
