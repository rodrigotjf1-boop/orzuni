import { SetMetadata } from '@nestjs/common';

/** Chave de metadados com os escopos que a rota exige. */
export const ESCOPO_KEY = 'escoposRequeridos';

/**
 * Declara os escopos que uma rota exige da chave de API.
 *   @Requer('preco:escrever')
 * A chave precisa ter TODOS os escopos listados. A chave de admin (env) ignora.
 * Rota sem @Requer continua aberta a qualquer chave válida (retrocompatível).
 */
export const Requer = (...escopos: string[]) => SetMetadata(ESCOPO_KEY, escopos);
