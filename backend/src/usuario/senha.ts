import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

/**
 * Hash de senha com scrypt (nativo do Node — sem dependência externa).
 * Formato guardado: "<salt hex>:<hash hex>". Verificação timing-safe.
 */
export function hashSenha(senha: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(senha, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function conferirSenha(senha: string, guardado: string): boolean {
  const [saltHex, hashHex] = (guardado ?? '').split(':');
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const esperado = Buffer.from(hashHex, 'hex');
  const teste = scryptSync(senha, salt, esperado.length);
  return esperado.length === teste.length && timingSafeEqual(esperado, teste);
}
