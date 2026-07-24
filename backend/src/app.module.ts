import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { IfoodModule } from './ifood/ifood.module';
import { StoreModule } from './store/store.module';
import { ContaModule } from './conta/conta.module';
import { VigiaModule } from './vigia/vigia.module';
import { CatalogoModule } from './catalogo/catalogo.module';

/**
 * orzuni-api — monólito com o poller do vigia DENTRO da API (@nestjs/schedule).
 * Decisão registrada: começa junto, extrai worker separado quando o nº de lojas
 * fizer a varredura competir com as requisições. VigiaService já é isolado.
 */
@Module({
  imports: [
    ScheduleModule.forRoot(),
    StoreModule,
    IfoodModule,
    ContaModule,
    VigiaModule,
    CatalogoModule,
  ],
})
export class AppModule {}
