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

import { erroDaFerramenta, escrita, type Ferramenta, LEITURA, naConta, resposta } from './mcp.ferramenta';
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
        escrita(c.quem, 'preco_definir', chaveIdempotencia, { codigo_pdv, valor }, () => c.servicos.catalogo.definirPrecoItem(c.quem.merchantId, codigo_pdv, valor)),
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
        escrita(c.quem, 'precos_em_massa', chaveIdempotencia, { itens, contexto }, async () => {
          const r = await c.servicos.catalogo.reprecificar(
            c.quem.merchantId,
            itens.map((i) => ({ pdv: i.codigo_pdv, preco: i.valor, manterPromo: i.manter_promo })),
            contexto || 'DEFAULT',
          );
          // o lote é assíncrono no iFood: a porta devolve o batchId; os ignorados são os códigos de PDV sem item.
          if (!r.batchId)
            return { situacao: 'nao_encontrado' as const, codigo: 'pdv_inexistente', pode_repetir: false, erro: 'Nenhum dos códigos de PDV existe no iFood.', dados: { ignorados: r.ignorados } };
          return { situacao: 'aplicado' as const, dados: { batchId: r.batchId, lote_assincrono: true, ignorados: r.ignorados } };
        }),
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
        escrita(c.quem, 'item_pausar', chaveIdempotencia, { codigo_pdv }, () => c.servicos.catalogo.definirStatusItem(c.quem.merchantId, codigo_pdv, 'pausado')),
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
        escrita(c.quem, 'item_reativar', chaveIdempotencia, { codigo_pdv }, () => c.servicos.catalogo.definirStatusItem(c.quem.merchantId, codigo_pdv, 'no_ar')),
    );
  },
};

// Um complemento é endereçado pelo código de PDV (todas as opções com esse código, em
// todos os grupos — a regra do Regem) OU, direto, pelo id de UMA opção do iFood.
// Os dois são opcionais no schema (o SDK monta o JSON Schema do tools/list a partir do
// shape); a regra "exatamente um" é conferida no handler (`exigirUmAlvo`).
const ALVO_COMPLEMENTO = z.object({
  codigo_pdv: z.string().min(1).max(100).optional().describe('O código de PDV da opção: atinge TODAS as opções com esse código, em todos os grupos.'),
  opcao_id: z.string().min(1).optional().describe('O id de UMA opção no iFood (veja complementos_listar). Alternativa ao codigo_pdv.'),
  chaveIdempotencia: CHAVE_IDEMPOTENCIA,
});

/** Erro de envelope quando o alvo do complemento não é exatamente um (codigo_pdv OU opcao_id). */
function exigirUmAlvo(codigo_pdv?: string, opcao_id?: string) {
  if ((codigo_pdv ? 1 : 0) + (opcao_id ? 1 : 0) === 1) return null;
  return erroDaFerramenta('Informe codigo_pdv OU opcao_id (exatamente um).', { situacao: 'recusado', codigo: 'dados_invalidos', repetido: false });
}

const complementoPrecoDefinir: Ferramenta = {
  nome: 'complemento_preco_definir',
  escopo: 'preco.escrever',
  registrar(servidor, c) {
    servidor.registerTool(
      'complemento_preco_definir',
      {
        title: 'Definir o preço de um complemento',
        description: 'Muda o preço de uma opção de complemento no iFood pelo código de PDV (vale para TODAS as opções com esse código, em todos os grupos). O valor vai em reais. A resposta lista cada opção (grupo, optionId, antes → depois).',
        inputSchema: z.object({ codigo_pdv: CODIGO_PDV, valor: z.number().nonnegative().describe('O preço em reais (pode ser 0 para complemento grátis).'), chaveIdempotencia: CHAVE_IDEMPOTENCIA }),
      },
      async ({ codigo_pdv, valor, chaveIdempotencia }) =>
        escrita(c.quem, 'complemento_preco_definir', chaveIdempotencia, { codigo_pdv, valor }, () => c.servicos.catalogo.definirPrecoComplementoPorPdv(c.quem.merchantId, codigo_pdv, valor)),
    );
  },
};

const complementoPausar: Ferramenta = {
  nome: 'complemento_pausar',
  escopo: 'status.escrever',
  registrar(servidor, c) {
    servidor.registerTool(
      'complemento_pausar',
      { title: 'Pausar uma opção de complemento', description: 'Pausa uma opção (complemento) no iFood, pelo código de PDV (todas as opções com o código) ou pelo id da opção. Cascateia para todos os itens do grupo.', inputSchema: ALVO_COMPLEMENTO },
      async ({ codigo_pdv, opcao_id, chaveIdempotencia }) =>
        exigirUmAlvo(codigo_pdv, opcao_id) ??
        escrita(c.quem, 'complemento_pausar', chaveIdempotencia, { codigo_pdv, opcao_id }, () =>
          codigo_pdv
            ? c.servicos.catalogo.definirStatusComplementoPorPdv(c.quem.merchantId, codigo_pdv, 'pausado')
            : c.servicos.catalogo.definirStatusOpcao(c.quem.merchantId, opcao_id!, 'pausado'),
        ),
    );
  },
};

