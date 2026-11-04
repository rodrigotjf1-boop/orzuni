/**
 * O catálogo de ferramentas da porta MCP do Orzuni. Cada ferramenta curada
 * traduz UMA tarefa para o serviço REST que já existe (catálogo/loja/vigia),
 * sempre na loja da ligação (`quem.merchantId`). Ferramenta nova entra aqui, com
 * o escopo dela no catálogo de permissões (`ligacao.regras.ts`).
 *
 * As que gravam levam o argumento `chaveIdempotencia` (8–100) e passam por
 * `escrita()`: a mesma chave com o mesmo pedido devolve a mesma resposta.
 */
import * as z from 'zod/v4';

import { escrita, type Ferramenta, LEITURA, naConta, resposta } from './mcp.ferramenta';
import { LIMITE_POR_MINUTO, PERMISSOES } from './ligacao.regras';
import type { IntegracaoAutenticada } from './ligacao.service';

const CHAVE_IDEMPOTENCIA = z.string().min(8).max(100).describe('Uma chave única desta ação (8 a 100 caracteres): repetir com a mesma chave não grava de novo.');
const CODIGO_PDV = z.string().min(1).max(100).describe('O código de PDV do produto (a chave de ligação com o iFood).');

/** Quem sou eu: a primeira chamada de quem integra. Não lê nada da loja além do id. */
const integracaoSituacao: Ferramenta = {
  nome: 'integracao_situacao',
  escopo: null,
  registrar(servidor, { quem }) {
    servidor.registerTool(
      'integracao_situacao',
      {
        title: 'Situação da integração',
        description:
          'Diz para qual loja do Orzuni (o merchant do iFood) este token vale, qual produto o token identifica e o que pode fazer. Use para conferir a conexão antes de qualquer outra ferramenta.',
        inputSchema: z.object({}),
        annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      },
      async () =>
        resposta({
          loja: quem.merchantId,
          produto: quem.produto,
          classe: quem.classe,
          permissoes: quem.escopos.map((id) => ({ id, frase: PERMISSOES.find((p) => p.id === id)?.frase ?? id })),
          limitePorMinuto: LIMITE_POR_MINUTO,
        }),
    );
  },
};

// ----------------------------------------------------------------- leitura

const cardapioListar: Ferramenta = {
  nome: 'cardapio_listar',
  escopo: 'catalogo.ler',
  registrar(servidor, c) {
    servidor.registerTool(
      'cardapio_listar',
      {
        title: 'Listar o cardápio',
        description: 'Lista os itens do cardápio da loja no iFood, cada um com o código de PDV, o preço e se está no ar ou pausado.',
        inputSchema: z.object({}),
        annotations: LEITURA,
      },
      async () => naConta('cardapio_listar', async () => ({ itens: await c.servicos.catalogo.cardapio(c.quem.merchantId) })),
    );
  },
};

const categoriasListar: Ferramenta = {
  nome: 'categorias_listar',
  escopo: 'catalogo.ler',
  registrar(servidor, c) {
    servidor.registerTool(
      'categorias_listar',
      { title: 'Listar categorias', description: 'As categorias do cardápio da loja no iFood, inclusive as vazias.', inputSchema: z.object({}), annotations: LEITURA },
      async () => naConta('categorias_listar', async () => ({ categorias: await c.servicos.catalogo.categorias(c.quem.merchantId) })),
    );
  },
};

const itemLer: Ferramenta = {
  nome: 'item_ler',
  escopo: 'catalogo.ler',
  registrar(servidor, c) {
    servidor.registerTool(
      'item_ler',
      { title: 'Ler um item', description: 'O detalhe de um item do cardápio pelo código de PDV: nome, descrição, preço, situação e complementos.', inputSchema: z.object({ codigo_pdv: CODIGO_PDV }), annotations: LEITURA },
      async ({ codigo_pdv }) =>
        naConta('item_ler', async () => {
          const d = await c.servicos.catalogo.detalhe(c.quem.merchantId, codigo_pdv);
          return d ?? { erro: 'item não encontrado' };
        }),
    );
  },
};

const complementosListar: Ferramenta = {
  nome: 'complementos_listar',
  escopo: 'catalogo.ler',
  registrar(servidor, c) {
    servidor.registerTool(
      'complementos_listar',
      { title: 'Listar complementos', description: 'Os grupos de complemento (adicionais/opções) da loja no iFood e os itens em que aparecem.', inputSchema: z.object({}), annotations: LEITURA },
      async () => naConta('complementos_listar', async () => ({ grupos: await c.servicos.catalogo.complementos(c.quem.merchantId) })),
    );
  },
};

