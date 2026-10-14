/**
 * Catálogo de permissões (escopos) das chaves de API da API aberta (/v1).
 * A chave de ADMIN (env ORZUNI_API_KEYS) ignora escopos — tem tudo.
 * Uma chave de tabela (ERP/CRM) só passa nas rotas cujos escopos ela possui.
 */
export const ESCOPOS = [
  'catalogo:ler', // ler cardápio, categorias, complementos, item, lotes
  'catalogo:escrever', // criar/editar/remover item, categoria, combo, pizza, complemento
  'preco:escrever', // alterar preço (item, opção, em massa)
  'status:escrever', // pausar/reativar (item, opção, grupo, em massa)
  'loja:ler', // status da loja, lojas vinculadas, pausas, horários
  'loja:escrever', // criar/remover pausa, salvar horário
  'vigia:ler', // alertas do vigia
  'vigia:escrever', // forçar varredura do vigia
] as const;

export type Escopo = (typeof ESCOPOS)[number];

/** Conjunto completo — usado para a chave antiga não parar e como validação. */
export const ESCOPOS_COMPLETOS: string[] = [...ESCOPOS];

/** Mantém só escopos conhecidos (defende contra lixo vindo da tela/ERP). */
export function escoposValidos(lista: unknown): string[] {
  if (!Array.isArray(lista)) return [];
  return lista.filter((e): e is string => typeof e === 'string' && (ESCOPOS_COMPLETOS as string[]).includes(e));
}