const complementoReativar: Ferramenta = {
  nome: 'complemento_reativar',
  escopo: 'status.escrever',
  registrar(servidor, c) {
    servidor.registerTool(
      'complemento_reativar',
      { title: 'Reativar uma opção de complemento', description: 'Reativa uma opção (complemento) no iFood, pelo código de PDV (todas as opções com o código) ou pelo id da opção.', inputSchema: ALVO_COMPLEMENTO },
      async ({ codigo_pdv, opcao_id, chaveIdempotencia }) =>
        exigirUmAlvo(codigo_pdv, opcao_id) ??
        escrita(c.quem, 'complemento_reativar', chaveIdempotencia, { codigo_pdv, opcao_id }, () =>
          codigo_pdv
            ? c.servicos.catalogo.definirStatusComplementoPorPdv(c.quem.merchantId, codigo_pdv, 'no_ar')
            : c.servicos.catalogo.definirStatusOpcao(c.quem.merchantId, opcao_id!, 'no_ar'),
        ),
    );
  },
};

const itemEditar: Ferramenta = {
  nome: 'item_editar',
  escopo: 'catalogo.escrever',
  registrar(servidor, c) {
    servidor.registerTool(
      'item_editar',
      {
        title: 'Editar nome e descrição de um item',
        description: 'Muda o nome e/ou a descrição de UM item no iFood, pelo código de PDV (informe ao menos um dos dois). Nome até 100, descrição até 500 caracteres. A resposta lista os campos alterados (antes → depois).',
        inputSchema: z.object({
          codigo_pdv: CODIGO_PDV,
          nome: z.string().max(100).optional().describe('O novo nome do item (até 100 caracteres).'),
          descricao: z.string().max(500).optional().describe('A nova descrição do item (até 500 caracteres).'),
          chaveIdempotencia: CHAVE_IDEMPOTENCIA,
        }),
      },
      async ({ codigo_pdv, nome, descricao, chaveIdempotencia }) =>
        escrita(c.quem, 'item_editar', chaveIdempotencia, { codigo_pdv, nome, descricao }, () => c.servicos.catalogo.definirNomeDescricaoItem(c.quem.merchantId, codigo_pdv, { nome, descricao })),
    );
  },
};

const itemFotoDefinir: Ferramenta = {
  nome: 'item_foto_definir',
  escopo: 'catalogo.escrever',
  registrar(servidor, c) {
    servidor.registerTool(
      'item_foto_definir',
      {
        title: 'Trocar a foto de um item',
        description:
          'Troca a FOTO de UM item no iFood, pelo código de PDV. A foto vai em data-URI JPEG ou png (data:image/jpeg;base64,…), de até 8 MB. O iFood recomenda imagem quadrada, no mínimo 300×300 px; a dimensão quem valida é o iFood. Foto grande demais volta recusada (codigo imagem_grande) antes de ir ao iFood.',
        inputSchema: z.object({
          codigo_pdv: CODIGO_PDV,
          imagem: z.string().min(1).describe('A foto em data-URI: data:image/jpeg;base64,… (ou png). JPEG/PNG, até 8 MB, quadrada e ≥ 300×300 px.'),
          chaveIdempotencia: CHAVE_IDEMPOTENCIA,
        }),
      },
      async ({ codigo_pdv, imagem, chaveIdempotencia }) =>
        escrita(c.quem, 'item_foto_definir', chaveIdempotencia, { codigo_pdv, imagem }, () => c.servicos.catalogo.definirFotoItem(c.quem.merchantId, codigo_pdv, imagem)),
    );
  },
};

const complementoNomeDefinir: Ferramenta = {
  nome: 'complemento_nome_definir',
  escopo: 'catalogo.escrever',
  registrar(servidor, c) {
    servidor.registerTool(
      'complemento_nome_definir',
      {
        title: 'Renomear uma opção de complemento',
        description: 'Muda o nome de uma opção de complemento no iFood, pelo código de PDV (todas as opções com o código, em todos os grupos) ou pelo id da opção. Nome até 100 caracteres. A resposta lista cada opção.',
        inputSchema: z.object({
          codigo_pdv: z.string().min(1).max(100).optional().describe('O código de PDV da opção: renomeia TODAS as opções com esse código.'),
          opcao_id: z.string().min(1).optional().describe('O id de UMA opção no iFood (alternativa ao codigo_pdv).'),
          nome: z.string().min(1).max(100).describe('O novo nome da opção (até 100 caracteres).'),
          chaveIdempotencia: CHAVE_IDEMPOTENCIA,
        }),
      },
      async ({ codigo_pdv, opcao_id, nome, chaveIdempotencia }) =>
        exigirUmAlvo(codigo_pdv, opcao_id) ??
        escrita(c.quem, 'complemento_nome_definir', chaveIdempotencia, { codigo_pdv, opcao_id, nome }, () =>
          codigo_pdv ? c.servicos.catalogo.definirNomeComplementoPorPdv(c.quem.merchantId, codigo_pdv, nome) : c.servicos.catalogo.definirNomeOpcao(c.quem.merchantId, opcao_id!, nome),
        ),
    );
  },
};

