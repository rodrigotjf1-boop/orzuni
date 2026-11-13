import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';

import { SessaoGuard } from '../auth/sessao.guard';
import { ImportacaoRegemService } from './importacao-regem.service';
import { RegemCliqueService } from './regem-clique.service';

/**
 * Importar o cardápio do Regem para o iFood (app web, Fase 1). Só SESSÃO do dono
 * da conta (`SessaoGuard`); tudo pelo `tenant` da sessão (nunca do body). Base:
 * /v1/importar-regem. Nasce INERTE: sem conexão, nada acontece.
 *
 * A conexão nasce de dois jeitos: pela chave colada (`conectar`) ou pelo clique
 * ("Conectar pelo Regem", `clique/iniciar` e `clique/concluir`; migration 011,
 * atrás de `ORZUNI_REGEM_CLIQUE`).
 */
@Controller('importar-regem')
@UseGuards(SessaoGuard)
export class ImportacaoRegemController {
  constructor(
    private readonly svc: ImportacaoRegemService,
    private readonly clique: RegemCliqueService,
  ) {}

  /** A conexão está configurada? Por onde, com qual loja do Regem, última importação e resumo. */
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

  /** "Conectar pelo Regem": empurra o pedido ao Regem e devolve a página de lá para o navegador abrir. */
  @Post('clique/iniciar')
  async iniciar(@Req() req: any) {
    try {
      return { ok: true, ...(await this.clique.iniciar(req.usuario)) };
    } catch (e) {
      return { ok: false, erro: (e as Error).message };
    }
  }

  /** A volta do Regem: confere o pedido de quem começou e troca o código pela ligação de cada loja marcada. */
  @Post('clique/concluir')
  async concluir(@Req() req: any, @Body() body: { code?: unknown; state?: unknown; iss?: unknown; error?: unknown }) {
    try {
      return { ok: true, ...(await this.clique.concluir(req.usuario, body ?? {})) };
    } catch (e) {
      return { ok: false, erro: (e as Error).message };
    }
  }

  /** Troca a loja do Regem em uso, entre as que o presidente ligou a esta conta. */
  @Post('loja')
  async loja(@Req() req: any, @Body() body: { loja?: unknown }) {
    try {
      return { ok: true, loja: await this.clique.escolher(req.usuario.tenant, body?.loja) };
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
