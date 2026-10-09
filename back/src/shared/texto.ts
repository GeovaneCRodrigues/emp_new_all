/** Cadastro padronizado: sem espaços sobrando e em LETRAS MAIÚSCULAS (nomes e endereços). */
export const maiusculas = (v: string): string => v.trim().replace(/\s+/g, ' ').toLocaleUpperCase('pt-BR')
