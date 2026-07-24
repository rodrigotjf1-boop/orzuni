import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { IfoodModule } from './ifood/ifood.module';
import { StoreModule } from './store/store.module';
import { ContaModule } from './conta/conta.module';
import { VigiaModule } from './vigia/vigia.module';
import { CatalogoModule } from './catalogo/catalogo.module';
import { AuthModule } from './auth/auth.module';

/**
 * orzuni-api — monólito com o poller do vigia DENTRO da API (@nestjs/schedule).
 * Rate limit global (ThrottlerGuard) protege contra brute-force de chave e DoS.
 */
@Module({
  imports: [
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]), // 120 req/min por IP
    StoreModule,
    AuthModule,
    IfoodModule,
    ContaModule,
    VigiaModule,
    CatalogoModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
