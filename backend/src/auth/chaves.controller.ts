import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AdminGuard } from './api-key.guard';
import { ApiKeyService } from './api-key.service';

/**
 * Gestão das chaves de API (ERP/CRM). Só ADMIN (chave do painel) pode criar/listar/revogar.
 * Base: /v1/chaves
 */
@Controller('chaves')
@UseGuards(AdminGuard)
export class ChavesController {
  constructor(private readonly chaves: ApiKeyService) {}

  @Get()
  async listar() {
    return { chaves: await this.chaves.listar() };
  }

  /** Cria uma chave, opcionalmente ligada a uma loja. Segredo mostrado uma vez. */
  @Post()
  async criar(@Body() body: { nome: string; escopos?: string[]; loja?: string }) {
    const r = await this.chaves.criar(body.nome || 'Sem nome', body.escopos ?? [], body.loja);
    if (!r) return { erro: 'banco indisponível' };
    return r; // { chave, prefixo }
  }

  @Delete(':id')
  async revogar(@Param('id') id: string) {
    return { ok: await this.chaves.revogar(id) };
  }
}
