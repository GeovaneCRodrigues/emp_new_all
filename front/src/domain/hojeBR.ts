/** Dia de hoje (AAAA-MM-DD) no horário de Brasília. Não usar toISOString(): é UTC e vira o dia às 21h. */
export const hojeBR = (agora: Date = new Date()): string => agora.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
