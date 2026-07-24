import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../auth/api-key.guard';
import { ContaService } from './conta.service';

/**
 * Gestão de LOJAS (multi-loja) — só ADMIN. Base: /v1/lojas
 * O registro é o conta_ifood; a loja precisa ter autorizado o app do Orzuni no iFood.
 */
@Controller('lojas')
@UseGuards(AdminGuard)
export class LojasController {
  constructor(private readonly contas: ContaService) {}

  @Get()
  async listar() {
    return { lojas: await this.contas.ativas() };
  }

  /** Lojas autorizadas no iFood que ainda dá para adicionar (descoberta). */
  @Get('disponiveis')
  async disponiveis() {
    return { lojas: await this.contas.descobrir() };
  }

  @Post()
  async adicionar(@Body() body: { merchantId: string; nome: string }) {
    return { ok: await this.contas.adicionar(body.merchantId, body.nome || 'loja') };
  }

  @Delete(':merchantId')
  async remover(@Param('merchantId') merchantId: string) {
    return { ok: await this.contas.remover(merchantId) };
  }
}
