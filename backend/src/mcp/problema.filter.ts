/**
 * Filtro que transforma `ErroProblema` (do pacote comum) na resposta
 * `application/problem+json` do Padrão DMS (§7). Preserva os cabeçalhos que o
 * portão já pôs (WWW-Authenticate) e põe o Retry-After quando há.
 */
import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';

import { corpoProblema, ErroProblema, TIPO_CONTEUDO_PROBLEMA } from '../dms/integracao-dms';

@Catch(ErroProblema)
export class ProblemaFilter implements ExceptionFilter {
  catch(erro: ErroProblema, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    const req = http.getRequest<Request>();
    const requestId = (req.headers['x-request-id'] as string | undefined)?.trim() || randomUUID();
    if (erro.retryAfterSeg) res.setHeader('Retry-After', String(erro.retryAfterSeg));
    res.setHeader('x-request-id', requestId);
    res.setHeader('content-type', `${TIPO_CONTEUDO_PROBLEMA}; charset=utf-8`);
    res.status(erro.status).send(JSON.stringify(corpoProblema(erro.tipo, erro.detalhe, { status: erro.status, requestId })));
  }
}
