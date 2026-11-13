/**
 * "Conectar pelo Regem" — as regras sem rede nem banco: a configuração, o pedido (o `state` e o PKCE), o corpo que o
 * Regem aceita, a página, a volta (o `iss` do Regem, RFC 9207) e as lojas que a troca devolve. Dados fictícios.
 */
import { createHash } from 'node:crypto';

import {
  LEITURAS_DO_REGEM,
  conferirVolta,
  corpoDoPedido,
  formatoDoEstado,
  formatoDoNumero,
  gerarPedido,
  hashDoEstado,
  lerConfigDoClique,
  lojaEmUso,
  lojasDaTroca,
  nomeDaConta,
  urlDaPagina,
} from './regem-clique.regras';

const DMS_ID = { DMS_ID_EMISSOR: 'https://id.exemplo/oidc/', HUB_APLICATIVO: 'app-orzuni-de-teste', HUB_SEGREDO: 'segredo-de-teste-123456' };
const LIGACAO = (fim = 'aaaaaa') => `dms_lg_regem_${'A'.repeat(43)}_${fim}`;
const loja = (mudar: Record<string, unknown> = {}) => ({
  loja_id: '11111111-1111-4111-8111-111111111111',
  loja_nome: 'Brasa Centro',
  ligacao: LIGACAO(),
  prefixo: 'dms_lg_regem_AAAAAAAA',
  permissoes: ['catalogo.ler', 'catalogo.ifood.ler'],
  ...mudar,
});

describe('conectar pelo Regem — a configuração', () => {
  it('sem a chave ligada fica desligado, sem motivo (é o estado normal)', () => {
    expect(lerConfigDoClique({ ...DMS_ID })).toEqual({ ligado: false, motivo: null });
    expect(lerConfigDoClique({ ...DMS_ID, ORZUNI_REGEM_CLIQUE: 'false' })).toEqual({ ligado: false, motivo: null });
  });

  it('ligada, com os padrões de produção: a API, o recurso do DMS ID, a página do Regem e a volta do Orzuni', () => {
    expect(lerConfigDoClique({ ...DMS_ID, ORZUNI_REGEM_CLIQUE: 'true' })).toEqual({
      ligado: true,
      api: 'https://api.dmsregem.com',
      recurso: 'https://api.dmsregem.com/api/v1/integracao',
      pagina: 'https://app.dmsregem.com/integracoes/autorizar',
      volta: 'https://app.orzuni.com/importar/volta',
      emissorDmsId: 'https://id.exemplo/oidc',
      aplicativo: 'app-orzuni-de-teste',
      segredo: 'segredo-de-teste-123456',
    });
  });

  it('os endereços do ambiente trocam os padrões (teste); endereço com caminho, sem https ou com usuário não liga', () => {
    const c = lerConfigDoClique({
      ...DMS_ID,
      ORZUNI_REGEM_CLIQUE: '1',
      ORZUNI_REGEM_BASE: 'http://127.0.0.1:4010/',
      ORZUNI_REGEM_APP_URL: 'http://localhost:3000',
      ORZUNI_APP_URL: 'https://orzuni.teste',
    });
    expect(c).toMatchObject({ ligado: true, api: 'http://127.0.0.1:4010', pagina: 'http://localhost:3000/integracoes/autorizar', volta: 'https://orzuni.teste/importar/volta' });
    for (const torto of ['https://api.dmsregem.com/api/v1', 'http://api.dmsregem.com', 'https://dono:senha@api.dmsregem.com', 'nao-e-endereco']) {
      expect(lerConfigDoClique({ ...DMS_ID, ORZUNI_REGEM_CLIQUE: 'true', ORZUNI_REGEM_BASE: torto })).toEqual({
        ligado: false,
        motivo: 'ORZUNI_REGEM_BASE precisa ser o endereço https da API do Regem, sem caminho',
      });
    }
  });

  it('sem o aplicativo do Orzuni no DMS ID não liga, e diz o que falta', () => {
    expect(lerConfigDoClique({ ORZUNI_REGEM_CLIQUE: 'true', DMS_ID_EMISSOR: 'https://id.exemplo/oidc', HUB_APLICATIVO: 'app' })).toEqual({
      ligado: false,
      motivo: 'falta HUB_SEGREDO (o aplicativo do Orzuni no DMS ID)',
    });
  });
});

