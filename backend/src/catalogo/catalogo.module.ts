import { Module } from '@nestjs/common';
import { IfoodModule } from '../ifood/ifood.module';
import { ContaModule } from '../conta/conta.module';
import { CatalogoService } from './catalogo.service';
import { CatalogoController } from './catalogo.controller';

@Module({
  imports: [IfoodModule, ContaModule],
  providers: [CatalogoService],
  controllers: [CatalogoController],
})
export class CatalogoModule {}
