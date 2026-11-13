import { createHash, randomBytes } from 'node:crypto';

/**
 * "CONECTAR PELO REGEM" — as peças sem rede nem banco (plano "Clique Orzuni → Regem" do hub, 13/11/2026).
 *
 * O Orzuni é o APLICATIVO que pede (Padrão DMS §3): empurra o pedido ao Regem com o token do DMS ID (RFC 9126), manda o
 * dono à página do Regem com o número, e, na volta, troca o código pela ligação de cada loja que o presidente marcou.
 * O contrato é o do Regem (`docs/integracao-orzuni.md` de lá): PKCE S256, `state` preso a quem começou e `iss` na volta
 * (RFC 9207). Só as DUAS leituras que a chave colada já dava; nenhuma escrita.
 */

/** O que o Orzuni pede ao Regem: o cardápio e o preço do iFood. A ordem é a do catálogo do Regem. */
export const LEITURAS_DO_REGEM = ['catalogo.ler', 'catalogo.ifood.ler'] as const;

export const VALIDADE_DO_PEDIDO_MS = 10 * 60_000;

const CAMINHO_DA_PORTA = '/api/v1/integracao';
const CAMINHO_DA_PAGINA = '/integracoes/autorizar';
const CAMINHO_DA_VOLTA = '/importar/volta';

export type ConfigDoClique =
  | {
      ligado: true;
      /** A origem da API do Regem (é também o `iss` da volta). */
      api: string;
      /** O recurso do Regem no DMS ID (o destino do token): a API com `/api/v1/integracao`. */
      recurso: string;
      /** A página do Regem onde o presidente autoriza. */
      pagina: string;
      /** O endereço de volta do Orzuni, cadastrado na ficha dele no Regem. */
      volta: string;
      emissorDmsId: string;
      aplicativo: string;
      segredo: string;
    }
  | { ligado: false; motivo: string | null };

/** Endereço https (ou http da própria máquina, em teste), sem caminho, usuário nem fragmento. Devolve a origem. */
function origemDe(valor: string): string | null {
  try {
    const u = new URL(valor);
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return null;
    if (u.username || u.password || u.hash || u.search) return null;
    if (u.pathname !== '/' && u.pathname !== '') return null;
    return u.origin;
  } catch {
    return null;
  }
}

/**
 * A configuração, lida do ambiente (a distribuição configura no EasyPanel; nada disso é da conta):
 * - `ORZUNI_REGEM_CLIQUE=true` liga o botão (sem isso, a tela segue só com a chave colada);
 * - `ORZUNI_REGEM_BASE` (a API do Regem), `ORZUNI_REGEM_APP_URL` (o site do Regem) e `ORZUNI_APP_URL` (o site do
 *   Orzuni): os padrões são os de produção;
 * - `DMS_ID_EMISSOR`, `HUB_APLICATIVO` e `HUB_SEGREDO`: o aplicativo do Orzuni no DMS ID, o mesmo do hub.
 * Configuração torta não liga: o motivo vai ao log, para a distribuição.
 */
