/**
 * A autorização por clique do Orzuni (Padrão DMS §3), regras puras — sem banco.
 *
 * O aplicativo empurra o pedido de servidor para servidor, com o token do DMS ID (RFC 9126), e recebe o número do
 * pedido; o navegador leva só esse número até `app.orzuni.com/autorizar`. O dono da conta escolhe a loja do iFood, liga
 * as opcionais e confirma com a senha; o Orzuni devolve um código de uso único ao endereço de volta, com o `state` e o
 * `iss` (RFC 9207); o aplicativo troca o código pela ligação, com o verificador do PKCE (RFC 7636).
 *
 * O número, o código e o segredo da ligação nunca vão para log, mensagem de erro nem banco (só o SHA-256).
 */
import { createHash, randomBytes, timingSafeEqual } from 'crypto';

import { classesDe, PERMISSOES } from './ligacao.regras';

export const VALIDADE_DO_PEDIDO_MS = 10 * 60_000;
export const VALIDADE_DO_CODIGO_MS = 10 * 60_000;
/** A versão do texto mostrado ao dono (guardado como prova). Mudou o texto, sobe o número. */
export const VERSAO_DO_TEXTO = 1;
export const MAX_ERROS_SENHA = 5;
export const MINUTOS_DA_TRAVA = 15;

// ───────────────────────────── o número do pedido, o código e o PKCE ─────────────────────────────

const PREFIXO_DO_PEDIDO = 'urn:ietf:params:oauth:request_uri:orz_';
const FORMATO_DO_PEDIDO = /^urn:ietf:params:oauth:request_uri:orz_[A-Za-z0-9_-]{43}$/;
const PREFIXO_DO_CODIGO = 'orz_ac_';
const FORMATO_DO_CODIGO = /^orz_ac_[A-Za-z0-9_-]{43}$/;
const FORMATO_DO_VERIFICADOR = /^[A-Za-z0-9\-._~]{43,128}$/;

/** SHA-256 em hex: é o que o banco guarda do número e do código. */
export const resumoDe = (v: string): string => createHash('sha256').update(v, 'utf8').digest('hex');

export function gerarPedido(): { numero: string; hash: string } {
  const numero = PREFIXO_DO_PEDIDO + randomBytes(32).toString('base64url');
  return { numero, hash: resumoDe(numero) };
}

/** Forma conferida SEM ir ao banco: o que não tem a cara de um número de pedido nem é procurado. */
export const formatoDoPedido = (v: unknown): v is string => typeof v === 'string' && FORMATO_DO_PEDIDO.test(v);

export function gerarCodigo(): { codigo: string; hash: string } {
  const codigo = PREFIXO_DO_CODIGO + randomBytes(32).toString('base64url');
  return { codigo, hash: resumoDe(codigo) };
}

export const formatoDoCodigo = (v: unknown): v is string => typeof v === 'string' && FORMATO_DO_CODIGO.test(v);

/** O verificador do PKCE confere com o desafio guardado? Compara os resumos em tempo constante. */
export function verificadorConfere(verificador: unknown, desafio: string): boolean {
  if (typeof verificador !== 'string' || !FORMATO_DO_VERIFICADOR.test(verificador)) return false;
  const calculado = createHash('sha256').update(verificador, 'ascii').digest('base64url');
  const a = createHash('sha256').update(calculado, 'utf8').digest();
  const b = createHash('sha256').update(String(desafio), 'utf8').digest();
  return timingSafeEqual(a, b);
}

