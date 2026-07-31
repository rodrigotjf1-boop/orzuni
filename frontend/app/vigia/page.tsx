'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, type Alerta } from '@/lib/api';
import { useToast } from '@/components/toast';

const MOTIVO: Record<string, { label: string; cls: string }> = {
  cascade: { label: 'caiu em cascata', cls: 'off' },
  manual: { label: 'pausa esquecida', cls: 'off' },
  stock: { label: 'sem estoque', cls: 'off' },
  unknown: { label: 'fora do ar', cls: 'off' },
};

function dur(ms: number) {
  const d = Math.floor(ms / 864e5),
    h = Math.floor((ms % 864e5) / 36e5),
    m = Math.floor((ms % 36e5) / 6e4);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}min` : `${m}min`;
}

export default function VigiaPage() {
  const [alertas, setAlertas] = useState<Alerta[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [lojaAberta, setLojaAberta] = useState<boolean | null>(null); // status real do merchant
  const toast = useToast();

  const carregar = useCallback(async () => {
    try {
      const r = await api.alertas();
      setAlertas(r.alertas);
      setErro(null);
    } catch (e: any) {
      setErro(e.message);
    }
    // status real da loja (não bloqueia os alertas se falhar)
    try {
      const p = await api.loja.painel();
      setLojaAberta(p.status?.aberta ?? null);
    } catch {
      setLojaAberta(null);
    }
  }, []);

  useEffect(() => {
    carregar();
    const t = setInterval(carregar, 30000);
    return () => clearInterval(t);
  }, [carregar]);

  async function reativar(pdv: string, nome: string) {
    try {
      await api.status(pdv, 'no_ar');
      toast(`<b style="color:var(--green)">${nome}</b> reativado — de volta ao ar.`);
      setTimeout(carregar, 1500);
    } catch (e: any) {
      toast(`Erro ao reativar: ${e.message}`);
    }
  }

  const fora = alertas?.length ?? 0;
  const cascata = alertas?.filter((a) => a.motivo === 'cascade').length ?? 0;
  const maisTempo = alertas && alertas.length ? dur(alertas[0].foraHaMs) : '—';

  return (
    <>
      <div className="topbar">
        <div>
          <h1>
            Fora do <span>ar</span>
          </h1>
          <div className="sub">O que o cliente não consegue pedir no seu iFood — e há quanto tempo.</div>
        </div>
        <button className="btn ghost mini" onClick={carregar}>
          Atualizar
        </button>
      </div>

      <div className="stats">
        <div className="stat crit">
          <div className="label mono">fora do ar</div>
          <div className="value">{fora}</div>
        </div>
        <div className="stat hot">
          <div className="label mono">em cascata</div>
          <div className="value">{cascata}</div>
        </div>
        <div className="stat">
          <div className="label mono">mais tempo parado</div>
          <div className="value" style={{ fontSize: '1.6rem' }}>
            {maisTempo}
          </div>
        </div>
        <div className={`stat ${lojaAberta === false ? 'crit' : 'ok'}`}>
          <div className="label mono">status da loja</div>
          <div className="value" style={{ fontSize: '1.4rem', color: lojaAberta === false ? 'var(--coral)' : lojaAberta ? 'var(--green)' : undefined }}>
            {lojaAberta === null ? (erro ? 'erro' : '—') : lojaAberta ? 'aberta' : 'fechada'}
          </div>
        </div>
      </div>

      {erro && <div className="errbox">Não consegui falar com a API: {erro}</div>}
      {!alertas && !erro && <div className="loading">Carregando…</div>}
      {alertas && alertas.length === 0 && !erro && (
        <div className="card" style={{ textAlign: 'center', color: 'var(--green)', fontWeight: 800, fontSize: '1.1rem' }}>
          Cardápio 100% no ar 🎉
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {alertas?.map((a) => {
          const m = MOTIVO[a.motivo] ?? MOTIVO.unknown;
          return (
            <div
              key={a.pdv ?? a.nome}
              className="card"
              style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', borderLeft: '3px solid var(--coral)' }}
            >
              <div style={{ flex: 1, minWidth: 180 }}>
                <span className={`pill ${m.cls}`}>{m.label}</span>
                <div style={{ fontWeight: 700, fontSize: '1.15rem', marginTop: 8 }}>{a.nome}</div>
                <div className="mono" style={{ color: 'var(--dim)', marginTop: 3, letterSpacing: '.05em', textTransform: 'none' }}>
                  PDV {a.pdv ?? '—'}
                  {a.grupoAfetado ? ` · grupo “${a.grupoAfetado}” sem opção` : ''}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="mono" style={{ color: 'var(--dim)', fontSize: '.58rem' }}>
                  fora do ar há
                </div>
                <div className="mono" style={{ color: 'var(--coral)', fontSize: '1.4rem', textTransform: 'none' }}>
                  {dur(a.foraHaMs)}
                </div>
              </div>
              {a.pdv && (
                <button className="btn mini" onClick={() => reativar(a.pdv!, a.nome)}>
                  Reativar
                </button>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