export function lerConfigDoClique(env: Record<string, string | undefined> = process.env): ConfigDoClique {
  const v = (env.ORZUNI_REGEM_CLIQUE ?? '').trim().toLowerCase();
  if (v !== 'true' && v !== '1' && v !== 'sim') return { ligado: false, motivo: null };
  const desligado = (motivo: string): ConfigDoClique => ({ ligado: false, motivo });

  const api = origemDe((env.ORZUNI_REGEM_BASE || 'https://api.dmsregem.com').trim());
  if (!api) return desligado('ORZUNI_REGEM_BASE precisa ser o endereço https da API do Regem, sem caminho');
  const site = origemDe((env.ORZUNI_REGEM_APP_URL || 'https://app.dmsregem.com').trim());
  if (!site) return desligado('ORZUNI_REGEM_APP_URL precisa ser o endereço https do site do Regem, sem caminho');
  const orzuni = origemDe((env.ORZUNI_APP_URL || 'https://app.orzuni.com').trim());
  if (!orzuni) return desligado('ORZUNI_APP_URL precisa ser o endereço https do site do Orzuni, sem caminho');

  const emissorDmsId = (env.DMS_ID_EMISSOR ?? '').trim().replace(/\/+$/, '');
  const aplicativo = (env.HUB_APLICATIVO ?? '').trim();
  const segredo = (env.HUB_SEGREDO ?? '').trim();
  for (const [nome, valor] of [
    ['DMS_ID_EMISSOR', emissorDmsId],
    ['HUB_APLICATIVO', aplicativo],
    ['HUB_SEGREDO', segredo],
  ] as const) {
    if (!valor) return desligado(`falta ${nome} (o aplicativo do Orzuni no DMS ID)`);
  }
  return {
    ligado: true,
    api,
    recurso: `${api}${CAMINHO_DA_PORTA}`,
    pagina: `${site}${CAMINHO_DA_PAGINA}`,
    volta: `${orzuni}${CAMINHO_DA_VOLTA}`,
    emissorDmsId,
    aplicativo,
    segredo,
  };
}

// ───────────────────────────── o pedido ─────────────────────────────

export const hashDoEstado = (estado: string): string => createHash('sha256').update(estado, 'utf8').digest('hex');

/** O `state` (preso a quem começou; só o resumo é guardado) e o par do PKCE (o verificador fica cifrado no banco). */
export function gerarPedido(): { estado: string; estadoHash: string; verificador: string; desafio: string } {
  const estado = randomBytes(32).toString('base64url');
  const verificador = randomBytes(48).toString('base64url');
  return {
    estado,
    estadoHash: hashDoEstado(estado),
    verificador,
    desafio: createHash('sha256').update(verificador, 'ascii').digest('base64url'),
  };
}

const FORMATO_DO_ESTADO = /^[A-Za-z0-9_-]{43}$/;
export const formatoDoEstado = (v: unknown): v is string => typeof v === 'string' && FORMATO_DO_ESTADO.test(v);

/**
 * Como a conta aparece na página do Regem: o nome da loja do iFood ligada a ela (decisão 4 do plano); sem loja, o que
 * vem antes do `@` do e-mail. O Regem aceita de 1 a 120 caracteres.
 */
export function nomeDaConta(lojaDoIfood: string | null | undefined, email: string): string {
  const loja = String(lojaDoIfood ?? '').trim();
  const nome = loja && loja !== 'loja' ? loja : email.split('@')[0] || 'Conta do Orzuni';
  return nome.slice(0, 120);
}

/** O corpo do pedido empurrado (`POST /integracao/autorizacao/pedido`). O Orzuni não tem CNPJ da conta: não manda. */
export function corpoDoPedido(d: { volta: string; estado: string; desafio: string; contaNome: string; contaEmail: string }): Record<string, string> {
  return {
    response_type: 'code',
    redirect_uri: d.volta,
    scope: LEITURAS_DO_REGEM.join(' '),
    state: d.estado,
    code_challenge: d.desafio,
    code_challenge_method: 'S256',
    conta_nome: d.contaNome,
    conta_email: d.contaEmail,
  };
}

const FORMATO_DO_NUMERO = /^urn:ietf:params:oauth:request_uri:rgm_[A-Za-z0-9_-]{43}$/;
export const formatoDoNumero = (v: unknown): v is string => typeof v === 'string' && FORMATO_DO_NUMERO.test(v);

/** A página do Regem com o número do pedido: é para lá que o navegador vai. */
export function urlDaPagina(pagina: string, aplicativo: string, numero: string): string {
  const u = new URL(pagina);
  u.searchParams.set('client_id', aplicativo);
  u.searchParams.set('request_uri', numero);
  return u.toString();
}