const alertasListar: Ferramenta = {
  nome: 'alertas_listar',
  escopo: 'vigia.ler',
  registrar(servidor, c) {
    servidor.registerTool(
      'alertas_listar',
      { title: 'Alertas do vigia', description: 'Os itens que estão fora do ar no iFood e há quanto tempo (o que o iFood não diz). Mostra o motivo da queda.', inputSchema: z.object({}), annotations: LEITURA },
      async () =>
        naConta('alertas_listar', async () => {
          const agora = Date.now();
          const alertas = (await c.servicos.store.listarAlertas(c.quem.merchantId)).map((a) => ({
            pdv: a.externalCode,
            nome: a.nome,
            motivo: a.motivo,
            grupoAfetado: a.grupoAfetado ?? null,
            desde: new Date(a.caiuEm).toISOString(),
            foraHaMs: agora - a.caiuEm,
          }));
          return { alertas };
        }),
    );
  },
};

const lojaStatusLer: Ferramenta = {
  nome: 'loja_status_ler',
  escopo: 'loja.ler',
  registrar(servidor, c) {
    servidor.registerTool(
      'loja_status_ler',
      { title: 'Situação da loja', description: 'O detalhe e a situação da loja no iFood (aberta, fechada, pausada).', inputSchema: z.object({}), annotations: LEITURA },
      async () => naConta('loja_status_ler', async () => c.servicos.loja.painel(c.quem.merchantId)),
    );
  },
};

const lojaHorariosLer: Ferramenta = {
  nome: 'loja_horarios_ler',
  escopo: 'loja.ler',
  registrar(servidor, c) {
    servidor.registerTool(
      'loja_horarios_ler',
      { title: 'Horários da loja', description: 'O horário de funcionamento da loja no iFood.', inputSchema: z.object({}), annotations: LEITURA },
      async () => naConta('loja_horarios_ler', async () => c.servicos.loja.horarios(c.quem.merchantId)),
    );
  },
};

// ----------------------------------------------------------------- escrita

const precoDefinir: Ferramenta = {
  nome: 'preco_definir',
  escopo: 'preco.escrever',
  registrar(servidor, c) {
    servidor.registerTool(
      'preco_definir',
      {
        title: 'Definir o preço de um item',
        description: 'Muda o preço de UM item no iFood, pelo código de PDV. O valor vai em reais (ex.: 29.90).',
        inputSchema: z.object({ codigo_pdv: CODIGO_PDV, valor: z.number().positive().describe('O preço em reais.'), chaveIdempotencia: CHAVE_IDEMPOTENCIA }),
      },
      async ({ codigo_pdv, valor, chaveIdempotencia }) =>
        escrita(c.quem, 'preco_definir', chaveIdempotencia, { codigo_pdv, valor }, () => c.servicos.catalogo.precoItem(c.quem.merchantId, codigo_pdv, valor)),
    );
  },
};

const precosEmMassa: Ferramenta = {
  nome: 'precos_em_massa',
  escopo: 'preco.escrever',
  registrar(servidor, c) {
    servidor.registerTool(
      'precos_em_massa',
      {
        title: 'Mudar preços em massa',
        description: 'Muda o preço de VÁRIOS itens de uma vez no iFood, por código de PDV (reprecificação em lote). Devolve um batchId para acompanhar.',
        inputSchema: z.object({
          itens: z.array(z.object({ codigo_pdv: CODIGO_PDV, valor: z.number().positive(), manter_promo: z.boolean().optional() })).min(1).max(500),
          contexto: z.string().optional().describe('O canal do catálogo (DEFAULT, INDOOR…). Padrão: DEFAULT.'),
          chaveIdempotencia: CHAVE_IDEMPOTENCIA,
        }),
      },
      async ({ itens, contexto, chaveIdempotencia }) =>
        escrita(c.quem, 'precos_em_massa', chaveIdempotencia, { itens, contexto }, () =>
          c.servicos.catalogo.reprecificar(
            c.quem.merchantId,
            itens.map((i) => ({ pdv: i.codigo_pdv, preco: i.valor, manterPromo: i.manter_promo })),
            contexto || 'DEFAULT',
          ),
        ),
    );
  },
};

const itemPausar: Ferramenta = {
  nome: 'item_pausar',
  escopo: 'status.escrever',
  registrar(servidor, c) {
    servidor.registerTool(
      'item_pausar',
      { title: 'Pausar um item', description: 'Pausa (tira do ar) UM item no iFood, pelo código de PDV.', inputSchema: z.object({ codigo_pdv: CODIGO_PDV, chaveIdempotencia: CHAVE_IDEMPOTENCIA }) },
      async ({ codigo_pdv, chaveIdempotencia }) =>
        escrita(c.quem, 'item_pausar', chaveIdempotencia, { codigo_pdv }, () => c.servicos.catalogo.statusItem(c.quem.merchantId, codigo_pdv, 'pausado')),
    );
  },
};

