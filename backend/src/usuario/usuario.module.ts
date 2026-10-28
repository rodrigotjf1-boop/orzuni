import { Module } from '@nestjs/common';
import { UsuarioService } from './usuario.service';
import { AuthController } from './auth.controller';

/** Contas de usuário (cadastro + login). F1 da revenda. */
@Module({
  providers: [UsuarioService],
  controllers: [AuthController],
  exports: [UsuarioService],
})
export class UsuarioModule {}
