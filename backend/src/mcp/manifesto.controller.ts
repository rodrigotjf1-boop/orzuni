/**
 * O MANIFESTO da porta (Padrão §13), SEM credencial: a documentação pública da
 * porta MCP. Fora do prefixo `/v1` (`ROTAS_FORA_DO_PREFIXO`), como os metadados.
 */
import { Controller, Get, Header } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';

import { CAMINHO_DO_MANIFESTO } from './ligacao.regras';
import { manifestoDaPorta } from './manifesto';

@Controller()
@SkipThrottle()
export class ManifestoController {
  @Get(CAMINHO_DO_MANIFESTO)
  @Header('Cache-Control', 'public, max-age=300')
  manifesto() {
    return manifestoDaPorta();
  }
}
