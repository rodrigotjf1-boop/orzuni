'use client';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';

export interface Pendencia {
  titulo: string; // ex.: "Trio01"
  mudancas: string[]; // lista legível do que mudou e não foi publicado
  publicar: () => Promise<boolean>; // aplica; true = sucesso
  descartar: () => void; // volta ao estado original
}

interface PendingCtx {
  registrar: (p: Pendencia | null) => void; // a página registra/limpa a pendência
  navegar: (fn: () => void) => void; // o menu chama para navegar com a guarda
  ativo: boolean;
}

const Ctx = createContext<PendingCtx | null>(null);
export function usePending(): PendingCtx {
  return useContext(Ctx) ?? { registrar: () => {}, navegar: (fn) => fn(), ativo: false };
}

export function PendingProvider({ children }: { children: React.ReactNode }) {
  const [pend, setPend] = useState<Pendencia | null>(null);
  const [acao, setAcao] = useState<(() => void) | null>(null); // navegação aguardando decisão
  const [processando, setProcessando] = useState(false);

  const registrar = useCallback((p: Pendencia | null) => setPend(p), []);
  const navegar = useCallback(
    (fn: () => void) => {
      if (pend) setAcao(() => fn);
      else fn();
    },
    [pend],
  );

  // avisa ao fechar/atualizar a aba com alterações pendentes (prompt nativo)
  useEffect(() => {
    if (!pend) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [pend]);

  async function publicarESeguir() {
    if (!pend || !acao) return;
    setProcessando(true);
    const ok = await pend.publicar().catch(() => false);
    setProcessando(false);
    if (ok) {
      const go = acao;
      setAcao(null);
      setPend(null);
      go();
    } else {
      // falhou: fecha o modal e deixa o usuário ver o erro (toast) e tentar de novo — não navega
      setAcao(null);
    }
  }
  function descartarESeguir() {
    if (!pend || !acao) return;
    pend.descartar();
    const go = acao;
    setAcao(null);
    setPend(null);
    go();
  }

  return (
    <Ctx.Provider value={{ registrar, navegar, ativo: !!pend }}>
      {children}
      {acao && pend && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 16 }} onClick={() => !processando && setAcao(null)}>
          <div className="card" onClick={(e) => e.stopPropagation()} style={{ width: 'min(460px, 100%)' }}>
            <h2 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: 4 }}>Alterações não publicadas</h2>
            <div className="sub" style={{ marginBottom: 12 }}>
              Você mexeu em <b>{pend.titulo}</b> e ainda não publicou. O que deseja fazer?
            </div>
            {pend.mudancas.length > 0 && (
              <div style={{ border: '1px solid var(--line)', borderRadius: 10, background: 'var(--ink)', padding: '10px 12px', marginBottom: 16 }}>
                <div className="mono" style={{ fontSize: '.55rem', color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 6 }}>alterações pendentes</div>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {pend.mudancas.map((m, i) => (
                    <li key={i} style={{ fontSize: '.86rem', color: 'var(--cream)', margin: '3px 0' }}>{m}</li>
                  ))}
                </ul>
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button className="btn ghost mini" disabled={processando} onClick={() => setAcao(null)}>Cancelar</button>
              <button className="btn ghost mini" disabled={processando} onClick={descartarESeguir}>Descartar e sair</button>
              <button className="btn" disabled={processando} onClick={publicarESeguir}>{processando ? 'Publicando…' : 'Publicar e sair'}</button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}
