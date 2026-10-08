/** Hoje no Brasil (AAAA-MM-DD). O servidor pode estar em UTC: perto da meia-noite, o dia seria o de amanhã. */
export const hojeBR = (agora: Date = new Date()): string => agora.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
