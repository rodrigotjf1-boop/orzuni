import { Module } from '@nestjs/common';
import { IfoodModule } from '../ifood/ifood.module';
import { ContaService } from './conta.service';
import { LojasController } from './lojas.controller';

@Module({
  imports: [IfoodModule],
  providers: [ContaService],
  controllers: [LojasController],
  exports: [ContaService],
})
export class ContaModule {}
