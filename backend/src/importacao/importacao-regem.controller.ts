import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';

import { SessaoGuard } from '../auth/sessao.guard';
import { ImportacaoRegemService } from './importacao-regem.service';

/**
 * Importar o cardápio do Regem para o iFood (app web, Fase 1). Só SESSÃO do dono
 * da conta (`SessaoGuard`); tudo pelo `tenant` da sessão (nunca do body). Base:
 * /v1/importar-regem. Nasce INERTE: sem conexão, nada acontece.
 */
@Controller('importar-regem')
@UseGuards(SessaoGuard)
export class ImportacaoRegemController {
  constructor(private readonly svc: ImportacaoRegemService) {}

  /** A conexão está configurada? Última importação e resumo. */
  @Get()
  status(@Req() req: any) {
    return this.svc.status(req.usuario.tenant);
  }

  /** Conecta a leitura do Regem (chave de integração). A base é fixa; o token é guardado cifrado. */
  @Post('conectar')
  async conectar(@Req() req: any, @Body() body: { token?: string }) {
    try {
      return await this.svc.conectar(req.usuario.tenant, body?.token ?? '');
    } catch (e) {
      return { ok: false, erro: (e as Error).message };
    }
  }

  /** Puxa o cardápio do Regem e cria no iFood só os que faltam (por código PDV). */
  @Post('executar')
  async executar(@Req() req: any) {
    try {
      return { ok: true, resumo: await this.svc.importar(req.usuario.tenant) };
    } catch (e) {
      return { ok: false, erro: (e as Error).message };
    }
  }
}