describe('conectar pelo Regem — o pedido', () => {
  it('o state e o PKCE: cada pedido é único, o desafio é o SHA-256 do verificador e só o resumo do state é guardado', () => {
    const a = gerarPedido();
    const b = gerarPedido();
    expect(a.estado).not.toBe(b.estado);
    expect(formatoDoEstado(a.estado)).toBe(true);
    expect(a.verificador).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(a.desafio).toBe(createHash('sha256').update(a.verificador, 'ascii').digest('base64url'));
    expect(a.desafio).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.estadoHash).toBe(hashDoEstado(a.estado));
    expect(a.estadoHash).not.toContain(a.estado);
  });

  it('o corpo é o que o Regem aceita: as duas leituras, o S256, a conta sem CNPJ', () => {
    const p = gerarPedido();
    expect(corpoDoPedido({ volta: 'https://app.orzuni.com/importar/volta', estado: p.estado, desafio: p.desafio, contaNome: 'Lanchonete da Olga', contaEmail: 'olga@exemplo.com.br' })).toEqual({
      response_type: 'code',
      redirect_uri: 'https://app.orzuni.com/importar/volta',
      scope: 'catalogo.ler catalogo.ifood.ler',
      state: p.estado,
      code_challenge: p.desafio,
      code_challenge_method: 'S256',
      conta_nome: 'Lanchonete da Olga',
      conta_email: 'olga@exemplo.com.br',
    });
    expect(LEITURAS_DO_REGEM).toEqual(['catalogo.ler', 'catalogo.ifood.ler']); // nenhuma escrita, nada de vendas
  });

  it('a conta aparece com o nome da loja do iFood; sem loja, com o começo do e-mail; nunca mais de 120 caracteres', () => {
    expect(nomeDaConta('Lanchonete da Olga', 'olga@exemplo.com.br')).toBe('Lanchonete da Olga');
    expect(nomeDaConta(undefined, 'olga@exemplo.com.br')).toBe('olga');
    expect(nomeDaConta('loja', 'olga@exemplo.com.br')).toBe('olga'); // "loja" é o nome padrão de quem não tem nome
    expect(nomeDaConta('x'.repeat(300), 'olga@exemplo.com.br')).toHaveLength(120);
  });

  it('a página do Regem leva o client_id e o número; o número tem a forma do Regem', () => {
    const numero = `urn:ietf:params:oauth:request_uri:rgm_${'B'.repeat(43)}`;
    expect(formatoDoNumero(numero)).toBe(true);
    expect(formatoDoNumero('urn:ietf:params:oauth:request_uri:orz_xx')).toBe(false);
    const u = new URL(urlDaPagina('https://app.dmsregem.com/integracoes/autorizar', 'app-orzuni', numero));
    expect(`${u.origin}${u.pathname}`).toBe('https://app.dmsregem.com/integracoes/autorizar');
    expect(u.searchParams.get('client_id')).toBe('app-orzuni');
    expect(u.searchParams.get('request_uri')).toBe(numero);
  });
});

