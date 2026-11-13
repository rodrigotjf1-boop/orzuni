/**
 * As regras puras da autorização por clique (Padrão DMS §3): o pedido, o número, o código, o PKCE, a volta, os
 * endereços de volta, a decisão do dono e o texto guardado como prova.
 */
import {
  APLICATIVOS_DO_CLIQUE,
  cnpjComMascara,
  conferirPedido,
  escoposDaTroca,
  formatoDoCodigo,
  formatoDoPedido,
  gerarCodigo,
  gerarPedido,
  opcionaisLigadas,
  permissoesDaTela,
  resumoDe,
  textoDaAutorizacao,
  urlDeVolta,
  verificadorConfere,
  voltasDoProduto,
} from './autorizacao.regras';

const REGEM = APLICATIVOS_DO_CLIQUE.regem;
const VOLTA = 'https://app.dmsregem.com/integracoes/orzuni/volta';
const DESAFIO = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'; // RFC 7636, apêndice B
const VERIFICADOR = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';

const corpoBom = (mudar: Record<string, unknown> = {}) => ({
  response_type: 'code',
  client_id: 'app-regem',
  redirect_uri: VOLTA,
  scope: 'catalogo.ler preco.escrever status.escrever loja.escrever',
  state: 'estado-de-teste-1234567890',
  code_challenge: DESAFIO,
  code_challenge_method: 'S256',
  conta_nome: 'Casa do Hambúrguer Ltda.',
  conta_cnpj: '98.765.432/0001-10',
  conta_email: 'Dono@Exemplo.com.br',
  conta_loja: 'Centro',
  conta_loja_id: '8b1f2c3d-0000-4000-8000-000000000001',
  ...mudar,
});

describe('o pedido empurrado', () => {
  it('confere e separa necessárias e opcionais pelo cadastro do aplicativo, na ordem do catálogo', () => {
    const c = conferirPedido(corpoBom(), REGEM, 'app-regem', [VOLTA]);
    expect(c).toEqual({
      volta: VOLTA,
      estado: 'estado-de-teste-1234567890',
      desafio: DESAFIO,
      necessarias: ['catalogo.ler', 'preco.escrever', 'status.escrever'],
      opcionais: ['loja.escrever'],
      contaPede: {
        nome: 'Casa do Hambúrguer Ltda.',
        cnpj: '98765432000110',
        email: 'dono@exemplo.com.br',
        marca: null,
        loja: 'Centro',
        loja_id: '8b1f2c3d-0000-4000-8000-000000000001',
      },
    });
  });

  it('pedir só opcionais vale (o "pedir mais")', () => {
    const c = conferirPedido(corpoBom({ scope: 'catalogo.escrever' }), REGEM, 'app-regem', [VOLTA]);
    expect('erro' in c).toBe(false);
    expect(c).toMatchObject({ necessarias: [], opcionais: ['catalogo.escrever'] });
  });

  it.each([
    [{ response_type: 'token' }, 'response_type'],
    [{ client_id: 'outro-app' }, 'client_id'],
    [{ redirect_uri: 'https://malicioso.example/volta' }, 'redirect_uri'],
    [{ redirect_uri: `${VOLTA}?x=1` }, 'redirect_uri'],
    [{ scope: '' }, 'scope precisa'],
    [{ scope: 'catalogo.ler catalogo.ler' }, 'repetida'],
    [{ scope: 'vigia.ler' }, 'vigia.ler'],
    [{ scope: 'catalogo.apagar' }, 'catalogo.apagar'],
    [{ state: 'curto' }, 'state'],
    [{ code_challenge_method: 'plain' }, 'S256'],
    [{ code_challenge: 'abc' }, 'code_challenge'],
    [{ conta_nome: '' }, 'conta_nome'],
    [{ conta_cnpj: '123' }, 'conta_cnpj'],
    [{ conta_email: 'sem-arroba' }, 'conta_email'],
    [{ conta_loja_id: 'tem espaço' }, 'conta_loja_id'],
  ])('recusa %j', (mudar, trecho) => {
    const c = conferirPedido(corpoBom(mudar), REGEM, 'app-regem', [VOLTA]);
    expect('erro' in c && c.erro).toContain(trecho);
  });

  it('sem CNPJ vale (a página trata como outra empresa)', () => {
    const c = conferirPedido(corpoBom({ conta_cnpj: '' }), REGEM, 'app-regem', [VOLTA]);
    expect(c).toMatchObject({ contaPede: { cnpj: null } });
  });
});

