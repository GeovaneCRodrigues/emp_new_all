// Cópia, para a demonstração, de back/src/modules/contratos/services/modelo.ts. O teste de paridade (contrato.test.ts) garante que as duas dão o mesmo resultado.

/** Tudo o que o texto do contrato usa, tirado da venda. */
export type DadosVenda = {
  vendaId: number
  vendaStatus: string
  numero: string
  dataVenda: string
  cliente: {
    nome: string; cpf: string | null; fone: string; email: string | null; rg: string | null
    endereco: string | null; numero: string | null; bairro: string | null; cidade: string | null; uf: string | null; cep: string | null
  }
  aparelho: { modelo: string; gb: number; cor: string; condicao: string; imei: string | null; serie: string | null }
  entrada: number
  troca: number
  parcelas: { valor: number; vencimento: string }[]
}

export type Empresa = {
  nome: string
  cnpj: string | null
  endereco: string | null
  email: string | null
  atendente: string | null
  /** só dígitos, com DDD */
  telefone: string | null
  cidade: string | null
  /** 2 letras */
  uf: string | null
  /** chave Pix da loja (como foi digitada) */
  pixChave: string | null
  /** a imagem sai por GET /api/empresa/logo (não vem junto) */
  temLogo: boolean
}


const arred = (v: number) => Math.round(v * 100) / 100
export const brl = (v: number) => 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const dmyA = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

export type Variavel = { chave: string; rotulo: string; grupo: string }
/** `opcional`: sem o dado, sai este texto no lugar (não trava o envio); sem `opcional`, falta de dado trava. */
type Def = Variavel & { valor: (d: DadosVenda, e: Empresa) => string | null; opcional?: string }

