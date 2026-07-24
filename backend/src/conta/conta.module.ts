import { Module } from '@nestjs/common';
import { IfoodModule } from '../ifood/ifood.module';
import { ContaService } from './conta.service';

@Module({
  imports: [IfoodModule],
  providers: [ContaService],
  exports: [ContaService],
})
export class ContaModule {}