describe('o número, o código e o PKCE', () => {
  it('o número e o código têm forma própria e só o SHA-256 vai ao banco', () => {
    const p = gerarPedido();
    expect(formatoDoPedido(p.numero)).toBe(true);
    expect(p.hash).toBe(resumoDe(p.numero));
    expect(p.hash).not.toContain(p.numero);
    const c = gerarCodigo();
    expect(formatoDoCodigo(c.codigo)).toBe(true);
    expect(c.codigo.startsWith('orz_ac_')).toBe(true);
    expect(formatoDoPedido(c.codigo)).toBe(false);
    expect(formatoDoCodigo(p.numero)).toBe(false);
    expect(gerarCodigo().codigo).not.toBe(c.codigo);
  });

  it('o verificador confere pelo vetor da RFC 7636; outro não', () => {
    expect(verificadorConfere(VERIFICADOR, DESAFIO)).toBe(true);
    expect(verificadorConfere(`${VERIFICADOR.slice(0, -1)}x`, DESAFIO)).toBe(false);
    expect(verificadorConfere('curto', DESAFIO)).toBe(false);
    expect(verificadorConfere(undefined, DESAFIO)).toBe(false);
  });

  it('a volta leva os parâmetros sem perder os que o endereço já tinha', () => {
    const u = new URL(urlDeVolta('https://app.exemplo.com/volta?aba=1', { code: 'orz_ac_x', state: 'e', iss: 'https://api.orzuni.com' }));
    expect(u.searchParams.get('aba')).toBe('1');
    expect(u.searchParams.get('code')).toBe('orz_ac_x');
    expect(u.searchParams.get('iss')).toBe('https://api.orzuni.com');
  });
});

describe('os endereços de volta', () => {
  it('o padrão do código para o Regem; produto sem cadastro, nenhum', () => {
    expect(voltasDoProduto('regem', {})).toEqual([VOLTA]);
    expect(voltasDoProduto('outro', {})).toEqual([]);
  });

  it('a distribuição troca por DMS_ID_VOLTAS; http só para a própria máquina', () => {
    const env = { DMS_ID_VOLTAS: JSON.stringify({ regem: ['http://localhost:3000/volta', 'http://exemplo.com/volta', 'https://homolog.exemplo.com/volta'] }) };
    expect(voltasDoProduto('regem', env)).toEqual(['http://localhost:3000/volta', 'https://homolog.exemplo.com/volta']);
  });

  it('JSON quebrado não abre nada: fica o padrão', () => {
    expect(voltasDoProduto('regem', { DMS_ID_VOLTAS: '{quebrado' })).toEqual([VOLTA]);
  });
});

describe('a decisão do dono', () => {
  it('só liga as opcionais que o pedido trouxe; lista estranha não liga nada', () => {
    expect(opcionaisLigadas(['catalogo.escrever', 'loja.escrever'], ['loja.escrever', 'vigia.escrever'])).toEqual(['loja.escrever']);
    expect(opcionaisLigadas(['loja.escrever'], 'loja.escrever')).toEqual([]);
    expect(opcionaisLigadas(['loja.escrever'], [1, null])).toEqual([]);
  });

  it('pedir mais soma ao que a ligação tinha, sem repetir, na ordem do catálogo', () => {
    expect(escoposDaTroca(['preco.escrever', 'catalogo.ler'], ['loja.escrever', 'catalogo.ler'])).toEqual(['catalogo.ler', 'preco.escrever', 'loja.escrever']);
    expect(escoposDaTroca('lixo', ['catalogo.ler'])).toEqual(['catalogo.ler']);
    expect(escoposDaTroca(['inventada'], [])).toEqual([]);
  });

  it('a página mostra a frase do catálogo e o motivo do aplicativo, necessária ou não', () => {
    const t = permissoesDaTela(REGEM, ['catalogo.ler'], ['loja.escrever']);
    expect(t).toEqual([
      expect.objectContaining({ id: 'catalogo.ler', necessaria: true, motivo: REGEM.motivos['catalogo.ler'] }),
      expect.objectContaining({ id: 'loja.escrever', necessaria: false, motivo: REGEM.motivos['loja.escrever'] }),
    ]);
  });

  it('o texto guardado é o mesmo para a mesma decisão e diz quem pede, onde vale, o que pode e o que não pode', () => {
    const contaPede = { nome: 'Casa do Hambúrguer Ltda.', cnpj: '98765432000110', email: 'dono@exemplo.com.br', marca: null, loja: 'Centro', loja_id: 'x' };
    const a = textoDaAutorizacao({ app: REGEM, contaPede, lojaNome: 'Casa do Hambúrguer — Centro', concedidas: ['preco.escrever', 'catalogo.ler'] });
    const b = textoDaAutorizacao({ app: REGEM, contaPede, lojaNome: 'Casa do Hambúrguer — Centro', concedidas: ['catalogo.ler', 'preco.escrever'] });
    expect(a).toBe(b);
    expect(a).toContain('CNPJ 98.765.432/0001-10');
    expect(a).toContain('"Casa do Hambúrguer — Centro"');
    expect(a).toContain('Mudar o preço');
    expect(a).not.toContain('Pausar a loja');
    for (const n of REGEM.naoPode) expect(a).toContain(n);
  });

  it('CNPJ com máscara; o que não tem 14 dígitos sai nulo', () => {
    expect(cnpjComMascara('98765432000110')).toBe('98.765.432/0001-10');
    expect(cnpjComMascara('123')).toBeNull();
    expect(cnpjComMascara(null)).toBeNull();
  });
});
