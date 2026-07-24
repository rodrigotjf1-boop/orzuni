import { Global, Module } from '@nestjs/common';
import { ApiKeyService } from './api-key.service';
import { ApiKeyGuard, AdminGuard } from './api-key.guard';
import { ChavesController } from './chaves.controller';

/**
 * Autenticação da API aberta + gestão de chaves. Global para os guards estarem
 * disponíveis em todos os controllers via @UseGuards.
 */
@Global()
@Module({
  providers: [ApiKeyService, ApiKeyGuard, AdminGuard],
  controllers: [ChavesController],
  exports: [ApiKeyService, ApiKeyGuard, AdminGuard],
})
export class AuthModule {}
