import { Module } from '@nestjs/common';
import { IfoodModule } from '../ifood/ifood.module';
import { ContaModule } from '../conta/conta.module';
import { VigiaService } from './vigia.service';
import { VigiaPoller } from './vigia.poller';
import { VigiaController } from './vigia.controller';

@Module({
  imports: [IfoodModule, ContaModule],
  providers: [VigiaService, VigiaPoller],
  controllers: [VigiaController],
  exports: [VigiaService],
})
export class VigiaModule {}