const itemCodigoPdvDefinir: Ferramenta = {
  nome: 'item_codigo_pdv_definir',
  escopo: 'catalogo.escrever',
  registrar(servidor, c) {
    servidor.registerTool(
      'item_codigo_pdv_definir',
      {
        title: 'Trocar o código de PDV de um item',
        description: 'Troca o código de PDV de um item no iFood. Recusa com codigo_ja_existe se o novo código já estiver em uso em outro item.',
        inputSchema: z.object({
          codigo_pdv: CODIGO_PDV,
          codigo_pdv_novo: z.string().min(1).max(100).describe('O novo código de PDV do item.'),
          chaveIdempotencia: CHAVE_IDEMPOTENCIA,
        }),
      },
      async ({ codigo_pdv, codigo_pdv_novo, chaveIdempotencia }) =>
        escrita(c.quem, 'item_codigo_pdv_definir', chaveIdempotencia, { codigo_pdv, codigo_pdv_novo }, () => c.servicos.catalogo.definirCodigoPdvItem(c.quem.merchantId, codigo_pdv, codigo_pdv_novo)),
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
        description:
          'Cria uma pausa programada da LOJA inteira no iFood (não de um item), com início e fim em ISO 8601 (duração de 1 minuto a 7 dias). A resposta traz o id da pausa (use em interrupcao_remover), início, fim e descrição. Se já houver uma pausa no período, recusa com o código interrupcao_sobreposta e os dados da pausa que já vale.',
        inputSchema: z.object({
          inicio: z.string().describe('Início da pausa, em ISO 8601.'),
          fim: z.string().describe('Fim da pausa, em ISO 8601.'),
          descricao: z.string().max(200).optional().describe('O motivo da pausa, até 200 letras (opcional).'),
          chaveIdempotencia: CHAVE_IDEMPOTENCIA,
        }),
      },
      async ({ inicio, fim, descricao, chaveIdempotencia }) =>
        escrita(c.quem, 'interrupcao_criar', chaveIdempotencia, { inicio, fim, descricao }, () =>
          c.servicos.loja.pausarLojaPorta(c.quem.merchantId, { inicio, fim, descricao }),
        ),
    );
  },
};

const interrupcaoRemover: Ferramenta = {
  nome: 'interrupcao_remover',
  escopo: 'loja.escrever',
  registrar(servidor, c) {
    servidor.registerTool(
      'interrupcao_remover',
      {
        title: 'Remover uma pausa da loja',
        description:
          'Remove uma pausa (interrupção) da LOJA no iFood pelo id (o que interrupcao_criar devolveu). Use para "reabrir agora". Se a pausa já não existir, responde sucesso mesmo assim (idempotente).',
        inputSchema: z.object({
          interrupcao_id: z.string().min(1).max(100).describe('O id da pausa a remover (veja interrupcao_criar ou interrupcoes_listar).'),
          chaveIdempotencia: CHAVE_IDEMPOTENCIA,
        }),
      },
      async ({ interrupcao_id, chaveIdempotencia }) =>
        escrita(c.quem, 'interrupcao_remover', chaveIdempotencia, { interrupcao_id }, () => c.servicos.loja.removerPausaPorta(c.quem.merchantId, interrupcao_id)),
    );
  },
};

const interrupcoesListar: Ferramenta = {
  nome: 'interrupcoes_listar',
  escopo: 'loja.ler',
  registrar(servidor, c) {
    servidor.registerTool(
      'interrupcoes_listar',
      {
        title: 'Listar as pausas da loja',
        description: 'As pausas (interrupções) vigentes e futuras da LOJA no iFood, cada uma com id, início, fim e descrição. Use para conferir o que está pausado.',
        inputSchema: z.object({}),
        annotations: LEITURA,
      },
      async () => naConta('interrupcoes_listar', async () => ({ interrupcoes: await c.servicos.loja.interrupcoes(c.quem.merchantId) })),
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
  interrupcoesListar,
  precoDefinir,
  precosEmMassa,
  itemPausar,
  itemReativar,
  complementoPrecoDefinir,
  complementoPausar,
  complementoReativar,
  itemEditar,
  itemFotoDefinir,
  complementoNomeDefinir,
  itemCodigoPdvDefinir,
  interrupcaoCriar,
  interrupcaoRemover,
];

/** As ferramentas que uma credencial pode ver e usar. */
export function ferramentasDe(quem: Pick<IntegracaoAutenticada, 'escopos'>): Ferramenta[] {
  return FERRAMENTAS.filter((f) => f.escopo === null || quem.escopos.includes(f.escopo));
}
