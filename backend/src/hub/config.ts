/**
 * Configuração do cliente do Hub DMS (`ClienteHub` do pacote comum). Nasce
 * DESLIGADA (`HUB_LIGADO=false`): sem ela, nada sai daqui e nada é parado pelo
 * hub. Ligada, exige o endereço do hub e o aplicativo "Orzuni" do DMS ID — o
 * boot cai dizendo o que falta, nunca um 401 misterioso depois.
 *
 * `ACEITAR_INTEGRACOES` é a chave de emergência do Padrão (§10): vale com ou sem
 * o hub; o portão da porta MCP já a aplica (503). O hub só precisa saber dela
 * para informar a batida.
 */
export interface HubConfig {
  ligado: boolean;
  url: string;
  recurso: string;
  emissor: string;
  aplicativo: string;
  segredo: string;
  versao: string;
  aceitaIntegracoes: boolean;
}

export const hub: HubConfig = { ligado: false, url: '', recurso: '', emissor: '', aplicativo: '', segredo: '', versao: '0.1.0', aceitaIntegracoes: true };

function booleana(nome: string, padrao: boolean): boolean {
  const v = (process.env[nome] ?? '').trim().toLowerCase();
  if (!v) return padrao;
  return v === 'true' || v === '1' || v === 'sim';
}

/** Lê o ambiente para o `hub`. Chamada no boot (main.ts), depois de `carregarPorta()`. */
export function carregarHub(): void {
  const ligado = booleana('HUB_LIGADO', false);
  const url = (process.env.HUB_URL ?? '').trim();
  const recurso = (process.env.HUB_RECURSO ?? '').trim();
  const emissor = (process.env.DMS_ID_EMISSOR ?? '').trim();
  const aplicativo = (process.env.HUB_APLICATIVO ?? '').trim();
  const segredo = (process.env.HUB_SEGREDO ?? '').trim();
  // a versão que o hub mostra: APP_VERSION, senão o commit (GIT_SHA do build Nixpacks no EasyPanel), senão o padrão.
  const versao = (process.env.APP_VERSION ?? '').trim() || (process.env.GIT_SHA ?? '').trim() || '0.1.0';
  const aceitaIntegracoes = booleana('ACEITAR_INTEGRACOES', true);

  if (ligado) {
    for (const [nome, valor] of [
      ['HUB_URL', url],
      ['HUB_RECURSO', recurso],
      ['DMS_ID_EMISSOR', emissor],
      ['HUB_APLICATIVO', aplicativo],
      ['HUB_SEGREDO', segredo],
    ] as const) {
      if (!valor) throw new Error(`HUB_LIGADO está ligado e falta ${nome}. Veja docs/porta-mcp.md.`);
    }
  }

  Object.assign(hub, { ligado, url, recurso, emissor, aplicativo, segredo, versao, aceitaIntegracoes });
}
