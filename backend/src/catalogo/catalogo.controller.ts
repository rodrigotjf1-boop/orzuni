import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { ContaService } from '../conta/conta.service';
import { CatalogoService } from './catalogo.service';
import type { DadosItem, DadosPizza, DadosCombo, Shift } from './validacao';

/**
 * API aberta do catálogo — modelo CANÔNICO (o ERP não conhece "iFood" nem ids).
 * Tudo casa por código de PDV. Base: /v1
 *
 * MULTI-LOJA: a loja é resolvida por requisição:
 *  1) chave de API ligada a uma loja → usa a dela (sem param, IDOR-proof);
 *  2) admin com ?loja=<merchantId> → aquela loja;
 *  3) senão → a única/primeira loja ativa.
 * NUNCA aceita merchantId arbitrário fora dessas regras.
 */
@Controller()
@UseGuards(ApiKeyGuard)
export class CatalogoController {
  constructor(
    private readonly catalogo: CatalogoService,
    private readonly contas: ContaService,
  ) {}

  private async merchant(req: any, loja?: string): Promise<string> {
    if (req?.contaMerchant) return req.contaMerchant; // chave ligada a uma loja
    const lojas = await this.contas.ativas();
    if (loja) {
      const l = lojas.find((x) => x.merchantId === loja);
      if (l) return l.merchantId;
    }
    return lojas[0]?.merchantId ?? '';
  }

  @Get('cardapio')
  async cardapio(@Req() req: any, @Query('loja') loja?: string) {
    return { itens: await this.catalogo.cardapio(await this.merchant(req, loja)) };
  }

  /** GET /v1/contextos — canais do catálogo (DEFAULT/INDOOR/WHITELABEL). */
  @Get('contextos')
  async contextos(@Req() req: any, @Query('loja') loja?: string) {
    return { contextos: await this.catalogo.contextos(await this.merchant(req, loja)) };
  }

  @Patch('precos')
  async precos(
    @Req() req: any,
    @Query('loja') loja: string | undefined,
    @Query('contexto') contexto: string | undefined,
    @Body() body: { itens: Array<{ pdv: string; preco: number; manterPromo?: boolean }> },
  ) {
    const r = await this.catalogo.reprecificar(await this.merchant(req, loja), body.itens ?? [], contexto || 'DEFAULT');
    return { batchId: r.batchId, ignorados: r.ignorados };
  }

  @Patch('itens/:pdv/status')
  async status(@Req() req: any, @Param('pdv') pdv: string, @Query('loja') loja: string | undefined, @Body() body: { status: 'no_ar' | 'pausado' }) {
    return this.catalogo.status(await this.merchant(req, loja), pdv, body.status);
  }

  /** PATCH /v1/status — pausa/reativa VÁRIOS itens numa chamada (em massa). */
  @Patch('status')
  async statusMassa(
    @Req() req: any,
    @Query('loja') loja: string | undefined,
    @Query('contexto') contexto: string | undefined,
    @Body() body: { itens: Array<{ pdv: string; status: 'no_ar' | 'pausado' }> },
  ) {
    return this.catalogo.statusEmMassa(await this.merchant(req, loja), body.itens ?? [], contexto || 'DEFAULT');
  }

  @Get('itens/:pdv')
  async detalhe(@Req() req: any, @Param('pdv') pdv: string, @Query('loja') loja?: string) {
    const d = await this.catalogo.detalhe(await this.merchant(req, loja), pdv);
    if (!d) return { erro: 'item não encontrado' };
    return d;
  }

  @Patch('itens/:pdv')
  async editar(
    @Req() req: any,
    @Param('pdv') pdv: string,
    @Query('loja') loja: string | undefined,
    @Body()
    body: {
      nome?: string;
      descricao?: string;
      preco?: number;
      status?: 'no_ar' | 'pausado';
      shifts?: Shift[];
      imagem?: string;
      pdv?: string;
      complementos?: Array<{ grupo: string; min: number; max: number; opcoes: Array<{ nome: string; preco?: number; pdv?: string; imagem?: string }> }>;
    },
  ) {
    return this.catalogo.editar(await this.merchant(req, loja), pdv, body);
  }

