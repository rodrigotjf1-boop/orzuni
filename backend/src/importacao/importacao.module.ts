import { Module } from '@nestjs/common';

import { CatalogoModule } from '../catalogo/catalogo.module';
import { ContaModule } from '../conta/conta.module';
import { ImportacaoRegemController } from './importacao-regem.controller';
import { ImportacaoRegemService } from './importacao-regem.service';

/**
 * Importação do cardápio do Regem para o iFood (Fase 1). Usa o `CatalogoService`
 * (criar item no iFood) e o `ContaService` (a loja do tenant). `StoreService` e os
 * guards são globais.
 */
@Module({
  imports: [ContaModule, CatalogoModule],
  providers: [ImportacaoRegemService],
  controllers: [ImportacaoRegemController],
})
export class ImportacaoModule {}
