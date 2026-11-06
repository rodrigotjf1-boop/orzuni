import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

import { enderecoInterno } from '../dms/integracao-dms';

/**
 * Guard anti-SSRF para endereço informado pelo USUÁRIO que o servidor vai buscar
 * (a base do Regem, para importar o cardápio). Padrão §9: resolve o nome e recusa
 * se QUALQUER endereço resolvido for interno/reservado/rede-local.
 *
 * Exige `https://`, sem usuário/senha, e nega localhost. Devolve a URL de
 * `/sync/catalogo` na MESMA origem (ignora qualquer caminho/query que o usuário
 * tenha colado). Lança `Error` com frase pt-BR em caso de recusa.
 */
export async function urlSyncCatalogoSegura(base: unknown): Promise<string> {
  if (typeof base !== 'string' || !base.trim()) throw new Error('informe o endereço do Regem');
  let u: URL;
  try {
    u = new URL(base.trim());
  } catch {
    throw new Error('endereço inválido');
  }
  if (u.protocol !== 'https:') throw new Error('o endereço precisa começar com https://');
  if (u.username || u.password) throw new Error('o endereço não pode ter usuário/senha');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost')) throw new Error('endereço não permitido');

  const ips: string[] = [];
  if (isIP(host)) {
    ips.push(host);
  } else {
    const res = await lookup(host, { all: true }).catch(() => [] as Array<{ address: string }>);
    for (const r of res) ips.push(r.address);
    if (!ips.length) throw new Error('não consegui resolver esse endereço');
  }
  // `enderecoInterno` devolve true para texto que não é IP — por isso só passamos IPs resolvidos.
  if (ips.some((ip) => enderecoInterno(ip))) throw new Error('endereço não permitido (aponta para rede interna)');

  return `${u.protocol}//${u.host}/sync/catalogo`;
}