const itemReativar: Ferramenta = {
  nome: 'item_reativar',
  escopo: 'status.escrever',
  registrar(servidor, c) {
    servidor.registerTool(
      'item_reativar',
      { title: 'Reativar um item', description: 'Reativa (põe no ar) UM item no iFood, pelo código de PDV.', inputSchema: z.object({ codigo_pdv: CODIGO_PDV, chaveIdempotencia: CHAVE_IDEMPOTENCIA }) },
      async ({ codigo_pdv, chaveIdempotencia }) =>
        escrita(c.quem, 'item_reativar', chaveIdempotencia, { codigo_pdv }, () => c.servicos.catalogo.statusItem(c.quem.merchantId, codigo_pdv, 'no_ar')),
    );
  },
};

const complementoPausar: Ferramenta = {
  nome: 'complemento_pausar',
  escopo: 'status.escrever',
  registrar(servidor, c) {
    servidor.registerTool(
      'complemento_pausar',
      { title: 'Pausar uma opção de complemento', description: 'Pausa uma opção (complemento) no iFood, pelo id da opção. Cascateia para todos os itens do grupo.', inputSchema: z.object({ opcao_id: z.string().min(1).describe('O id da opção no iFood (veja complementos_listar).'), chaveIdempotencia: CHAVE_IDEMPOTENCIA }) },
      async ({ opcao_id, chaveIdempotencia }) =>
        escrita(c.quem, 'complemento_pausar', chaveIdempotencia, { opcao_id }, () => c.servicos.catalogo.statusOpcao(c.quem.merchantId, opcao_id, 'pausado')),
    );
  },
};

const complementoReativar: Ferramenta = {
  nome: 'complemento_reativar',
  escopo: 'status.escrever',
  registrar(servidor, c) {
    servidor.registerTool(
      'complemento_reativar',
      { title: 'Reativar uma opção de complemento', description: 'Reativa uma opção (complemento) no iFood, pelo id da opção.', inputSchema: z.object({ opcao_id: z.string().min(1).describe('O id da opção no iFood.'), chaveIdempotencia: CHAVE_IDEMPOTENCIA }) },
      async ({ opcao_id, chaveIdempotencia }) =>
        escrita(c.quem, 'complemento_reativar', chaveIdempotencia, { opcao_id }, () => c.servicos.catalogo.statusOpcao(c.quem.merchantId, opcao_id, 'no_ar')),
    );
  },
};

const interrupcaoCriar: Ferramenta = {
  nome: 'interrupcao_criar',
  escopo: 'loja.escrever',
  registrar(servidor, c) {
    servidor.registerTool(
      'interrupcao_criar',
      {
        title: 'Pausar a loja (interrupção)',
        description: 'Cria uma pausa programada da LOJA inteira no iFood (não de um item), com início e fim em ISO 8601.',
        inputSchema: z.object({
          inicio: z.string().describe('Início da pausa, em ISO 8601.'),
          fim: z.string().describe('Fim da pausa, em ISO 8601.'),
          descricao: z.string().max(200).optional().describe('O motivo da pausa (opcional).'),
          chaveIdempotencia: CHAVE_IDEMPOTENCIA,
        }),
      },
      async ({ inicio, fim, descricao, chaveIdempotencia }) =>
        escrita(c.quem, 'interrupcao_criar', chaveIdempotencia, { inicio, fim, descricao }, () =>
          c.servicos.loja.criarInterrupcao(c.quem.merchantId, { descricao: descricao ?? 'Pausa', inicio, fim }),
        ),
    );
  },
};

/** O catálogo. Ferramenta sem permissão nem aparece em `tools/list`; chamada direta a ela responde "não encontrada". */
export const FERRAMENTAS: readonly Ferramenta[] = [
  integracaoSituacao,
  cardapioListar,
  categoriasListar,
  itemLer,
  complementosListar,
  alertasListar,
  lojaStatusLer,
  lojaHorariosLer,
  precoDefinir,
  precosEmMassa,
  itemPausar,
  itemReativar,
  complementoPausar,
  complementoReativar,
  interrupcaoCriar,
];

/** As ferramentas que uma credencial pode ver e usar. */
export function ferramentasDe(quem: Pick<IntegracaoAutenticada, 'escopos'>): Ferramenta[] {
  return FERRAMENTAS.filter((f) => f.escopo === null || quem.escopos.includes(f.escopo));
}