// ───────────────────────────── a volta ─────────────────────────────

export type Volta =
  | { tipo: 'codigo'; estado: string; codigo: string }
  | { tipo: 'recusa'; estado: string; motivo: 'recusado' | 'pedido_invalido' }
  | { tipo: 'invalida'; motivo: string };

const texto = (v: unknown) => (typeof v === 'string' ? v : '');

/**
 * Confere o que o navegador trouxe de volta, ANTES de ir ao banco. O `iss` tem de ser o do Regem (RFC 9207): sem ele ou
 * com outro, a volta não vale, mesmo com um `state` certo. O `state` tem a forma do que o Orzuni gera; o código, um
 * tamanho razoável (o Regem confere o resto na troca).
 */
export function conferirVolta(q: { code?: unknown; state?: unknown; iss?: unknown; error?: unknown }, emissorDoRegem: string): Volta {
  if (texto(q.iss) !== emissorDoRegem) return { tipo: 'invalida', motivo: 'a volta não veio do Regem' };
  if (!formatoDoEstado(q.state)) return { tipo: 'invalida', motivo: 'a volta veio sem o pedido que o Orzuni abriu' };
  const erro = texto(q.error);
  if (erro) return { tipo: 'recusa', estado: q.state, motivo: erro === 'access_denied' ? 'recusado' : 'pedido_invalido' };
  const codigo = texto(q.code);
  if (codigo.length < 20 || codigo.length > 300 || /\s/.test(codigo)) return { tipo: 'invalida', motivo: 'a volta veio sem o código da autorização' };
  return { tipo: 'codigo', estado: q.state, codigo };
}

// ───────────────────────────── a troca ─────────────────────────────

export type LojaLigada = { lojaId: string; nome: string; ligacao: string; prefixo: string | null; permissoes: string[] };

const FORMATO_DA_LIGACAO = /^dms_lg_regem_[A-Za-z0-9_-]{43}_[A-Za-z0-9_-]{6}$/;

/**
 * As lojas que a troca devolveu, conferidas: o segredo com a cara da ligação do Regem e a leitura do cardápio entre as
 * permissões. Resposta torta (ou sem loja nenhuma) devolve `null`: nada é guardado.
 */
export function lojasDaTroca(resposta: unknown): LojaLigada[] | null {
  const lista = (resposta as { lojas?: unknown } | null)?.lojas;
  if (!Array.isArray(lista) || !lista.length || lista.length > 200) return null;
  const saida: LojaLigada[] = [];
  const vistas = new Set<string>();
  for (const bruto of lista) {
    const l = bruto as Record<string, unknown> | null;
    const lojaId = texto(l?.loja_id).trim();
    const ligacao = texto(l?.ligacao);
    const permissoes = Array.isArray(l?.permissoes) ? (l?.permissoes as unknown[]).filter((p): p is string => typeof p === 'string') : [];
    if (!lojaId || lojaId.length > 100 || vistas.has(lojaId)) return null;
    if (!FORMATO_DA_LIGACAO.test(ligacao)) return null;
    if (!permissoes.includes('catalogo.ler')) return null;
    vistas.add(lojaId);
    saida.push({
      lojaId,
      nome: (texto(l?.loja_nome).trim() || 'Loja do Regem').slice(0, 200),
      ligacao,
      prefixo: texto(l?.prefixo).slice(0, 40) || null,
      permissoes: permissoes.slice(0, 20),
    });
  }
  return saida;
}

/**
 * A loja em uso depois da troca: a que já estava em uso, se o presidente a marcou de novo; senão a primeira (o Regem
 * devolve a matriz antes). Com mais de uma, a tela deixa trocar (decisão 2 do plano).
 */
export function lojaEmUso(lojas: readonly LojaLigada[], atual: string | null | undefined): LojaLigada {
  return lojas.find((l) => l.lojaId === atual) ?? (lojas[0] as LojaLigada);
}
