import type { HubService } from './hub.service';

/**
 * O que quem trata erro usa do hub, por um símbolo: assim o módulo de erro não
 * importa o `HubService` (nem, por ele, a configuração), e os testes que sobem
 * sem `env` continuam subindo.
 */
export const HUB_DOS_ERROS = Symbol('HUB_DOS_ERROS');
export type HubDosErros = Pick<HubService, 'ligado' | 'erro'>;