/** O endereço de volta com os parâmetros da resposta (`code`, `state` e `iss`, ou `error`, `state` e `iss`). */
export function urlDeVolta(volta: string, params: Record<string, string>): string {
  const url = new URL(volta);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

// ───────────────────────────── os aplicativos do clique (o "cadastro") ─────────────────────────────

/**
 * O cadastro de cada aplicativo que pode pedir pelo clique: quem é, o que é necessário, o que é opcional e o motivo
 * que ele declara para cada permissão (Padrão §3). Hoje só o Regem (plano "Clique Regem → Orzuni", decisão OZ-3).
 * Aplicativo novo entra AQUI, com a lista dele no `DMS_ID_APLICATIVOS`.
 */
export interface AplicativoDoClique {
  nome: string;
  empresa: string;
  verificado: boolean;
  necessarias: readonly string[];
  opcionais: readonly string[];
  motivos: Readonly<Record<string, string>>;
  /** O que ele não pode, só com o que o servidor do Orzuni garante. */
  naoPode: readonly string[];
}

export const APLICATIVOS_DO_CLIQUE: Readonly<Record<string, AplicativoDoClique>> = {
  regem: {
    nome: 'Regem',
    empresa: 'DMS Tecnologias',
    verificado: true,
    necessarias: ['catalogo.ler', 'preco.escrever', 'status.escrever'],
    opcionais: ['catalogo.escrever', 'loja.ler', 'loja.escrever'],
    motivos: {
      'catalogo.ler': 'Para saber quais itens estão no iFood e com que preço.',
      'preco.escrever': 'Para mandar ao iFood o preço que você define no Regem.',
      'status.escrever': 'Para o "Em falta" e a pausa por canal do Regem chegarem ao iFood.',
      'catalogo.escrever': 'Para mandar ao iFood o nome, a descrição e a foto que você muda no Regem.',
      'loja.ler': 'Para ver se a loja está aberta ou pausada no iFood.',
      'loja.escrever': 'Para a pausa do iFood no painel do delivery do Regem chegar à loja.',
    },
    naoPode: [
      'Mexer em outra loja do iFood desta conta.',
      'Ver o financeiro do iFood ou os pedidos dos clientes.',
      'Ver ou guardar a sua senha do Orzuni.',
    ],
  },
};

const CATALOGO = new Map(PERMISSOES.map((p) => [p.id, p]));

/** Na ordem do catálogo do Orzuni, sem repetidas. */
export function naOrdemDoCatalogo(lista: readonly string[]): string[] {
  const set = new Set(lista);
  return PERMISSOES.filter((p) => set.has(p.id)).map((p) => p.id);
}

/** As permissões que um aplicativo da DMS pode ter (o teto da classe `dms`). */
const cabeNaClasseDms = (id: string): boolean => {
  const p = CATALOGO.get(id);
  return !!p && classesDe(p).includes('dms');
};

// ───────────────────────────── os endereços de volta ─────────────────────────────

/** Os endereços de volta de cada produto. A distribuição troca por `DMS_ID_VOLTAS` (JSON produto → lista). */
export const VOLTAS_PADRAO: Readonly<Record<string, readonly string[]>> = {
  regem: ['https://app.dmsregem.com/integracoes/orzuni/volta'],
};

/** https, ou http só para a própria máquina (desenvolvimento e teste); sem usuário, senha nem fragmento. */
function voltaAceitavel(u: string): boolean {
  try {
    const url = new URL(u);
    if (url.username || url.password || url.hash) return false;
    if (url.protocol === 'https:') return true;
    return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
  } catch {
    return false;
  }
}

/** Os endereços de volta aceitos para o produto (comparação exata na hora do pedido). */
export function voltasDoProduto(produto: string, env: NodeJS.ProcessEnv = process.env): string[] {
  let lista: readonly string[] = VOLTAS_PADRAO[produto] ?? [];
  const bruto = String(env.DMS_ID_VOLTAS ?? '').trim();
  if (bruto) {
    try {
      const lido = JSON.parse(bruto) as Record<string, unknown>;
      const doAmbiente = lido && typeof lido === 'object' ? lido[produto] : undefined;
      if (Array.isArray(doAmbiente)) lista = doAmbiente.map(String);
    } catch {
      /* JSON inválido: fica o padrão do código */
    }
  }
  return lista.filter(voltaAceitavel);
}

// ───────────────────────────── o pedido ─────────────────────────────

export interface ContaQuePede {
  nome: string;
  cnpj: string | null;
  email: string;
  marca: string | null;
  /** A loja do aplicativo que pede (no Regem, a loja em uso): é por ela que a página sabe o que já está ligado. */
  loja: string | null;
  loja_id: string | null;
}

export interface PedidoConferido {
  volta: string;
  estado: string;
  desafio: string;
  necessarias: string[];
  opcionais: string[];
  contaPede: ContaQuePede;
}

const texto = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/**
 * Confere o pedido que o aplicativo empurra. Devolve o que gravar, ou a frase do primeiro campo errado — para quem
 * programa o aplicativo, não para o dono da conta, que nunca vê esta resposta. Os campos são os do clique do Regem e do
 * RegemCast: o mesmo cliente fala com todos.
 */
export function conferirPedido(
  corpo: Record<string, unknown>,
  app: AplicativoDoClique,
  clientIdDoToken: string,
  voltas: readonly string[],
): PedidoConferido | { erro: string } {
  if (corpo.response_type !== 'code') return { erro: 'response_type precisa ser "code".' };
  if (corpo.client_id !== undefined && corpo.client_id !== clientIdDoToken) {
    return { erro: 'client_id não é o do token do DMS ID que fez o pedido.' };
  }
  const volta = texto(corpo.redirect_uri);
  if (!voltas.includes(volta)) return { erro: 'redirect_uri não é um endereço de volta cadastrado para este aplicativo.' };

  const pedidas = texto(corpo.scope).split(/\s+/).filter(Boolean);
  if (!pedidas.length) return { erro: 'scope precisa trazer ao menos uma permissão.' };
  if (new Set(pedidas).size !== pedidas.length) return { erro: 'scope tem permissão repetida.' };
  const podem = [...app.necessarias, ...app.opcionais];
  const fora = pedidas.find((p) => !podem.includes(p) || !cabeNaClasseDms(p));
  if (fora) return { erro: `A permissão "${fora}" não pode ser pedida por este aplicativo na autorização por clique.` };

  const estado = typeof corpo.state === 'string' ? corpo.state : '';
  if (!/^[\x21-\x7e]{16,200}$/.test(estado)) return { erro: 'state precisa ter de 16 a 200 caracteres visíveis.' };
  if (corpo.code_challenge_method !== 'S256') return { erro: 'code_challenge_method precisa ser "S256".' };
  const desafio = typeof corpo.code_challenge === 'string' ? corpo.code_challenge : '';
  if (!/^[A-Za-z0-9_-]{43}$/.test(desafio)) return { erro: 'code_challenge precisa ser o SHA-256 do verificador, em base64url (43 caracteres).' };

  const nome = texto(corpo.conta_nome);
  if (nome.length < 1 || nome.length > 120) return { erro: 'conta_nome precisa ter de 1 a 120 caracteres.' };
  const cnpjBruto = texto(corpo.conta_cnpj);
  const cnpj = cnpjBruto ? cnpjBruto.replace(/[.\-/\s]/g, '') : '';
  if (cnpj && !/^\d{14}$/.test(cnpj)) return { erro: 'conta_cnpj precisa ter 14 dígitos (ou ficar vazio).' };
  const email = texto(corpo.conta_email).toLowerCase();
  if (email.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { erro: 'conta_email precisa ser um e-mail.' };
  const marca = texto(corpo.conta_marca);
  if (marca.length > 120) return { erro: 'conta_marca pode ter até 120 caracteres.' };
  const loja = texto(corpo.conta_loja);
  if (loja.length > 120) return { erro: 'conta_loja pode ter até 120 caracteres.' };
  const lojaId = texto(corpo.conta_loja_id);
  if (lojaId && !/^[A-Za-z0-9_.:-]{1,64}$/.test(lojaId)) return { erro: 'conta_loja_id precisa ter até 64 letras, números ou _ . : -.' };

  return {
    volta,
    estado,
    desafio,
    necessarias: naOrdemDoCatalogo(pedidas.filter((p) => app.necessarias.includes(p))),
    opcionais: naOrdemDoCatalogo(pedidas.filter((p) => app.opcionais.includes(p))),
    contaPede: { nome, cnpj: cnpj || null, email, marca: marca || null, loja: loja || null, loja_id: lojaId || null },
  };
}

// ───────────────────────────── a decisão do dono ─────────────────────────────

/**
 * As opcionais que o dono ligou, conferidas: só as que o pedido trouxe. Liga = está na lista; o resto fica desligado
 * (nasce desligado, Padrão §3). Lista que não é de textos é ignorada (nada ligado).
 */
export function opcionaisLigadas(pedido: readonly string[], ligadas: unknown): string[] {
  const lista = Array.isArray(ligadas) ? ligadas.filter((x): x is string => typeof x === 'string') : [];
  return naOrdemDoCatalogo(pedido.filter((p) => lista.includes(p)));
}

/**
 * O que a ligação passa a ter na troca: o que ela já tinha (pedir mais é um pedido novo; a ligação continua com o que
 * tinha) somado ao que foi concedido agora, dentro do teto da classe `dms`. Na ordem do catálogo.
 */
export function escoposDaTroca(antigos: unknown, concedidas: readonly string[]): string[] {
  const velhos = Array.isArray(antigos) ? antigos.map(String) : [];
  return naOrdemDoCatalogo([...velhos, ...concedidas].filter(cabeNaClasseDms));
}

const soDigitos = (v: string | null | undefined): string => String(v ?? '').replace(/\D/g, '');

/** "11.222.333/0001-00"; o que não tem 14 dígitos sai nulo. */
export function cnpjComMascara(cnpj: string | null | undefined): string | null {
  const d = soDigitos(cnpj);
  if (d.length !== 14) return null;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

/** Uma permissão como a página mostra: a frase do catálogo, o motivo do aplicativo e se é necessária. */
export interface PermissaoDaTela {
  id: string;
  frase: string;
  motivo: string | null;
  necessaria: boolean;
  sensivel: boolean;
}

export function permissoesDaTela(app: AplicativoDoClique, necessarias: readonly string[], opcionais: readonly string[]): PermissaoDaTela[] {
  const nec = new Set(necessarias);
  return naOrdemDoCatalogo([...necessarias, ...opcionais]).map((id) => {
    const p = CATALOGO.get(id)!;
    return { id, frase: p.frase, motivo: app.motivos[id] ?? null, necessaria: nec.has(id), sensivel: p.sensivel };
  });
}

/**
 * O texto que o dono leu, guardado como prova da autorização (Padrão §3) e mostrado em "Aplicativos conectados".
 * Determinístico: o mesmo pedido e a mesma decisão dão o mesmo texto.
 */
export function textoDaAutorizacao(o: {
  app: AplicativoDoClique;
  contaPede: ContaQuePede;
  lojaNome: string;
  concedidas: readonly string[];
}): string {
  const cnpj = cnpjComMascara(o.contaPede.cnpj);
  const quem = [o.contaPede.nome, cnpj ? `CNPJ ${cnpj}` : 'sem CNPJ informado', o.contaPede.email].join(' · ');
  const linhas = [
    `${o.app.nome} (${o.app.empresa}${o.app.verificado ? ', verificado pela DMS' : ''}) pede acesso à sua conta do Orzuni.`,
    `Quem pede: ${quem}${o.contaPede.loja ? ` · loja ${o.contaPede.loja}` : ''}.`,
    `Onde vale: a loja do iFood "${o.lojaNome}".`,
    'O que ele vai poder fazer:',
    ...naOrdemDoCatalogo(o.concedidas).map((id) => `- ${CATALOGO.get(id)!.frase}${o.app.motivos[id] ? ` ${o.app.motivos[id]}` : ''}`),
    'O que ele não pode:',
    ...o.app.naoPode.map((n) => `- ${n}`),
    'Vale até você desligar, em "Aplicativos conectados" no Orzuni ou no próprio aplicativo.',
  ];
  return linhas.join('\n');
}
