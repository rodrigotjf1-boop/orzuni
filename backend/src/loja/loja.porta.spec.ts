/**
 * Pausa da LOJA inteira no iFood pela porta MCP (F5 do Regem). O que o build não cobre:
 * a regra de duração (1 min a 7 dias), a pausa sobreposta devolvida no 409, e o remover
 * idempotente (já removida = sucesso). iFood mockado — sem rede.
 */
import { LojaService } from './loja.service';

function comIfood(ifood: Partial<Record<string, jest.Mock>>) {
  return new LojaService(ifood as never);
}

const INICIO = '2026-11-10T14:00:00Z';
const FIM = '2026-11-10T14:30:00Z'; // 30 min

describe('LojaService.pausarLojaPorta — criar pausa da loja', () => {
  it('cria e devolve o id, início, fim e descrição', async () => {
    const criarInterrupcao = jest.fn(async () => ({ status: 201, data: { id: 'int-9' } }));
    const loja = comIfood({ criarInterrupcao });
    const r = await loja.pausarLojaPorta('m1', { inicio: INICIO, fim: FIM, descricao: 'Pico' });
    expect(criarInterrupcao).toHaveBeenCalledWith('m1', { description: 'Pico', start: INICIO, end: FIM });
    expect(r).toEqual({ situacao: 'aplicado', dados: { interrupcao_id: 'int-9', inicio: INICIO, fim: FIM, descricao: 'Pico' } });
  });

  it('descrição vazia vira "Pausa"', async () => {
    const criarInterrupcao = jest.fn(async () => ({ status: 201, data: { id: 'x' } }));
    const loja = comIfood({ criarInterrupcao });
    await loja.pausarLojaPorta('m1', { inicio: INICIO, fim: FIM });
    expect(criarInterrupcao).toHaveBeenCalledWith('m1', { description: 'Pausa', start: INICIO, end: FIM });
  });

  it('no 409 (sobreposição) recusa com interrupcao_sobreposta e devolve a pausa que já vale', async () => {
    const criarInterrupcao = jest.fn(async () => ({ status: 409, data: { error: { code: 'InterruptionOverlap' } } }));
    const interrupcoes = jest.fn(async () => [{ id: 'int-5', description: 'Feriado', start: '2026-11-10T14:15:00Z', end: '2026-11-10T14:45:00Z' }]);
    const loja = comIfood({ criarInterrupcao, interrupcoes });
    const r = await loja.pausarLojaPorta('m1', { inicio: INICIO, fim: FIM, descricao: 'Pico' });
    expect(r).toMatchObject({ situacao: 'recusado', codigo: 'interrupcao_sobreposta', pode_repetir: false });
    expect(r.dados).toEqual({ interrupcao: { id: 'int-5', descricao: 'Feriado', inicio: '2026-11-10T14:15:00Z', fim: '2026-11-10T14:45:00Z' } });
  });

  it('duração curta demais (< 1 min) recusa sem chamar o iFood', async () => {
    const criarInterrupcao = jest.fn();
    const loja = comIfood({ criarInterrupcao });
    const r = await loja.pausarLojaPorta('m1', { inicio: INICIO, fim: '2026-11-10T14:00:30Z' });
    expect(r).toMatchObject({ situacao: 'recusado', codigo: 'interrupcao_duracao_invalida', pode_repetir: false });
    expect(criarInterrupcao).not.toHaveBeenCalled();
  });

  it('duração longa demais (> 7 dias) recusa sem chamar o iFood', async () => {
    const criarInterrupcao = jest.fn();
    const loja = comIfood({ criarInterrupcao });
    const r = await loja.pausarLojaPorta('m1', { inicio: INICIO, fim: '2026-11-18T14:00:01Z' });
    expect(r).toMatchObject({ codigo: 'interrupcao_duracao_invalida' });
    expect(criarInterrupcao).not.toHaveBeenCalled();
  });

  it('datas inválidas recusam sem chamar o iFood', async () => {
    const criarInterrupcao = jest.fn();
    const loja = comIfood({ criarInterrupcao });
    const r = await loja.pausarLojaPorta('m1', { inicio: 'não é data', fim: FIM });
    expect(r).toMatchObject({ codigo: 'interrupcao_datas_invalidas' });
    expect(criarInterrupcao).not.toHaveBeenCalled();
  });
});

describe('LojaService.removerPausaPorta — remover pausa (idempotente)', () => {
  it('remove com sucesso (2xx)', async () => {
    const removerInterrupcao = jest.fn(async () => ({ status: 204, data: null }));
    const loja = comIfood({ removerInterrupcao });
    const r = await loja.removerPausaPorta('m1', 'int-9');
    expect(removerInterrupcao).toHaveBeenCalledWith('m1', 'int-9');
    expect(r).toEqual({ situacao: 'aplicado', dados: { interrupcao_id: 'int-9', removida: true } });
  });

  it('já removida / inexistente (404) = sucesso idempotente', async () => {
    const removerInterrupcao = jest.fn(async () => ({ status: 404, data: { error: { code: 'NotFound' } } }));
    const loja = comIfood({ removerInterrupcao });
    const r = await loja.removerPausaPorta('m1', 'sumida');
    expect(r).toEqual({ situacao: 'aplicado', dados: { interrupcao_id: 'sumida', removida: true, ja_estava_removida: true } });
  });

  it('recém-criada (409) recusa e pode repetir', async () => {
    const removerInterrupcao = jest.fn(async () => ({ status: 409, data: { error: { code: 'RecentlyCreatedInterruption' } } }));
    const loja = comIfood({ removerInterrupcao });
    const r = await loja.removerPausaPorta('m1', 'int-9');
    expect(r).toMatchObject({ situacao: 'recusado', codigo: 'interrupcao_recem_criada', pode_repetir: true });
  });
});
