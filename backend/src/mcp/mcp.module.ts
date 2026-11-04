import { Module } from '@nestjs/common';

import { CatalogoModule } from '../catalogo/catalogo.module';
import { ContaModule } from '../conta/conta.module';
import { LojaModule } from '../loja/loja.module';
import { DmsIdController } from './dms-id.controller';
import { DmsIdService } from './dms-id.service';
import { IntegracaoGuard } from './integracao.guard';
import { LigacaoService } from './ligacao.service';
import { ManifestoController } from './manifesto.controller';
import { McpController } from './mcp.controller';
import { McpServidor } from './mcp.servidor';

/**
 * A porta MCP (produto DMS). Nasce DESLIGADA por `ORZUNI_MCP_ATIVO`. StoreService
 * e ApiKeyService vêm dos módulos @Global (StoreModule e AuthModule).
 */
@Module({
  imports: [CatalogoModule, LojaModule, ContaModule],
  controllers: [McpController, DmsIdController, ManifestoController],
  providers: [McpServidor, DmsIdService, LigacaoService, IntegracaoGuard],
})
export class McpModule {}
