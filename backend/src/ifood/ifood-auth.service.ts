import { Injectable, Logger } from '@nestjs/common';

/**
 * Autenticação com o iFood — modo CENTRALIZADO (client_credentials).
 *
 * Um único par clientId/clientSecret (do app do Orzuni, no .env) acessa TODAS as
 * lojas que autorizaram o app. O token dura ~6h; guardamos em memória com
 * renovação proativa (< 60 min do fim) e single-flight (uma renovação por vez,
 * nunca N chamadas pedindo token ao mesmo tempo).
 *
 * ⚠️ NÃO reaproveitar a coluna `integracao.token` do conector de PEDIDOS — este
 * cache é isolado, em memória, para os dois consumidores não corromperem o token
 * um do outro. O client_credentials aceita tokens simultâneos.
 *
 * Fatos confirmados em teste ao vivo (2026-07-24, app centralizado Sister C):
 * - POST /authentication/v1.0/oauth/token → { accessToken, type, expiresIn:21600 }
 * - o JWT traz os escopos no claim `aud` (catalog, order, merchant, …)
 * - 401 = token expirado (renova) · 403 = a loja revogou o app (só aquela conta)
 */
@Injectable()
export class IfoodAuthService {
  private readonly logger = new Logger('iFood/auth');
  private readonly base = process.env.IFOOD_BASE ?? 'https://merchant-api.ifood.com.br';
  private readonly clientId = process.env.IFOOD_CLIENT_ID ?? '';
  private readonly clientSecret = process.env.IFOOD_CLIENT_SECRET ?? '';

  private token: string | null = null;
  private expiresAt = 0; // epoch ms
  private inflight: Promise<string> | null = null;

  /** Retorna um accessToken válido, renovando de forma proativa e single-flight. */
  async getToken(): Promise<string> {
    const margem = 60 * 60 * 1000; // renova quando falta menos de 1h
    if (this.token && Date.now() < this.expiresAt - margem) return this.token;
    if (this.inflight) return this.inflight; // já tem uma renovação em curso
    this.inflight = this.renovar().finally(() => (this.inflight = null));
    return this.inflight;
  }

  private async renovar(): Promise<string> {
    if (!this.clientId || !this.clientSecret) {
      throw new Error('IFOOD_CLIENT_ID / IFOOD_CLIENT_SECRET ausentes no .env');
    }
    const res = await fetch(`${this.base}/authentication/v1.0/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grantType: 'client_credentials',
        clientId: this.clientId,
        clientSecret: this.clientSecret,
      }).toString(),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`token iFood ${res.status}: ${txt.slice(0, 200)}`);
    }
    const j = (await res.json()) as { accessToken: string; expiresIn?: number };
    this.token = j.accessToken;
    this.expiresAt = Date.now() + (Number(j.expiresIn) || 21600) * 1000;
    this.logger.log(`token renovado · escopos: ${this.escopos().join(', ')}`);
    return this.token;
  }

  /** Escopos do app (claim `aud` do JWT). Útil para diagnosticar "faltou acesso". */
  escopos(): string[] {
    if (!this.token) return [];
    try {
      const payload = JSON.parse(Buffer.from(this.token.split('.')[1], 'base64').toString());
      const aud = payload.aud;
      return Array.isArray(aud) ? aud : aud ? [aud] : [];
    } catch {
      return [];
    }
  }
}
