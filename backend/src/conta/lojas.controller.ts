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
    // admin: mostra TODAS as conectadas, inclusive a loja de teste de integração (marcada)
    return { lojas: await this.contas.listarAdmin() };
  }

  /** Lojas autorizadas no iFood que ainda dá para adicionar (descoberta). */
  @Get('disponiveis')
  async disponiveis() {
    return { lojas: await this.contas.descobrir() };
  }

  @Post()
  async adicionar(@Body() body: { merchantId: string; nome: string; soIntegracao?: boolean }) {
    // soIntegracao = loja de teste do kit do hub (não varrida, invisível ao lojista)
    return { ok: await this.contas.adicionar(body.merchantId, body.nome || 'loja', body?.soIntegracao === true) };
  }

  @Delete(':merchantId')
  async remover(@Param('merchantId') merchantId: string) {
    return { ok: await this.contas.remover(merchantId) };
  }
}
