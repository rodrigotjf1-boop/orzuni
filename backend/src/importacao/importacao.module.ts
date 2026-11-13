import { Module } from '@nestjs/common';

import { CatalogoModule } from '../catalogo/catalogo.module';
import { ContaModule } from '../conta/conta.module';
import { ImportacaoRegemController } from './importacao-regem.controller';
import { ImportacaoRegemService } from './importacao-regem.service';
import { RegemCliqueService } from './regem-clique.service';

/**
 * Importação do cardápio do Regem para o iFood (Fase 1). Usa o `CatalogoService`
 * (criar item no iFood) e o `ContaService` (a loja do tenant). `StoreService` e os
 * guards são globais. O `RegemCliqueService` é o "Conectar pelo Regem" (a conexão
 * por clique, migration 011).
 */
@Module({
  imports: [ContaModule, CatalogoModule],
  providers: [ImportacaoRegemService, RegemCliqueService],
  controllers: [ImportacaoRegemController],
})
export class ImportacaoModule {}
