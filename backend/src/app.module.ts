import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { IfoodModule } from './ifood/ifood.module';
import { StoreModule } from './store/store.module';
import { ContaModule } from './conta/conta.module';
import { VigiaModule } from './vigia/vigia.module';
import { CatalogoModule } from './catalogo/catalogo.module';
import { LojaModule } from './loja/loja.module';
import { AuthModule } from './auth/auth.module';
import { TelemetriaModule } from './telemetria/telemetria.module';

/**
 * orzuni-api — monólito com o poller do vigia DENTRO da API (@nestjs/schedule).
 * Rate limit global (ThrottlerGuard) protege contra brute-force de chave e DoS.
 */
@Module({
  imports: [
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]), // 120 req/min por IP
    TelemetriaModule,
    StoreModule,
    AuthModule,
    IfoodModule,
    ContaModule,
    VigiaModule,
    CatalogoModule,
    LojaModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