describe('conectar pelo Regem — a volta', () => {
  const ISS = 'https://api.dmsregem.com';
  const { estado } = gerarPedido();
  const codigo = `rgm_ac_${'C'.repeat(43)}`;

  it('com o iss do Regem, o state do Orzuni e o código: vale', () => {
    expect(conferirVolta({ code: codigo, state: estado, iss: ISS }, ISS)).toEqual({ tipo: 'codigo', estado, codigo });
  });

  it('sem o iss, com o iss de outro lugar ou com o state torto: não vale, e nem chega a procurar o pedido', () => {
    expect(conferirVolta({ code: codigo, state: estado }, ISS)).toEqual({ tipo: 'invalida', motivo: 'a volta não veio do Regem' });
    expect(conferirVolta({ code: codigo, state: estado, iss: 'https://ataque.exemplo' }, ISS).tipo).toBe('invalida');
    expect(conferirVolta({ code: codigo, state: 'curto', iss: ISS }, ISS)).toEqual({ tipo: 'invalida', motivo: 'a volta veio sem o pedido que o Orzuni abriu' });
    expect(conferirVolta({ code: codigo, state: [estado], iss: ISS }, ISS).tipo).toBe('invalida');
  });

  it('o presidente cancelou: recusa (o pedido é gasto e nada muda); outro erro do Regem: pedido inválido', () => {
    expect(conferirVolta({ error: 'access_denied', state: estado, iss: ISS }, ISS)).toEqual({ tipo: 'recusa', estado, motivo: 'recusado' });
    expect(conferirVolta({ error: 'invalid_request_uri', state: estado, iss: ISS }, ISS)).toEqual({ tipo: 'recusa', estado, motivo: 'pedido_invalido' });
  });

  it('sem código, com código curto ou com espaço: não vale', () => {
    for (const ruim of [undefined, '', 'abc', `${codigo} x`, 'x'.repeat(400)]) {
      expect(conferirVolta({ code: ruim, state: estado, iss: ISS }, ISS)).toEqual({ tipo: 'invalida', motivo: 'a volta veio sem o código da autorização' });
    }
  });
});

describe('conectar pelo Regem — as lojas da troca', () => {
  it('cada loja com a ligação e a leitura do cardápio: aceita, com o nome e o prefixo', () => {
    expect(lojasDaTroca({ lojas: [loja(), loja({ loja_id: 'loja-2', loja_nome: '', ligacao: LIGACAO('bbbbbb'), prefixo: undefined })] })).toEqual([
      { lojaId: '11111111-1111-4111-8111-111111111111', nome: 'Brasa Centro', ligacao: LIGACAO(), prefixo: 'dms_lg_regem_AAAAAAAA', permissoes: ['catalogo.ler', 'catalogo.ifood.ler'] },
      { lojaId: 'loja-2', nome: 'Loja do Regem', ligacao: LIGACAO('bbbbbb'), prefixo: null, permissoes: ['catalogo.ler', 'catalogo.ifood.ler'] },
    ]);
  });

  it('resposta torta não guarda nada: sem lojas, segredo com outra cara, sem a leitura do cardápio, loja repetida ou sem id', () => {
    for (const torta of [
      null,
      {},
      { lojas: [] },
      { lojas: 'x' },
      { lojas: [loja({ ligacao: 'rgm_it_chave-antiga' })] },
      { lojas: [loja({ ligacao: `dms_lg_orzuni_${'A'.repeat(43)}_aaaaaa` })] },
      { lojas: [loja({ permissoes: ['pedidos.ler'] })] },
      { lojas: [loja({ permissoes: 'catalogo.ler' })] },
      { lojas: [loja(), loja()] },
      { lojas: [loja({ loja_id: '' })] },
      { lojas: [loja(), null] },
    ]) {
      expect(lojasDaTroca(torta)).toBeNull();
    }
  });

  it('a loja em uso: a que já estava em uso, se veio de novo; senão a primeira', () => {
    const lojas = lojasDaTroca({ lojas: [loja(), loja({ loja_id: 'loja-2', ligacao: LIGACAO('bbbbbb') })] })!;
    expect(lojaEmUso(lojas, 'loja-2').lojaId).toBe('loja-2');
    expect(lojaEmUso(lojas, 'loja-que-saiu').lojaId).toBe('11111111-1111-4111-8111-111111111111');
    expect(lojaEmUso(lojas, null).lojaId).toBe('11111111-1111-4111-8111-111111111111');
  });
});
