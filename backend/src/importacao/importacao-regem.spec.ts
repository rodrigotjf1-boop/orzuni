/**
 * Fase 1 — importação do cardápio do Regem (contrato #854). O que o CI (build) não cobre: o diff
 * por código PDV com a regra do dono (importar só `no_ifood === true` E com preço), a conversão de
 * centavos → reais, e a cifra do token. Funções puras — sem rede/banco.
 */
import { classificarImportacao, montarItemIfood, centavosParaReais } from './importacao-regem.service';
import { cifrar, decifrar } from '../common/cifra';

describe('classificarImportacao — cria só os que faltam, pela regra do dono (#854)', () => {
  const existentes = new Set(['A1', 'B2']);

  it('importa só `no_ifood === true` com preço e código; ignora o resto', () => {
    const r = classificarImportacao(
      [
        { codigo: 'A1', no_ifood: true, preco_ifood_centavos: 1000 }, // já existe no iFood → não toca
        { codigo: 'C3', no_ifood: true, preco_ifood_centavos: 2000 }, // novo, marcado e com preço → criar
        { codigo: 'D4', no_ifood: true, preco_ifood_centavos: null }, // marcado mas sem preço → ignora
        { codigo: 'E5', no_ifood: false, preco_ifood_centavos: 900 }, // NÃO marcado para o iFood → ignora
        { codigo: 'F6', preco_ifood_centavos: 900 }, // no_ifood ausente (≠ true) → ignora
        { codigo: '', no_ifood: true, preco_ifood_centavos: 700 }, // sem código → não dá para ligar
      ],
      existentes,
    );
    expect(r.aCriar.map((p) => p.codigo)).toEqual(['C3']);
    expect(r.jaExistiam).toBe(1);
    expect(r.semPreco).toBe(3); // D4 (sem preço) + E5 (no_ifood false) + F6 (ausente)
    expect(r.semCodigo).toBe(1);
  });

  it('lista vazia não quebra', () => {
    expect(classificarImportacao(undefined, existentes)).toEqual({ aCriar: [], jaExistiam: 0, semCodigo: 0, semPreco: 0 });
  });
});

describe('centavosParaReais / montarItemIfood — centavos ÷ 100, opções só com preço', () => {
  it('converte centavos sem erro de ponto flutuante', () => {
    expect(centavosParaReais(3490)).toBe(34.9);
    expect(centavosParaReais(1)).toBe(0.01);
    expect(centavosParaReais(0)).toBe(0);
    expect(centavosParaReais(2590)).toBe(25.9);
  });

  it('monta o item no iFood com preço em reais, categoria pelo id e opções com código', () => {
    const cats = new Map([['cat1', 'Lanches']]);
    const item = montarItemIfood(
      {
        codigo: '501',
        nome: 'X-Burger',
        descricao: 'clássico',
        categoria_id: 'cat1',
        no_ifood: true,
        preco_ifood_centavos: 2590,
        adicionais: [
          {
            nome: 'Adicionais',
            min: 0,
            max: null, // nulo com opções → cabe todas
            opcoes: [
              { nome: 'Bacon', codigo: '900', preco_ifood_centavos: 500 },
              { nome: 'Ponto da carne', codigo: null, preco_ifood_centavos: null }, // informativa/sem preço → fora
            ],
          },
        ],
      },
      cats,
    );
    expect(item.preco).toBe(25.9);
    expect(item.categoria).toBe('Lanches');
    expect(item.pdv).toBe('501');
    expect(item.complementos).toHaveLength(1);
    expect(item.complementos![0]).toMatchObject({ grupo: 'Adicionais', min: 0, max: 1 });
    expect(item.complementos![0].opcoes).toEqual([{ nome: 'Bacon', preco: 5, pdv: '900' }]);
  });

  it('categoria desconhecida cai em "Cardápio"; sem adicionais com preço, não manda complementos', () => {
    const item = montarItemIfood(
      { codigo: '7', nome: 'Água', no_ifood: true, preco_ifood_centavos: 300, adicionais: [{ nome: 'x', opcoes: [{ nome: 'y', preco_ifood_centavos: null }] }] },
      new Map(),
    );
    expect(item.categoria).toBe('Cardápio');
    expect(item.complementos).toBeUndefined();
  });
});

describe('cifra — ida e volta, formato versionado', () => {
  const ANTES = process.env.ORZUNI_CIFRA_SEGREDO;
  beforeAll(() => {
    process.env.ORZUNI_CIFRA_SEGREDO = 'segredo-de-teste-para-cifra-123456';
  });
  afterAll(() => {
    if (ANTES === undefined) delete process.env.ORZUNI_CIFRA_SEGREDO;
    else process.env.ORZUNI_CIFRA_SEGREDO = ANTES;
  });

  it('cifra e decifra o mesmo texto; o guardado não contém o segredo em claro', () => {
    const token = 'rgm_it_token_secreto_abc';
    const guardado = cifrar(token);
    expect(guardado.startsWith('v1:')).toBe(true);
    expect(guardado).not.toContain(token);
    expect(decifrar(guardado)).toBe(token);
  });
});
