import { Injectable } from '@nestjs/common';

export interface EventoTelemetria {
  ts: string; // ISO
  nivel: 'error' | 'warn' | 'info';
  origem: string; // 'ifood' | 'backend' | 'frontend'
  acao: string; // ex.: 'PUT /items', 'editar item'
  status?: number;
  mensagem: string;
  campo?: string; // campo que o iFood recusou (InvalidInput/InvalidFieldLength)
  requestId?: string; // requestId do iFood (para abrir chamado)
  merchant?: string;
}

/**
 * Telemetria do Orzuni — registro dos erros (principalmente os do iFood, com o
 * CAMPO e o requestId) para ficarmos cientes e corrigir sem precisar reproduzir.
 * Ring buffer em memória (últimos N); leve, sem dependência de banco.
 */
@Injectable()
export class TelemetriaService {
  private readonly max = 400;
  private eventos: EventoTelemetria[] = [];

  registrar(e: Omit<EventoTelemetria, 'ts'>) {
    this.eventos.unshift({ ts: new Date().toISOString(), ...e });
    if (this.eventos.length > this.max) this.eventos.length = this.max;
  }

  /** Registra a partir de uma resposta de erro do iFood ({error:{message,details,requestId}}). */
  registrarIfood(acao: string, status: number, data: any, merchant?: string) {
    const err = data?.error ?? {};
    const det = Array.isArray(err.details) ? err.details[0] : undefined;
    this.registrar({
      nivel: status >= 500 ? 'error' : 'warn',
      origem: 'ifood',
      acao,
      status,
      mensagem: det?.message ?? err.message ?? (typeof data === 'string' ? data : `HTTP ${status}`),
      campo: det?.field,
      requestId: err.requestId,
      merchant,
    });
  }

  listar(limite = 100): EventoTelemetria[] {
    return this.eventos.slice(0, Math.min(limite, this.max));
  }

  limpar(): number {
    const n = this.eventos.length;
    this.eventos = [];
    return n;
  }

  resumo(): { total: number; erros: number; ultimo: string | null } {
    return {
      total: this.eventos.length,
      erros: this.eventos.filter((e) => e.nivel === 'error').length,
      ultimo: this.eventos[0]?.ts ?? null,
    };
  }
}