const cepFmt = (c: string) => (c.length === 8 ? `${c.slice(0, 5)}-${c.slice(5)}` : c)
/** Rua, número, bairro, cidade - UF, CEP. Cliente antigo, com o endereço todo num texto só, sai como estava. */
export function enderecoCompleto(c: DadosVenda['cliente']): string | null {
  if (!c.endereco) return null
  const cidadeUf = [c.cidade, c.uf].filter(Boolean).join(' - ')
  return [c.endereco, c.numero && `nº ${c.numero}`, c.bairro, cidadeUf, c.cep && `CEP ${cepFmt(c.cep)}`].filter(Boolean).join(', ')
}
const telefoneFmt = (t: string) => (t.length === 11 ? `(${t.slice(0, 2)}) ${t.slice(2, 7)}-${t.slice(7)}` : t.length === 10 ? `(${t.slice(0, 2)}) ${t.slice(2, 6)}-${t.slice(6)}` : t)
const DEFS: Def[] = [
  { grupo: 'Contrato', chave: 'contrato_numero', rotulo: 'Número do contrato', valor: (d) => d.numero },
  { grupo: 'Contrato', chave: 'data_venda', rotulo: 'Data da venda', valor: (d) => dmyA(d.dataVenda) },
  { grupo: 'Contrato', chave: 'data_fim', rotulo: 'Fim previsto', valor: (d) => dmyA(d.parcelas.at(-1)?.vencimento ?? d.dataVenda) },
  { grupo: 'Contrato', chave: 'atendente', rotulo: 'Atendente', valor: (_d, e) => e.atendente },
  { grupo: 'Cliente', chave: 'cliente_nome', rotulo: 'Nome', valor: (d) => d.cliente.nome },
  { grupo: 'Cliente', chave: 'cliente_cpf', rotulo: 'CPF', valor: (d) => d.cliente.cpf && (d.cliente.cpf.length === 11 ? d.cliente.cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : d.cliente.cpf) },
  { grupo: 'Cliente', chave: 'cliente_telefone', rotulo: 'Telefone', valor: (d) => d.cliente.fone },
  { grupo: 'Cliente', chave: 'cliente_rg', rotulo: 'RG', valor: (d) => d.cliente.rg, opcional: 'Não informado' },
  { grupo: 'Cliente', chave: 'cliente_email', rotulo: 'E-mail', valor: (d) => d.cliente.email, opcional: 'Não informado' },
  { grupo: 'Cliente', chave: 'cliente_endereco', rotulo: 'Endereço completo', valor: (d) => enderecoCompleto(d.cliente) },
  { grupo: 'Cliente', chave: 'cliente_cidade', rotulo: 'Cidade', valor: (d) => d.cliente.cidade },
  { grupo: 'Aparelho', chave: 'aparelho_modelo', rotulo: 'Modelo', valor: (d) => d.aparelho.modelo },
  { grupo: 'Aparelho', chave: 'aparelho_capacidade', rotulo: 'Capacidade', valor: (d) => (d.aparelho.gb > 0 ? `${d.aparelho.gb} GB` : null) },
  { grupo: 'Aparelho', chave: 'aparelho_cor', rotulo: 'Cor', valor: (d) => (d.aparelho.cor === 'A DEFINIR' ? null : d.aparelho.cor) },
  { grupo: 'Aparelho', chave: 'aparelho_estado', rotulo: 'Estado', valor: (d) => d.aparelho.condicao },
  { grupo: 'Aparelho', chave: 'aparelho_imei', rotulo: 'IMEI', valor: (d) => d.aparelho.imei },
  { grupo: 'Aparelho', chave: 'aparelho_serie', rotulo: 'Número de série', valor: (d) => d.aparelho.serie, opcional: 'Não informado' },
  { grupo: 'Pagamento', chave: 'entrada_valor', rotulo: 'Entrada', valor: (d) => brl(arred(d.entrada + d.troca)) },
  {
    grupo: 'Pagamento', chave: 'entrada_composicao', rotulo: 'Como foi a entrada',
    valor: (d) => (d.entrada && d.troca ? `${brl(d.entrada)} em dinheiro e um aparelho na troca, avaliado em ${brl(d.troca)}` : d.troca ? `aparelho na troca, avaliado em ${brl(d.troca)}` : d.entrada ? `${brl(d.entrada)} em dinheiro` : 'sem entrada'),
  },
  { grupo: 'Pagamento', chave: 'parcelas_qtd', rotulo: 'Nº de parcelas', valor: (d) => String(d.parcelas.length) },
  { grupo: 'Pagamento', chave: 'parcela_valor', rotulo: 'Valor da parcela', valor: (d) => (d.parcelas[0] ? brl(d.parcelas[0].valor) : 'não há parcelas') },
  { grupo: 'Pagamento', chave: 'primeiro_vencimento', rotulo: '1º vencimento', valor: (d) => (d.parcelas[0] ? dmyA(d.parcelas[0].vencimento) : 'não há parcelas') },
  { grupo: 'Pagamento', chave: 'valor_total', rotulo: 'Valor total', valor: (d) => brl(arred(d.entrada + d.troca + d.parcelas.reduce((s, p) => s + p.valor, 0))) },
  { grupo: 'Empresa', chave: 'empresa_nome', rotulo: 'Razão social', valor: (_d, e) => e.nome },
  { grupo: 'Empresa', chave: 'empresa_cnpj', rotulo: 'CNPJ', valor: (_d, e) => e.cnpj },
  { grupo: 'Empresa', chave: 'empresa_endereco', rotulo: 'Endereço', valor: (_d, e) => e.endereco },
  { grupo: 'Empresa', chave: 'empresa_email', rotulo: 'E-mail', valor: (_d, e) => e.email },
  { grupo: 'Empresa', chave: 'empresa_telefone', rotulo: 'Telefone', valor: (_d, e) => (e.telefone && telefoneFmt(e.telefone)), opcional: 'Não informado' },
  { grupo: 'Empresa', chave: 'empresa_cidade', rotulo: 'Cidade da empresa', valor: (_d, e) => e.cidade },
  { grupo: 'Empresa', chave: 'empresa_uf', rotulo: 'UF da empresa', valor: (_d, e) => e.uf },
  { grupo: 'Empresa', chave: 'empresa_pix', rotulo: 'Chave Pix da loja', valor: (_d, e) => e.pixChave, opcional: 'Não informada' },
]
const POR_CHAVE = new Map(DEFS.map((d) => [d.chave, d]))
export const VARIAVEIS: Variavel[] = DEFS.map(({ chave, rotulo, grupo }) => ({ chave, rotulo, grupo }))

