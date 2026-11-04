/**
 * Configuração da porta MCP (via DMS ID). Nasce DESLIGADA: `ORZUNI_MCP_ATIVO`
 * liga a porta; sem isso, nada muda na API atual. Ligada, exige o emissor, o
 * recurso (o próprio endereço da porta, terminando em /v1/mcp) e o mapa de
 * aplicativos — o boot cai dizendo o que falta, nunca um 401 misterioso depois.
 *
 * `ACEITAR_INTEGRACOES=false` é a chave de emergência: recusa a porta na hora,
 * sem ir ao banco. O objeto `porta` é mutável para os testes fixarem o recurso
 * depois de o servidor de teste subir numa porta qualquer.
 */
export interface PortaConfig {
  ligado: boolean;
  emissor: string;
  recurso: string;
  aplicativos: Record<string, string>;
  aceitaIntegracoes: boolean;
}

export const porta: PortaConfig = { ligado: false, emissor: '', recurso: '', aplicativos: {}, aceitaIntegracoes: true };

function booleana(nome: string, padrao: boolean): boolean {
  const v = process.env[nome];
  if (v === undefined || v.trim() === '') return padrao;
  return /^(1|true|sim|on)$/i.test(v.trim());
}

/** Lê e valida as variáveis da porta. Chamado no boot (`main.ts`). */
export function carregarPorta(): void {
  const producao = process.env.NODE_ENV === 'production';
  const ligado = booleana('ORZUNI_MCP_ATIVO', false);
  const emissor = (process.env.DMS_ID_EMISSOR ?? '').trim();
  const recurso = (process.env.DMS_ID_RECURSO ?? '').trim();
  const aceitaIntegracoes = booleana('ACEITAR_INTEGRACOES', true);

  let aplicativos: Record<string, string> = {};
  const bruto = (process.env.DMS_ID_APLICATIVOS ?? '').trim();
  if (bruto) {
    let lido: unknown;
    try {
      lido = JSON.parse(bruto);
    } catch {
      throw new Error('DMS_ID_APLICATIVOS precisa ser um JSON, como {"regem":"<client_id do Regem no DMS ID>"}.');
    }
    const valido =
      lido !== null &&
      typeof lido === 'object' &&
      !Array.isArray(lido) &&
      Object.entries(lido).every(([p, id]) => /^[a-z][a-z0-9_-]{1,39}$/.test(p) && typeof id === 'string' && id.trim().length > 0);
    if (!valido) throw new Error('DMS_ID_APLICATIVOS precisa mapear produto → client_id, como {"regem":"<client_id>"}.');
    aplicativos = Object.fromEntries(Object.entries(lido as Record<string, string>).map(([p, id]) => [p, id.trim()]));
  }

  if (ligado) {
    for (const [nome, valor] of [['DMS_ID_EMISSOR', emissor], ['DMS_ID_RECURSO', recurso]] as const) {
      if (!valor) throw new Error(`ORZUNI_MCP_ATIVO está ligado e falta ${nome}. Veja docs/porta-mcp.md.`);
      if (!/^https?:\/\/\S+$/.test(valor) || (producao && !valor.startsWith('https://'))) {
        throw new Error(`${nome} precisa ser um endereço https:// (recebi "${valor}").`);
      }
    }
    if (new URL(recurso).pathname.replace(/\/+$/, '') !== '/v1/mcp') {
      throw new Error(`DMS_ID_RECURSO precisa ser o endereço da porta MCP, terminando em /v1/mcp (recebi "${recurso}").`);
    }
    if (!Object.keys(aplicativos).length) throw new Error('ORZUNI_MCP_ATIVO está ligado e falta DMS_ID_APLICATIVOS.');
  }

  Object.assign(porta, { ligado, emissor: emissor.replace(/\/+$/, ''), recurso: recurso.replace(/\/+$/, ''), aplicativos, aceitaIntegracoes });
}
