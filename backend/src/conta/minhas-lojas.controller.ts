import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { SessaoGuard } from '../auth/sessao.guard';
import { ContaService } from './conta.service';

/**
 * As lojas do iFood DA CONTA do usuário logado (app web, Fase 0). Só sessão
 * (`SessaoGuard`) — um ERP por chave não conecta lojas a um tenant. Tudo é
 * resolvido pelo `tenant` da sessão; o usuário nunca informa o tenant.
 * Base: /v1/minhas-lojas
 */
@Controller('minhas-lojas')
@UseGuards(SessaoGuard)
export class MinhasLojasController {
  constructor(private readonly contas: ContaService) {}

  /** As lojas já conectadas à minha conta. */
  @Get()
  async listar(@Req() req: any) {
    return { lojas: await this.contas.ativasDoTenant(req.usuario.tenant) };
  }

  /** As lojas do iFood que eu ainda posso conectar (descoberta). */
  @Get('disponiveis')
  async disponiveis(@Req() req: any) {
    return { lojas: await this.contas.disponiveisParaTenant(req.usuario.tenant) };
  }

  /** Conecta uma loja à minha conta (carimba o meu tenant). */
  @Post()
  async conectar(@Req() req: any, @Body() body: { merchantId?: string; nome?: string }) {
    if (!body?.merchantId) return { ok: false, erro: 'informe a loja (merchantId)' };
    return this.contas.adicionarNoTenant(req.usuario.tenant, body.merchantId, body.nome || 'loja');
  }
}