/** `ok`: veio do sistema · `falta`: campo sem cadastro · `desconhecido`: nome que não existe · `txt`: texto do modelo (ou contrato já enviado) */
export type Trecho = { tipo: 'txt' | 'ok' | 'falta' | 'desconhecido'; v: string }
export type Preenchido = { trechos: Trecho[]; /** rótulos dos campos que faltam cadastrar */ faltam: string[]; /** o texto final, com os campos que faltam em branco */ texto: string }

const CAMPO = /\{\{\s*(\w+)\s*\}\}/g

/** Chaves {{assim}} do texto que não existem. */
export const camposDesconhecidos = (texto: string): string[] => [...new Set([...texto.matchAll(CAMPO)].map((m) => m[1]).filter((k) => !POR_CHAVE.has(k)))]

export function preencher(texto: string, d: DadosVenda, e: Empresa): Preenchido {
  const trechos: Trecho[] = []
  const faltam = new Set<string>()
  let i = 0
  for (const m of texto.matchAll(CAMPO)) {
    if (m.index > i) trechos.push({ tipo: 'txt', v: texto.slice(i, m.index) })
    const def = POR_CHAVE.get(m[1])
    if (!def) trechos.push({ tipo: 'desconhecido', v: m[0] })
    else {
      const valor = def.valor(d, e) || def.opcional || null
      if (valor === null) { faltam.add(def.rotulo); trechos.push({ tipo: 'falta', v: `${def.rotulo} não cadastrado` }) } else trechos.push({ tipo: 'ok', v: valor })
    }
    i = m.index + m[0].length
  }
  if (i < texto.length) trechos.push({ tipo: 'txt', v: texto.slice(i) })
  return { trechos, faltam: [...faltam], texto: trechos.map((t) => (t.tipo === 'falta' ? '' : t.v)).join('') }
}


