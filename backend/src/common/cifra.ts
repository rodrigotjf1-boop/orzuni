import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

/**
 * Cifra simétrica (AES-256-GCM) para segredos guardados no banco — ex.: o token
 * de integração do Regem. Nunca em claro, nunca no front, nunca em log.
 *
 * A chave de 32 bytes é derivada (scrypt) de `ORZUNI_CIFRA_SEGREDO` (ou, na falta,
 * de `ORZUNI_JWT_SECRET`). Formato guardado: `v1:<iv b64>:<tag b64>:<cifra b64>`.
 */
function chave(): Buffer {
  const base = process.env.ORZUNI_CIFRA_SEGREDO || process.env.ORZUNI_JWT_SECRET || '';
  if (!base) throw new Error('ORZUNI_CIFRA_SEGREDO/ORZUNI_JWT_SECRET ausente para cifrar segredos');
  return scryptSync(base, 'orzuni-cifra-v1', 32);
}

export function cifrar(texto: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', chave(), iv);
  const enc = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
  const tag = c.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

export function decifrar(guardado: string): string {
  const [v, ivB, tagB, encB] = (guardado || '').split(':');
  if (v !== 'v1' || !ivB || !tagB || !encB) throw new Error('segredo cifrado inválido');
  const d = createDecipheriv('aes-256-gcm', chave(), Buffer.from(ivB, 'base64'));
  d.setAuthTag(Buffer.from(tagB, 'base64'));
  return Buffer.concat([d.update(Buffer.from(encB, 'base64')), d.final()]).toString('utf8');
}
