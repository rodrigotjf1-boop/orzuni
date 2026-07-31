'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type LojaPainel, type Interrupcao, type TurnoHorario } from '@/lib/api';
import { useToast } from '@/components/toast';

const DIAS: Array<{ k: string; l: string }> = [
  { k: 'MONDAY', l: 'Segunda' },
  { k: 'TUESDAY', l: 'Terça' },
  { k: 'WEDNESDAY', l: 'Quarta' },
  { k: 'THURSDAY', l: 'Quinta' },
  { k: 'FRIDAY', l: 'Sexta' },
  { k: 'SATURDAY', l: 'Sábado' },
  { k: 'SUNDAY', l: 'Domingo' },
];
const rotuloDia = (k: string) => DIAS.find((d) => d.k === k)?.l ?? k;
const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const fromMin = (t: number) => `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
// datetime-local (local) helpers
const paraInput = (d: Date) => { const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
// o iFood devolve a data/hora em UTC, às vezes SEM o 'Z' — normaliza p/ exibir no fuso local
const fmtBR = (iso: string) => { try { const s = /(?:Z|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : iso + 'Z'; return new Date(s).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch { return iso; } };

const box = { background: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 10, color: 'var(--cream)', fontFamily: 'inherit', fontSize: '.9rem', padding: '9px 12px' } as const;
const label = { display: 'block', fontFamily: 'var(--font-mono)', fontSize: '.58rem', letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--dim)', marginBottom: 6 } as const;

interface Turno { dia: string; inicio: string; fim: string }

export default function LojaPage() {
  const toast = useToast();
  const [painel, setPainel] = useState<LojaPainel | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [interrupcoes, setInterrupcoes] = useState<Interrupcao[] | null>(null);
  const [turnos, setTurnos] = useState<Turno[] | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [savingH, setSavingH] = useState(false);

  // form de pausa
  const [pDesc, setPDesc] = useState('Pausa manual');
  const [pIni, setPIni] = useState('');
  const [pFim, setPFim] = useState('');

  const carregarPainel = useCallback(async () => {
    try { setPainel(await api.loja.painel()); setErro(null); } catch (e: any) { setErro(e.message); }
  }, []);
  const carregarInterrupcoes = useCallback(async () => {
    try { setInterrupcoes((await api.loja.interrupcoes()).interrupcoes); } catch { /* mantém */ }
  }, []);
  const carregarHorarios = useCallback(async () => {
    try {
      const r = await api.loja.horarios();
      setTurnos(r.shifts.map((s: TurnoHorario) => ({ dia: s.dia, inicio: s.inicio.slice(0, 5), fim: fromMin(toMin(s.inicio.slice(0, 5)) + s.duracao) })));
    } catch { /* mantém */ }
  }, []);

  useEffect(() => {
    carregarPainel();
    carregarInterrupcoes();
    carregarHorarios();
    const now = new Date();
    setPIni(paraInput(now));
    setPFim(paraInput(new Date(now.getTime() + 60 * 60 * 1000)));
    // status: polling mínimo de 30s (limite do iFood)
    const t = setInterval(carregarPainel, 30000);
    return () => clearInterval(t);
  }, [carregarPainel, carregarInterrupcoes, carregarHorarios]);

  async function criarPausa() {
    if (!pIni || !pFim) return toast('Informe início e fim.');
    setOcupado(true);
    try {
      const r = await api.loja.criarInterrupcao({ descricao: pDesc.trim() || 'Pausa', inicio: new Date(pIni).toISOString(), fim: new Date(pFim).toISOString() });
      if (r.ok) { toast('<b style="color:var(--green)">Pausa criada</b> ✓'); setTimeout(() => { carregarInterrupcoes(); carregarPainel(); }, 1500); }
      else toast(`Erro: ${r.erro}${r.codigo ? ` (${r.codigo})` : ''}`);
    } catch (e: any) { toast(`Erro: ${e.message}`); } finally { setOcupado(false); }
  }

  async function cancelarPausa(id: string) {
    setOcupado(true);
    try {
      const r = await api.loja.cancelarInterrupcao(id);
      if (r.ok) { toast('Pausa cancelada.'); setTimeout(() => { carregarInterrupcoes(); carregarPainel(); }, 1500); }
      else toast(`${r.erro}${r.codigo ? ` (${r.codigo})` : ''}`);
    } catch (e: any) { toast(`Erro: ${e.message}`); } finally { setOcupado(false); }
  }

  async function salvarHorarios() {
    if (!turnos) return;
    for (const t of turnos) if (toMin(t.fim) <= toMin(t.inicio)) return toast(`${rotuloDia(t.dia)}: o fim deve ser depois do início.`);
    setSavingH(true);
    try {
      const shifts = turnos.map((t) => ({ dia: t.dia, inicio: `${t.inicio}:00`, duracao: toMin(t.fim) - toMin(t.inicio) }));
      const r = await api.loja.salvarHorarios(shifts);
      if (r.ok) { toast('<b style="color:var(--green)">Horários salvos</b> ✓'); setTimeout(carregarHorarios, 1500); }
      else toast(`Erro ao salvar: ${r.erro}${r.codigo ? ` (${r.codigo})` : ''}`);
    } catch (e: any) { toast(`Erro: ${e.message}`); } finally { setSavingH(false); }
  }

  const st = painel?.status;
  const det = painel?.detalhe;
  const pill = st ? (st.estado === 'OK' ? 'on' : st.estado === 'WARNING' ? 'off' : 'off') : 'off';

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Lo<span>ja</span></h1>
          <div className="sub">Status, pausas (interrupções) e horário de funcionamento da sua loja no iFood.</div>
        </div>
        <button className="btn ghost" onClick={carregarPainel}>Atualizar status</button>
      </div>

      {erro && <div className="errbox">Não consegui falar com a API: {erro}</div>}
      {!painel && !erro && <div className="loading">Carregando…</div>}

      {/* STATUS */}
      {st && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <span className={`pill ${pill}`} style={{ fontSize: '.9rem' }}><span className="dotp" />{st.aberta ? 'Loja aberta' : 'Loja fechada'}</span>
            <div style={{ fontWeight: 700, fontSize: '1.05rem' }}>{st.titulo}</div>
            <span className="mono" style={{ marginLeft: 'auto', color: 'var(--dim)', fontSize: '.6rem' }}>estado: {st.estado} · {st.canal}/{st.operacao} · atualiza a cada 30s</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10, marginTop: 12 }}>
            {st.validacoes.map((v) => (
              <div key={v.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', border: '1px solid var(--line)', borderRadius: 10, padding: '9px 11px', background: 'var(--ink)' }}>
                <span style={{ width: 9, height: 9, borderRadius: 999, marginTop: 5, flex: 'none', background: v.estado === 'OK' ? 'var(--green)' : 'var(--coral, #e5533d)' }} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: '.85rem' }}>{v.titulo}</div>
                  {v.subtitulo && <div className="sub" style={{ margin: 0, fontSize: '.7rem' }}>{v.subtitulo}</div>}
                  <div className="mono" style={{ color: 'var(--dim)', fontSize: '.52rem', textTransform: 'uppercase' }}>{v.id} · {v.estado}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* DETALHE */}
      {det && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="mono" style={{ color: 'var(--dim)', marginBottom: 8 }}>detalhes da loja</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            <div><div style={label}>nome</div><div style={{ fontWeight: 600 }}>{det.nome}</div></div>
            <div><div style={label}>tipo</div><div>{det.tipo ?? '—'}</div></div>
            <div><div style={label}>cadastro</div><div>{det.statusCadastral ?? '—'}</div></div>
            <div><div style={label}>operações</div><div>{det.operacoes.join(', ') || '—'}</div></div>
            <div style={{ gridColumn: '1 / -1' }}>
              <div style={label}>endereço</div>
              <div>{det.endereco ? `${det.endereco.rua ?? ''}${det.endereco.numero ? ', ' + det.endereco.numero : ''} — ${det.endereco.bairro ?? ''}, ${det.endereco.cidade ?? ''}/${det.endereco.uf ?? ''} · ${det.endereco.cep ?? ''}` : '—'}</div>
            </div>
          </div>
        </div>
      )}

      {/* INTERRUPÇÕES */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="mono" style={{ color: 'var(--dim)', marginBottom: 10 }}>pausas programadas (interrupções)</div>
        {interrupcoes && interrupcoes.length === 0 && <div className="sub" style={{ marginTop: 0 }}>Nenhuma pausa ativa.</div>}
        {interrupcoes?.map((i) => (
          <div key={i.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: '1px solid var(--line)', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 160 }}>
              <div style={{ fontWeight: 600 }}>{i.descricao || 'Pausa'}</div>
              <div className="mono" style={{ color: 'var(--dim)', fontSize: '.62rem', textTransform: 'none' }}>{fmtBR(i.inicio)} → {fmtBR(i.fim)}</div>
            </div>
            <button className="btn ghost mini" disabled={ocupado} onClick={() => cancelarPausa(i.id)}>Cancelar</button>
          </div>
        ))}
        {/* nova pausa */}
        <div style={{ borderTop: '1px solid var(--line)', marginTop: 8, paddingTop: 12, display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 160 }}><div style={label}>descrição</div><input style={{ ...box, width: '100%' }} value={pDesc} onChange={(e) => setPDesc(e.target.value)} placeholder="Motivo da pausa" /></div>
          <div><div style={label}>início</div><input type="datetime-local" style={box} value={pIni} onChange={(e) => setPIni(e.target.value)} /></div>
          <div><div style={label}>fim</div><input type="datetime-local" style={box} value={pFim} onChange={(e) => setPFim(e.target.value)} /></div>
          <button className="btn" disabled={ocupado} onClick={criarPausa}>{ocupado ? '…' : 'Criar pausa'}</button>
        </div>
        <div className="sub" style={{ marginTop: 8, fontSize: '.68rem' }}>Ao pausar, a loja para de receber pedidos no período. O iFood só permite cancelar uma pausa alguns minutos após criá-la.</div>
      </div>

      {/* HORÁRIOS */}
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
          <div className="mono" style={{ color: 'var(--dim)' }}>horário de funcionamento</div>
          <button className="btn ghost mini" style={{ marginLeft: 'auto' }} onClick={() => setTurnos((t) => [...(t ?? []), { dia: 'MONDAY', inicio: '08:00', fim: '18:00' }])}>+ turno</button>
          <button className="btn" disabled={savingH || !turnos} onClick={salvarHorarios}>{savingH ? 'Salvando…' : 'Salvar horários'}</button>
        </div>
        {turnos?.length === 0 && <div className="sub">Sem turnos. Adicione um.</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {turnos?.map((t, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <select value={t.dia} onChange={(e) => setTurnos((x) => x!.map((y, k) => (k === i ? { ...y, dia: e.target.value } : y)))} style={{ ...box, cursor: 'pointer', minWidth: 120 }}>
                {DIAS.map((d) => <option key={d.k} value={d.k}>{d.l}</option>)}
              </select>
              <span className="mono" style={{ fontSize: '.6rem', color: 'var(--dim)' }}>das</span>
              <input type="time" value={t.inicio} onChange={(e) => setTurnos((x) => x!.map((y, k) => (k === i ? { ...y, inicio: e.target.value } : y)))} style={box} />
              <span className="mono" style={{ fontSize: '.6rem', color: 'var(--dim)' }}>às</span>
              <input type="time" value={t.fim} onChange={(e) => setTurnos((x) => x!.map((y, k) => (k === i ? { ...y, fim: e.target.value } : y)))} style={box} />
              <button className="btn ghost mini" onClick={() => setTurnos((x) => x!.filter((_, k) => k !== i))}>×</button>
            </div>
          ))}
        </div>
        <div className="sub" style={{ marginTop: 10, fontSize: '.68rem' }}>Um turno por linha (pode ter mais de um no mesmo dia). Turnos sobrepostos são rejeitados pelo iFood (erro 400) — aparece no Diagnóstico.</div>
      </div>
    </>
  );
}
