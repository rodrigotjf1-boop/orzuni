import { Global, Module } from '@nestjs/common';
import { StoreService } from './store.service';

/**
 * Store global. Hoje EM MEMÓRIA (espelha o schema de database/001_init.sql).
 * Trocar por Postgres (pg) quando o Supabase do Orzuni existir — a interface
 * já é a mesma que as tabelas conta_ifood / item_estado / alerta.
 */
@Global()
@Module({
  providers: [StoreService],
  exports: [StoreService],
})
export class StoreModule {}
