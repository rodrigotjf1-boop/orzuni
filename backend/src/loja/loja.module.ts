import { Module } from '@nestjs/common';
import { IfoodModule } from '../ifood/ifood.module';
import { ContaModule } from '../conta/conta.module';
import { LojaService } from './loja.service';
import { LojaController } from './loja.controller';

@Module({
  imports: [IfoodModule, ContaModule],
  providers: [LojaService],
  controllers: [LojaController],
})
export class LojaModule {}
