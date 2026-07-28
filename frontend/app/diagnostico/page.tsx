'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, type EventoTelemetria } from '@/lib/api';
import { useToast } from '@/components/toast';

const quando = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

export default function DiagnosticoPage() {
  const [eventos, setEventos] = useState<EventoTelemetria[] | null>(null);
  const [resumo, setResumo] = useState<{ total: number; erros: number; ultimo: string | null } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const toast = useToast();

  const carregar = useCallback(async () => {
    try {
      const r = await api.telemetria.listar();
      setEventos(r.eventos);
      setResumo(r.resumo);
      setErro(null);
    } catch (e: any) {
      setErro(e.message);
    }
  }, []);
  useEffect(() => {
    carregar();
    const t = setInterval(carregar, 15000);
    return () => clearInterval(t);
  }, [carregar]);

  async function limpar() {
    try {
      const r = await api.telemetria.limpar();
      toast(`Log limpo (${r.apagados} evento(s)).`);
      carregar();
    } catch (e: any) {
      toast(`Erro: ${e.message}`);
    }
  }

  const cor = (n: string) => (n === 'error' ? 'var(--coral)' : n === 'warn' ? 'var(--tanger)' : 'var(--dim)');

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Diagn<span>óstico</span></h1>
          <div className="sub">Erros recentes (principalmente do iFood, com o campo e o requestId) para acompanhar e corrigir.</div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn ghost mini" onClick={carregar}>Atualizar</button>
          <button className="btn ghost mini" onClick={limpar}>Limpar log</button>
        </div>
      </div>

      {resumo && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
          {[
            { r: 'total', v: resumo.total },
            { r: 'erros', v: resumo.erros },
          ].map((k) => (
            <div key={k.r} className="card" style={{ padding: '12px 18px', minWidth: 110 }}>
              <div className="mono" style={{ fontSize: '.55rem', color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '.1em' }}>{k.r}</div>
              <div className="mono" style={{ fontSize: '1.4rem', fontWeight: 700, color: k.r === 'erros' && k.v ? 'var(--coral)' : 'var(--cream)' }}>{k.v}</div>
            </div>
          ))}
          <div className="card" style={{ padding: '12px 18px', flex: 1, minWidth: 160 }}>
            <div className="mono" style={{ fontSize: '.55rem', color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '.1em' }}>último</div>
            <div className="mono" style={{ fontSize: '.9rem', color: 'var(--cream)', textTransform: 'none' }}>{resumo.ultimo ? quando(resumo.ultimo) : '—'}</div>
          </div>
        </div>
      )}

      {erro && <div className="errbox">Não consegui carregar: {erro}</div>}
      {!eventos && !erro && <div className="loading">Carregando…</div>}
      {eventos && eventos.length === 0 && (
        <div className="card"><div className="sub" style={{ margin: 0 }}>Nenhum erro registrado. 🎉</div></div>
      )}

      {eventos && eventos.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {eventos.map((e, i) => (
            <div key={i} style={{ padding: '13px 16px', borderTop: i ? '1px solid var(--line)' : 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span className="mono" style={{ fontSize: '.58rem', fontWeight: 700, color: cor(e.nivel), textTransform: 'uppercase' }}>{e.nivel}</span>
                <span className="mono" style={{ fontSize: '.62rem', color: 'var(--dim)', textTransform: 'none' }}>{quando(e.ts)}</span>
                <span className="mono" style={{ fontSize: '.66rem', color: 'var(--cream)', textTransform: 'none' }}>{e.acao}</span>
                {e.status ? <span className="mono" style={{ fontSize: '.62rem', color: 'var(--coral)', background: 'rgba(255,90,90,.1)', padding: '2px 7px', borderRadius: 20 }}>{e.status}</span> : null}
                {e.origem ? <span className="mono" style={{ fontSize: '.56rem', color: 'var(--dim)', marginLeft: 'auto' }}>{e.origem}</span> : null}
              </div>
              <div style={{ marginTop: 5, fontSize: '.88rem', color: 'var(--cream)' }}>{e.mensagem}</div>
              {(e.campo || e.requestId) && (
                <div className="mono" style={{ marginTop: 5, fontSize: '.62rem', color: 'var(--dim)', textTransform: 'none', display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                  {e.campo && <span>campo: <b style={{ color: 'var(--tanger)' }}>{e.campo}</b></span>}
                  {e.requestId && <span>requestId: {e.requestId}</span>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
