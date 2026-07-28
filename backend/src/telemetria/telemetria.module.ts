import { Global, Module } from '@nestjs/common';
import { TelemetriaService } from './telemetria.service';
import { TelemetriaController } from './telemetria.controller';

/** Global: o TelemetriaService fica injetável em qualquer módulo (ex.: cliente iFood). */
@Global()
@Module({
  providers: [TelemetriaService],
  controllers: [TelemetriaController],
  exports: [TelemetriaService],
})
export class TelemetriaModule {}