export const MODELO_PADRAO = `INSTRUMENTO PARTICULAR DE CONTRATO DE LOCAÇÃO DE APARELHO (S) CELULAR COM TRANSFERÊNCIA DO APARELHO AO FINAL DO PLANO (CESSÃO DE BEM MÓVEL)
ANEXO I. ABERTURA DE CONTRATO

CONTRATO N°: {{contrato_numero}}
DATA INÍCIO: {{data_venda}}
DATA FINAL PREVISTA: {{data_fim}}
ATENDENTE: {{atendente}}
LOCAL DE ENTREGA: Sede da LOCADORA.
LOCAL DE DEVOLUÇÃO: Sede da LOCADORA.
FRANQUIA LOCAÇÃO DE APARELHO CELULAR
FREQUÊNCIA DE PAGAMENTOS: Mensal
VALOR: {{entrada_valor}} (entrada) + {{parcelas_qtd}}x de {{parcela_valor}} (mensal)
PRIMEIRO VENCIMENTO: {{primeiro_vencimento}}
CHAVE PIX DA LOJA: {{empresa_pix}}

CLIENTE (LOCATÁRIO): {{cliente_nome}}
E-MAIL: {{cliente_email}}
ENDEREÇO: {{cliente_endereco}}
CPF: {{cliente_cpf}}
RG: {{cliente_rg}}
TELEFONE: {{cliente_telefone}}
QUANTIDADE DE APARELHOS CELULARES: 1
ENTRADA (PARTE DO PREÇO DO APARELHO): {{entrada_valor}} ({{entrada_composicao}})

Locadora: {{empresa_nome}} CNPJ: {{empresa_cnpj}}
E-MAIL: {{empresa_email}} ENDEREÇO: {{empresa_endereco}}

MODELO DO APARELHO CELULAR: {{aparelho_modelo}} {{aparelho_capacidade}}
NÚMERO DE SÉRIE: {{aparelho_serie}}
COR: {{aparelho_cor}}
ESTADO: {{aparelho_estado}}
IMEI: {{aparelho_imei}}

VALOR DO PAGAMENTO MENSAL: {{parcela_valor}}
VALOR TOTAL DO CONTRATO: {{valor_total}}

ANEXO II - MINUTA DE CONTRATO
Pelo presente instrumento ficam estabelecidas as seguintes cláusulas e condições que, em conjunto com o Termo de Abertura do Contrato, bem como todos os anexos que o compõe, regem a relação entre o LOCATÁRIO, e a LOCADORA, para a locação de APARELHO (S) CELULAR:

CLÁUSULA PRIMEIRA: DO OBJETO
1.1. O objeto do presente Contrato é a locação de APARELHO CELULAR, conforme discriminado, de propriedade da LOCADORA, ficando o LOCATÁRIO com a posse e o uso do aparelho durante a locação, por prazo determinado, conforme confirmado e aceito pelo LOCATÁRIO pelo simples ato de sua retirada. Pagas todas as parcelas do plano, o aparelho passa a ser do LOCATÁRIO, nos termos da Cláusula Décima Quarta.
1.1.1. São os aparelhos objeto do presente contrato:
Modelo: {{aparelho_modelo}} {{aparelho_capacidade}}
Número de Série: {{aparelho_serie}}
Cor: {{aparelho_cor}}
Capacidade: {{aparelho_capacidade}}
Estado: {{aparelho_estado}}

CLÁUSULA SEGUNDA: DAS DEFINIÇÕES DOS TERMOS UTILIZADOS NO CONTRATO
2.1. Acidente: é a ocorrência de acontecimentos, involuntários e casuais, envolvendo o APARELHO CELULAR alugado, que ocasionem danos e/ou similar.
2.2. Contrato: é o presente instrumento, que define as regras gerais aplicadas nas locações de APARELHOS CELULARES e similar.
2.3. Abertura de Contrato: é o documento que identifica cada locação específica realizada, o qual contempla os detalhes da locação, os dados do APARELHO CELULAR, preços, prazos e demais condições contratadas.
2.4. Tarifário: é o documento que identifica os preços praticados pela LOCADORA, sempre disponível no site oficial da LOCADORA. Os valores deste Contrato ficam fixos, nos termos da Cláusula Décima Segunda.
2.5. LOCADORA: é a pessoa jurídica de direito privado, cuja razão social, obrigatoriamente, constará na Abertura de Contrato e será, sempre, a única e exclusiva responsável pela operação dos Contratos que vier a celebrar.
2.6. LOCATÁRIO(a) ou Cliente: é a pessoa física, maior de 18 anos, cujo número de inscrição no CPF e demais dados, obrigatoriamente, constarão na Abertura de Contrato, responsável pelo integral cumprimento das condições impostas pelo Contrato e demais documentos relacionados a contratação da locação do(s) APARELHO(S) CELULAR.
2.7. Plano da Locação: é o plano escolhido pelo LOCATÁRIO quando da contratação e estará definido na Abertura de Contrato, incluindo, período, valor, modelo do APARELHO CELULAR e condições de locação.
2.8. CEDENTE: é a LOCADORA, quando o aparelho é transferido ao LOCATÁRIO ao final do plano, nos termos da Cláusula Décima Quarta.
2.9. CESSIONÁRIO: é o LOCATÁRIO, quando recebe o aparelho ao final do plano, nos termos da Cláusula Décima Quarta.

CLÁUSULA TERCEIRA: DA CIÊNCIA E CONCORDÂNCIA COM OS TERMOS ORA AJUSTADOS
3.1. O LOCATÁRIO, declara que tomou conhecimento prévio e anuiu integralmente aos termos da presente transação, disponibilizado no atendimento e no momento de sua retirada.
3.2. O LOCATÁRIO se compromete a cumprir todas as disposições e obrigações estabelecidas no contrato de locação, reconhecendo que qualquer uso indevido ou violação das condições acordadas, poderá resultar em responsabilidade legal, inclusive nas esferas civil, administrativa e criminal, de acordo com a legislação vigente.
3.3. Adicionalmente, o LOCATÁRIO reconhece e declara:
3.3.1. compreender que atrasos de pagamento e a consequente devolução do APARELHO CELULAR podem ser considerados apropriação indébita, o que poderá levar ao bloqueio remoto do aparelho;
3.3.2. reconhecer que o atraso de mais de 72 (setenta e duas) horas no pagamento de qualquer parcela resultará no bloqueio remoto do APARELHO CELULAR e na cobrança dos valores devidos.
3.4. Caso o LOCATÁRIO não efetue o pagamento completo do plano, deixando de devolver o APARELHO CELULAR após notificação, em data estipulada, fica resguardado à LOCADORA o direito de realizar, a qualquer tempo, a cobrança dos valores devidos até a sua efetiva devolução, incluindo os débitos relativos a eventuais avarias, perdas e danos, além de bloqueio do APARELHO CELULAR.

CLÁUSULA QUARTA: DOS REQUISITOS PARA LOCAÇÃO E UTILIZAÇÃO DO APARELHO CELULAR
4.1. O LOCATÁRIO deverá obrigatoriamente:
4.1.1. ter mais de 18 (dezoito) anos e comprovar tal condição por meio de documento pessoal com foto, que contenha o número do CPF, no momento da locação do APARELHO CELULAR;
4.1.2. efetuar o pagamento da entrada apontada no Termo de Abertura de Contrato, em dinheiro ou com aparelho dado na troca, conforme avaliação.

CLÁUSULA QUINTA: DO DESVIO DE FINALIDADE DA LOCAÇÃO E DEFINIÇÃO DE MAU USO
5.1. O APARELHO CELULAR alugado não poderá ser objeto de mau uso, má conduta, conduta danosa ao aparelho, desrespeito ao dever de cuidado e zelo do objeto locado, assim considerados:
5.1.1. Sublocar ou emprestar à terceiros de qualquer natureza, bem como manifestar intenção de fazê-lo por meio de comunicação, anúncio e/ou negociação;
5.1.2. Praticar atividades ilícitas, ou qualquer tipo de atividade que fuja do objeto deste contrato.
5.1.3. Omitir, não comunicar de imediato, ou prestar falsa informação sobre situações como furto, roubo, apreensão, apropriação indébita, acidentes e similares
5.1.4. Não comparecer a convocação da LOCADORA em até 24hrs (vinte e quatro horas) quando o LOCATÁRIO for chamado por qualquer razão, que vise a melhoria e/ou manutenção do APARELHO CELULAR;
5.1.5. Em qualquer das hipóteses acima, o Contrato poderá ser rescindido imediatamente, unilateralmente e por culpa do Locatário, ou, a conveniência da LOCADORA, poderá ser oportunizado, primeiramente, a devida notificação, além de serem aplicados o bloqueio do APARELHO CELULAR e cobrança dos valores devidos, sem prejuízo de quaisquer medidas judiciais e administrativas cabíveis.

CLÁUSULA SEXTA: VALOR DA LOCAÇÃO, PAGAMENTO E OUTRAS DESPESAS QUE SE FIZEREM NECESSÁRIAS
6.1. O pagamento da entrada será realizado no momento da reserva, no ato da negociação com os atendentes da LOCADORA, podendo ser pago pelos meios de pagamento aceitos pela LOCADORA, no caso, via boleto bancário ou PIX. Os pagamentos por PIX serão feitos na chave da LOCADORA indicada na Abertura de Contrato. As parcelas vencem a partir da data do primeiro vencimento indicada na Abertura de Contrato.
6.2. O pagamento da locação, será feito mensalmente, via boleto ou PIX, sempre devendo efetuar o pagamento antecipado, ou seja, pagamento antes da autorização de locação para aquele mês, e as demais vencíveis no mesmo dia dos meses subsequentes, durante todo o período de locação do aparelho celular, ficando a LOCADORA autorizada a cobrar os valores devidos diretamente, via instituições financeiras como SERASA, ainda que as obrigações tenham sido apuradas após o encerramento do Contrato, declarando-se o LOCATÁRIO, desde já, ciente das consequências previstas neste Contrato em caso de inadimplência;
6.2.1. Em caso de atraso no pagamento mensal estipulado, estará o LOCATÁRIO obrigado ao pagamento da multa diária de R$5,00 (cinco reais), limitada a 2% (dois por cento) do valor da parcela em atraso, sem prejuízo das demais cobranças e correções cabíveis.
6.2.2. Em caso de atraso de mais de 72 (setenta e duas) horas no pagamento, o APARELHO CELULAR será bloqueado remotamente, impedindo sua utilização, até que o débito seja devidamente quitado, sem prejuízo das demais cobranças e correções cabíveis.
6.2.3. Os valores deste Contrato (entrada, parcelas e taxas do Anexo III) são os combinados na assinatura e ficam fixos até o final, sem reajuste, mesmo que o prazo passe de doze meses;
6.2.4. Na hipótese de renovação da locação, o LOCATÁRIO obriga-se a quitar toda a locação anterior até o primeiro dia do novo período, mantidos os mesmos valores contratados;
6.2.5. A LOCADORA pode, a qualquer tempo, realizar cobranças de valores devidos e ainda não pagos. O não envio das cobranças na periodicidade contratada não desabona a responsabilidade do LOCATÁRIO de realizar os pagamentos a tempo e modo, conforme previsto nesse Contrato;
6.3. O valor total da locação é composto pela entrada e pelas parcelas indicadas na Abertura de Contrato, acrescido, se for o caso, dos valores previstos abaixo.
6.3.1. Em caso de quebra ou avaria do APARELHO CELULAR, inclusive se ele for devolvido danificado, o LOCATÁRIO pagará o valor do conserto, conforme orçamento da LOCADORA.
6.3.2. Em caso de furto ou roubo do APARELHO CELULAR, o LOCATÁRIO pagará o saldo das parcelas do Contrato que ainda não foram pagas, ficando então quitado o Contrato, sem outra cobrança pelo aparelho.
6.3.3. Em caso de furto ou roubo, o LOCATÁRIO deverá avisar a LOCADORA em até 24 (vinte e quatro) horas e apresentar o boletim de ocorrência em até 48 (quarenta e oito) horas. A LOCADORA bloqueará o APARELHO CELULAR assim que for avisada. Se o aviso ou o boletim de ocorrência não forem feitos nesses prazos, a situação será tratada como mau uso, nos termos da Cláusula Quinta.

CLÁUSULA SÉTIMA: DOS PRAZOS, ENTREGA E DEVOLUÇÃO DO APARELHO CELULAR
7.1. O período de locação é aquele indicado no termo de Abertura do Contrato e de acordo com o plano escolhido pelo Cliente, sendo o primeiro dia de locação coincidente com o dia da retirada do APARELHO CELULAR junto à LOCADORA, podendo ou não ser renovado;
7.2. Caso ocorra a devolução antecipada do APARELHO CELULAR, seja por vontade do LOCATÁRIO ou caso ele tenha dado causa conforme previsões contratuais, não há multa: aplica-se o previsto nas cláusulas 11.1.1 e 11.1.2, com a avaliação do aparelho e a devolução ao LOCATÁRIO de 30% (trinta por cento) do total pago.

CLÁUSULA OITAVA: RESPONSABILIDADE DA LOCADORA
8.1. Disponibilizar o APARELHO CELULAR em condições de uso e funcionamento, conforme descrito na Abertura de Contrato.
8.2. Havendo defeito de fábrica no APARELHO CELULAR durante o Contrato, a LOCADORA o consertará ou o trocará sem custo ao LOCATÁRIO, que deverá levá-lo à LOCADORA ou à assistência por ela indicada. Não se enquadram como defeito de fábrica os danos causados por queda, líquidos, mau uso ou reparo feito por terceiros, que seguem a cláusula 6.3.1.

CLÁUSULA NONA: RESPONSABILIDADE DO LOCATÁRIO
9.1. Além de todas as obrigações apontadas ao longo do presente termo, O LOCATÁRIO deverá zelar pelo aparelho e cumprir as obrigações financeiras.

CLÁUSULA DÉCIMA: RENOVAÇÃO DA LOCAÇÃO
10.1. Se o aparelho ainda não tiver sido transferido ao LOCATÁRIO nos termos da Cláusula Décima Quarta, a locação será prorrogada automática e sucessivamente por igual período até que sobrevenha comunicação do LOCATÁRIO informando a intenção de não renovar. Com a transferência do aparelho, a locação se encerra.

CLÁUSULA DECIMA PRIMEIRA: RESCISÃO
11.1. Se o LOCATÁRIO ficar mais de 30 (trinta) dias em atraso no pagamento de qualquer parcela, o Contrato poderá ser rescindido, independentemente de notificação, e a LOCADORA providenciará o bloqueio e a retomada do APARELHO CELULAR, sem direito de retenção por parte do LOCATÁRIO. O Contrato também poderá ser rescindido nas hipóteses de mau uso previstas na Cláusula Quinta.
11.1.1. Na retomada, a LOCADORA avaliará o APARELHO CELULAR. Estando o aparelho inteiro, sem danos além do desgaste normal de uso, devolverá ao LOCATÁRIO 30% (trinta por cento) do total que ele já pagou neste Contrato (entrada e parcelas). A entrada paga com aparelho na troca conta pelo valor da avaliação.
11.1.2. Havendo danos ao aparelho, a LOCADORA descontará do valor da cláusula 11.1.1 o custo do reparo, conforme a avaliação. Poderá também compensar com esse valor o que o LOCATÁRIO ainda deva à LOCADORA por força deste Contrato.

CLÁUSULA DÉCIMA SEGUNDA: DO TARIFÁRIO
12.1. Os valores de entrada, parcelas e taxas combinados na assinatura, constantes do Termo de Abertura e do Anexo III, não poderão ser reajustados pela LOCADORA até o final do Contrato. Mudanças no Tarifário valem apenas para contratos novos.

CLÁUSULA DÉCIMA TERCEIRA: TRATAMENTO DE DADOS PESSOAIS
13.1. No contexto deste Contrato, a LOCADORA trata dados pessoais referentes ao LOCATÁRIO na posição de controladora de dados pessoais, e pode compartilhar esses dados pessoais com terceiros, em conformidade com a LGPD.

CLÁUSULA DÉCIMA QUARTA: TRANSFERÊNCIA DO APARELHO AO FINAL DO PLANO (CESSÃO DE BEM MÓVEL)
14.1. Pagas todas as {{parcelas_qtd}} parcelas mensais do plano, e quitados os demais valores devidos neste Contrato, o APARELHO CELULAR passa a ser do LOCATÁRIO, sem necessidade de pedido, adesão ou pagamento adicional pela transferência, a título de cessão de bem móvel, já contada, como parte do pagamento do aparelho, a entrada paga na assinatura, seja em dinheiro ou com aparelho dado na troca.
14.1.1. O LOCATÁRIO pode antecipar parcelas ou quitar o saldo de uma vez, a qualquer momento. A transferência do aparelho ocorre assim que o último valor for pago, sem esperar o fim do prazo previsto.
14.2. Enquanto não ocorrer a transferência prevista na cláusula 14.1, o APARELHO CELULAR continua sendo de propriedade da LOCADORA.
14.3. Com a transferência, a LOCADORA libera o bloqueio e o monitoramento remotos do aparelho e entrega ao LOCATÁRIO o termo de quitação e transferência. A partir daí deixam de valer as restrições de uso, as taxas de locação e o direito de retomada previstos neste Contrato.

CLÁUSULA DÉCIMA QUINTA: DA AUSÊNCIA DE MULTA NA RESCISÃO
15.1. Este Contrato não prevê multa por rescisão nem por devolução antecipada do aparelho. Nesses casos aplica-se o previsto nas cláusulas 11.1.1 e 11.1.2.

CLÁUSULA DÉCIMA SEXTA: FORÇA MAIOR
16.1. Qualquer atraso ou falha no cumprimento deste contrato, ocasionado por motivo de força maior ou caso fortuito, conforme definido no Artigo 393 do Código Civil, não constituirá motivo de rescisão, exceto se tal evento perdurar por mais de 90 (noventa) dias.

CLÁUSULA DÉCIMA SÉTIMA: DISPOSIÇÕES GERAIS
17.1. O LOCATÁRIO concorda que a sua assinatura no Contrato deverá ser idêntica a do documento de identificação apresentado.
17.2. O LOCATÁRIO reconhece a forma de contratação por meio eletrônico e digital como válida e plenamente eficaz.
17.3. As comunicações e notificações da LOCADORA ao LOCATÁRIO serão feitas por WhatsApp, no telefone, e por e-mail, ambos informados na Abertura de Contrato, e valem como recebidas a partir do envio. O LOCATÁRIO deve avisar a LOCADORA se mudar de telefone ou de e-mail.

CLÁUSULA DÉCIMA OITAVA – FORO
18.1. As partes elegem o foro do domicílio do LOCATÁRIO para dirimirem quaisquer dúvidas do presente contrato.

{{empresa_cidade}}, {{data_venda}}

______________________________________________________
LOCADORA – {{empresa_nome}}
CNPJ: {{empresa_cnpj}}
______________________________________________________
LOCATÁRIO – {{cliente_nome}}
CPF/CNPJ: {{cliente_cpf}}
______________________________________________________
TESTEMUNHA 1
______________________________________________________
TESTEMUNHA 2

ANEXO III. TARIFÁRIO LOCADORA
DECLARAÇÃO DE CONHECIMENTO DOS VALORES CONTRATADOS

Eu, {{cliente_nome}}, CPF/CNPJ: {{cliente_cpf}}, RG: {{cliente_rg}}, residente e domiciliado(a) à {{cliente_endereco}}, doravante mencionado como LOCATÁRIO do CELULAR: {{aparelho_modelo}} {{aparelho_capacidade}}, marca Apple, Imei: {{aparelho_imei}}, declaro expressamente ter sido informado a respeito dos valores de cada um dos itens abaixo:

Valor de entrada (parte do preço do aparelho): {{entrada_valor}} (único)
Valor de locação Mensal: {{parcela_valor}} (mensal)
Danos ao aparelho (quebra ou avaria): valor do conserto, conforme orçamento (por evento)
Furto ou roubo do aparelho: saldo das parcelas ainda não pagas

Alterações estéticas no aparelho: vedadas, sob pena de multa de R$ 500,00 (quinhentos reais)

{{empresa_cidade}}, {{data_venda}}

_____________________________________________
LOCATÁRIO - {{cliente_nome}}

ANEXO IV. DECLARAÇÃO DE CONHECIMENTO DE MONITORAMENTO DO APARELHO CELULAR

Eu, {{cliente_nome}}, CPF/CNPJ: {{cliente_cpf}}, RG: {{cliente_rg}}, residente e domiciliado à {{cliente_endereco}}, doravante mencionado como LOCATÁRIO do CELULAR: {{aparelho_modelo}} {{aparelho_capacidade}}, marca Apple, Imei: {{aparelho_imei}}, declaro para todos os fins de direito:

i) ter sido amplamente informado de que o APARELHO CELULAR possui dispositivo para permitir seu imediato bloqueio, realizado remotamente, nos casos previstos em contrato;
ii) ter sido amplamente informado de que o atraso na devolução do APARELHO CELULAR, em casos específicos, poderá caracterizar o crime de apropriação indébita, e que o APARELHO CELULAR poderá ainda ser remotamente e automaticamente bloqueado pelo Sistema de rastreamento;
iii) ter sido amplamente informado que o inadimplemento das minhas obrigações financeiras junto à LOCADORA, especialmente atraso maior do que 72 hrs no pagamento devido, implicará no imediato bloqueio remoto do APARELHO CELULAR, sem prejuízo da cobrança dos valores devidos.

{{empresa_cidade}}, {{data_venda}}

_____________________________________________
LOCATÁRIO - {{cliente_nome}}`
