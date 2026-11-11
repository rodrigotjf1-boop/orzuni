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
    // recusa (ok:false) um merchant já conectado em outro tenant — evita a duplicata
    return this.contas.adicionar(body.merchantId, body.nome || 'loja', body?.soIntegracao === true);
  }

  // remove pelo ID da linha (conta_ifood.id), não pelo merchant: um merchant pode ter
  // mais de uma linha e revogar por merchant derrubaria a do piloto.
  @Delete(':id')
  async remover(@Param('id') id: string) {
    return { ok: await this.contas.remover(id) };
  }
}
