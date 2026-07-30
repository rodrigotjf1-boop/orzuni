import { Injectable, Logger } from '@nestjs/common';
import { IfoodAuthService } from './ifood-auth.service';
import { TelemetriaService } from '../telemetria/telemetria.service';

/**
 * Módulo Merchant do iFood (base /merchant/v1.0). Cobre os recursos exigidos na
 * homologação do módulo Merchant, provados ao vivo na loja de teste (2026-07-30):
 *  - lista/detalhe das lojas autorizadas ao app centralizado;
 *  - STATUS (se a loja pode receber pedidos + validações do porquê);
 *  - INTERRUPÇÕES (pausa programada): criar (POST), listar (GET), cancelar (DELETE)
 *    — atenção: o iFood recusa DELETE logo após criar (RecentlyCreatedInterruption);
 *  - HORÁRIO DE FUNCIONAMENTO: listar (GET) e salvar (PUT) por dia da semana.
 */
@Injectable()
export class IfoodMerchantService {
  private readonly logger = new Logger('iFood/merchant');
  private readonly base =
    (process.env.IFOOD_BASE ?? 'https://merchant-api.ifood.com.br') + '/merchant/v1.0';

  constructor(
    private readonly auth: IfoodAuthService,
    private readonly tel: TelemetriaService,
  ) {}

  private async req<T>(method: string, path: string, body?: unknown, tentativa = 0): Promise<{ status: number; data: T }> {
    const token = await this.auth.getToken();
    let res: Response;
    try {
      res = await fetch(`${this.base}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (e: any) {
      if (tentativa < 3) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** tentativa));
        return this.req<T>(method, path, body, tentativa + 1);
      }
      throw e;
    }
    // 401 → renova o token uma vez e repete
    if (res.status === 401 && tentativa === 0) {
      this.auth.invalidar();
      return this.req<T>(method, path, body, tentativa + 1);
    }
    // 5xx → backoff exponencial (1s, 2s, 4s), no máx. 3 tentativas
    if (res.status >= 500 && tentativa < 3) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** tentativa));
      return this.req<T>(method, path, body, tentativa + 1);
    }
    const text = await res.text();
    const data = (text ? JSON.parse(text) : null) as T;
    if (!res.ok) {
      this.logger.warn(`${method} ${path} → ${res.status}: ${text.slice(0, 160)}`);
      // GET 4xx é leitura/estado normal; guarda mutações e 5xx
      const ruido = method === 'GET' && res.status < 500;
      if (!ruido) this.tel.registrarIfood(`${method} ${path.replace(/\/merchants\/[0-9a-f-]{36}/i, '')}`, res.status, data, path.match(/merchants\/([0-9a-f-]{36})/i)?.[1]);
    }
    return { status: res.status, data };
  }

  /** Lojas autorizadas para o app (id + nome + corporateName). Paginação opcional (page/size). */
  async merchants(page?: number, size?: number): Promise<Array<{ id: string; name: string; corporateName?: string }>> {
    const qs = page || size ? `?page=${page ?? 1}&size=${size ?? 100}` : '';
    const { status, data } = await this.req<Array<{ id: string; name: string; corporateName?: string }>>('GET', `/merchants${qs}`);
    return status === 200 && Array.isArray(data) ? data : [];
  }

  /** Detalhes da loja (nome, tipo, endereço, status cadastral, operações). */
  async detalhe(merchantId: string): Promise<any | null> {
    const { status, data } = await this.req<any>('GET', `/merchants/${merchantId}`);
    return status === 200 ? data : null;
  }

  /** Status operacional: se a loja pode receber pedidos + validações (por canal/operação). */
  async status(merchantId: string): Promise<any[]> {
    const { status, data } = await this.req<any[]>('GET', `/merchants/${merchantId}/status`);
    return status === 200 && Array.isArray(data) ? data : [];
  }

  /** Interrupções (pausas) ativas/programadas. */
  async interrupcoes(merchantId: string): Promise<any[]> {
    const { status, data } = await this.req<any[]>('GET', `/merchants/${merchantId}/interruptions`);
    return status === 200 && Array.isArray(data) ? data : [];
  }

  /** Cria uma interrupção (pausa) por período. `start`/`end` em ISO 8601. */
  async criarInterrupcao(merchantId: string, body: { description: string; start: string; end: string }): Promise<{ status: number; data: any }> {
    return this.req('POST', `/merchants/${merchantId}/interruptions`, body);
  }

  /** Cancela uma interrupção. iFood recusa (409) logo após criar (RecentlyCreatedInterruption). */
  async removerInterrupcao(merchantId: string, id: string): Promise<{ status: number; data: any }> {
    return this.req('DELETE', `/merchants/${merchantId}/interruptions/${id}`);
  }

  /** Horário de funcionamento (turnos por dia da semana). */
  async openingHours(merchantId: string): Promise<{ storeId: string; shifts: any[] } | null> {
    const { status, data } = await this.req<{ storeId: string; shifts: any[] }>('GET', `/merchants/${merchantId}/opening-hours`);
    return status === 200 ? data : null;
  }

  /** Salva o horário de funcionamento (PUT substitui todos os turnos). */
  async salvarOpeningHours(merchantId: string, shifts: Array<{ dayOfWeek: string; start: string; duration: number }>): Promise<{ status: number; data: any }> {
    return this.req('PUT', `/merchants/${merchantId}/opening-hours`, { storeId: merchantId, shifts });
  }
}
