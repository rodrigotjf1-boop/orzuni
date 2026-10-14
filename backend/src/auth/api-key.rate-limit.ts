import { Injectable } from '@nestjs/common';

/**
 * Teto de requisições POR CHAVE (janela deslizante de 60s, em memória).
 * Complementa o ThrottlerGuard global (por IP): um sistema que chama de vários
 * endereços não escapa do limite da própria chave.
 *
 * Em memória = vale para 1 instância (o orzuni-api roda como monólito único).
 * Se um dia escalar para várias instâncias, trocar por um store compartilhado.
 */
@Injectable()
export class ApiKeyRateLimit {
  private readonly janela = 60_000; // 1 min
  private readonly hits = new Map<string, number[]>(); // keyId → timestamps(ms)

  /** Registra um hit e diz se passou. Se estourou, quanto esperar (segundos). */
  checar(keyId: string, limitePorMin: number): { ok: boolean; retryAfter: number } {
    const agora = Date.now();
    const recentes = (this.hits.get(keyId) ?? []).filter((t) => agora - t < this.janela);
    if (recentes.length >= limitePorMin) {
      this.hits.set(keyId, recentes); // poda o que saiu da janela
      const retryAfter = Math.max(1, Math.ceil((this.janela - (agora - recentes[0])) / 1000));
      return { ok: false, retryAfter };
    }
    recentes.push(agora);
    this.hits.set(keyId, recentes);
    return { ok: true, retryAfter: 0 };
  }
}
