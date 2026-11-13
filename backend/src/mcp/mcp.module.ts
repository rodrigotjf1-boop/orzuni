import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';

import { RegistroDaPorta } from '../hub/registro-da-porta.middleware';
import { CatalogoModule } from '../catalogo/catalogo.module';
import { ContaModule } from '../conta/conta.module';
import { LojaModule } from '../loja/loja.module';
import { UsuarioModule } from '../usuario/usuario.module';
import { AutorizacaoController } from './autorizacao.controller';
import { AutorizacaoService } from './autorizacao.service';
import { DmsIdController } from './dms-id.controller';
import { DmsIdService } from './dms-id.service';
import { IntegracaoGuard } from './integracao.guard';
import { LigacaoService } from './ligacao.service';
import { ManifestoController } from './manifesto.controller';
import { McpController } from './mcp.controller';
import { McpServidor } from './mcp.servidor';

/**
 * A porta MCP (produto DMS). Nasce DESLIGADA por `ORZUNI_MCP_ATIVO`. StoreService
 * e ApiKeyService vêm dos módulos @Global (StoreModule e AuthModule); o HubService,
 * do @Global HubModule. O `RegistroDaPorta` abre a chamada atual (registro do hub)
 * na porta MCP e na troca/revogação da ligação.
 */
@Module({
  imports: [CatalogoModule, LojaModule, ContaModule, UsuarioModule],
  controllers: [McpController, DmsIdController, ManifestoController, AutorizacaoController],
  providers: [McpServidor, DmsIdService, LigacaoService, IntegracaoGuard, RegistroDaPorta, AutorizacaoService],
})
export class McpModule implements NestModule {
  configure(consumidor: MiddlewareConsumer): void {
    consumidor.apply(RegistroDaPorta).forRoutes(McpController, DmsIdController);
  }
}