  /** POST /v1/itens/:pdv/duplicar — cria uma cópia independente do item ("(cópia)"). */
  @Post('itens/:pdv/duplicar')
  async duplicar(@Req() req: any, @Param('pdv') pdv: string, @Query('loja') loja?: string) {
    return this.catalogo.duplicar(await this.merchant(req, loja), pdv);
  }

  /** DELETE /v1/itens/:pdv — remove o item do cardápio (apaga o produto principal). */
  @Delete('itens/:pdv')
  async remover(@Req() req: any, @Param('pdv') pdv: string, @Query('loja') loja?: string) {
    return this.catalogo.remover(await this.merchant(req, loja), pdv);
  }

  /** GET /v1/complementos — grupos de complemento (INGREDIENTS) + itens onde aparecem. */
  @Get('complementos')
  async complementos(@Req() req: any, @Query('loja') loja?: string) {
    return { grupos: await this.catalogo.complementos(await this.merchant(req, loja)) };
  }

  /** PATCH /v1/complementos/opcao/:optionId/status — pausa/reativa UMA opção (cascateia p/ todos os itens do grupo). */
  @Patch('complementos/opcao/:optionId/status')
  async statusOpcao(@Req() req: any, @Param('optionId') optionId: string, @Query('loja') loja: string | undefined, @Body() body: { status: 'no_ar' | 'pausado' }) {
    return this.catalogo.statusOpcao(await this.merchant(req, loja), optionId, body.status);
  }

  /** PATCH /v1/complementos/:grupoId/status — pausa/reativa o grupo inteiro. */
  @Patch('complementos/:grupoId/status')
  async statusGrupo(@Req() req: any, @Param('grupoId') grupoId: string, @Query('loja') loja: string | undefined, @Body() body: { status: 'no_ar' | 'pausado' }) {
    return this.catalogo.statusGrupo(await this.merchant(req, loja), grupoId, body.status);
  }

  /** PATCH /v1/complementos/:grupoId — edita nome/min/max/opções do grupo em todos os itens. */
  @Patch('complementos/:grupoId')
  async editarGrupo(
    @Req() req: any,
    @Param('grupoId') grupoId: string,
    @Query('loja') loja: string | undefined,
    @Body() body: { nome: string; min: number; max: number; opcoes: Array<{ nome: string; preco?: number; pdv?: string; imagem?: string }> },
  ) {
    return this.catalogo.editarGrupo(await this.merchant(req, loja), grupoId, body);
  }

  /** DELETE /v1/complementos/:grupoId — remove o grupo (desanexa dos itens + apaga). */
  @Delete('complementos/:grupoId')
  async removerGrupo(@Req() req: any, @Param('grupoId') grupoId: string, @Query('loja') loja?: string) {
    return this.catalogo.removerGrupo(await this.merchant(req, loja), grupoId);
  }

  /** POST /v1/categorias — cria uma categoria (valida nome). */
  @Post('categorias')
  async criarCategoria(@Req() req: any, @Body() body: { nome: string; loja?: string }) {
    return this.catalogo.criarCategoria(await this.merchant(req, body.loja), body.nome);
  }

  /** POST /v1/itens — cria um item (simples ou com complementos). Valida antes. */
  @Post('itens')
  async criarItem(@Req() req: any, @Body() body: DadosItem & { loja?: string }) {
    return this.catalogo.criarItem(await this.merchant(req, body.loja), body);
  }

  /** POST /v1/pizzas — cria uma pizza (type PIZZA, 4 grupos SIZE/CRUST/EDGE/TOPPING). */
  @Post('pizzas')
  async criarPizza(@Req() req: any, @Body() body: DadosPizza & { loja?: string }) {
    return this.catalogo.criarPizza(await this.merchant(req, body.loja), body);
  }

  /** POST /v1/combos — cria um combo (type COMBO_V2, grupo principal + aninhados). */
  @Post('combos')
  async criarCombo(@Req() req: any, @Body() body: DadosCombo & { loja?: string }) {
    return this.catalogo.criarCombo(await this.merchant(req, body.loja), body);
  }

  @Get('lotes/:batchId')
  async lote(@Req() req: any, @Param('batchId') batchId: string, @Query('loja') loja?: string) {
    return this.catalogo.batch(await this.merchant(req, loja), batchId);
  }
}

