/**
 * O registro de cada chamada da porta MCP para o Hub DMS (Padrão §10).
 *
 * Abre a chamada atual (`chamada-atual.ts`) ANTES do portão, com o código do
 * pedido, que volta no cabeçalho `request-id`. Quando a resposta termina, monta
 * o registro com o que o portão, o filtro e a ferramenta anotaram e entrega ao
 * `HubService`, que só anota (o envio sai em lote, depois). Com o hub desligado,
 * só o cabeçalho `request-id`. NUNCA o conteúdo.
 *
 * Uma vez por pedido: o `forRoutes(...)` registra o middleware para CADA rota do
 * controlador e o `@All()` do 405 casa também com o POST — sem a marca, todo
 * POST abriria duas chamadas e iria duas vezes ao hub.
 */
import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { Request, Response } from 'express';

import { comChamada, ferramentaDoRegistro, montarChamada, novoCodigo, type ChamadaAtual } from './chamada-atual';
import { HubService } from './hub.service';

const JA_ABERTA = Symbol('registro-da-porta');

@Injectable()
export class RegistroDaPorta implements NestMiddleware {
  constructor(private readonly hub: HubService) {}

  use(req: Request, res: Response, next: (erro?: unknown) => void): void {
    const marcado = req as Request & { [JA_ABERTA]?: true };
    if (marcado[JA_ABERTA]) {
      next();
      return;
    }
    marcado[JA_ABERTA] = true;
    const chamada: ChamadaAtual = { codigo: novoCodigo(), inicio: Date.now() };
    res.setHeader('request-id', chamada.codigo);
    if (req.method === 'POST' || req.method === 'DELETE') res.once('close', () => this.registrar(chamada, req, res));
    comChamada(chamada, () => next());
  }

  /** O registro nunca derruba nada: a resposta já saiu. */
  private registrar(chamada: ChamadaAtual, req: Request, res: Response): void {
    if (!this.hub.ligado) return;
    try {
      if (!chamada.ferramenta) chamada.ferramenta = ferramentaDoRegistro(req.body);
      this.hub.registrar(montarChamada(chamada, res.statusCode, res.writableFinished, Date.now()));
      if (chamada.erro) this.hub.erro({ origem: 'backend', ...chamada.erro, codigo: chamada.codigo });
    } catch {
      /* só anota na memória; se nem isso deu, a chamada fica sem registro */
    }
  }
}
