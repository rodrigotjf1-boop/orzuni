'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, type Loja } from '@/lib/api';

export default function ConectarPage() {
  const router = useRouter();
  const [minhas, setMinhas] = useState<Loja[]>([]);
  const [disponiveis, setDisponiveis] = useState<Loja[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [conectando, setConectando] = useState('');
  const [msg, setMsg] = useState('');

  async function carregar() {
    setCarregando(true);
    try {
      const [m, d] = await Promise.all([api.minhasLojas.listar(), api.minhasLojas.disponiveis()]);
      setMinhas(m.lojas);
      setDisponiveis(d.lojas);
    } catch {
      setMsg('Não consegui carregar as lojas agora. Tente de novo em instantes.');
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    carregar();
  }, []);

  async function conectar(l: Loja) {
    setConectando(l.merchantId);
    setMsg('');
    try {
      const r = await api.minhasLojas.conectar(l.merchantId, l.nome);
      if (r.ok) {
        setMsg('');
        await carregar();
      } else {
        setMsg(r.erro || 'Não foi possível conectar esta loja.');
      }
    } catch {
      setMsg('Não foi possível conectar esta loja.');
    } finally {
      setConectando('');
    }
  }

  return (
    <div style={{ padding: '28px clamp(16px, 4vw, 40px)', maxWidth: 760, margin: '0 auto' }}>
      <h1 style={{ fontSize: '1.4rem', fontWeight: 800, letterSpacing: '-.02em', marginBottom: 4 }}>Sua loja do iFood</h1>
      <div className="sub" style={{ marginBottom: 24 }}>Conecte a loja do seu iFood para controlar o cardápio por aqui.</div>

      {/* lojas já conectadas */}
      <section className="card" style={{ marginBottom: 18 }}>
        <div style={{ fontWeight: 700, marginBottom: 12 }}>Lojas conectadas</div>
        {carregando ? (
          <div className="sub">Carregando…</div>
        ) : minhas.length === 0 ? (
          <div className="sub">Nenhuma loja do iFood conectada ainda.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {minhas.map((l) => (
              <div key={l.merchantId} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', border: '1px solid var(--line)', borderRadius: 12, background: 'var(--ink2)', padding: '12px 14px' }}>
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: 'var(--green)', flex: 'none', boxShadow: '0 0 8px var(--green)' }} />
                <div style={{ fontWeight: 600, minWidth: 0, flex: 1 }}>{l.nome}</div>
                <button className="btn ghost" onClick={() => router.push('/cardapio')}>
                  Abrir cardápio
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* lojas que dá para conectar */}
      <section className="card">
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Conectar uma loja</div>
        <div className="sub" style={{ marginBottom: 14 }}>
          Para a loja aparecer aqui, autorize o Orzuni no seu iFood (no Portal do Parceiro, em Integrações). Depois é só escolher abaixo.
        </div>
        {carregando ? (
          <div className="sub">Carregando…</div>
        ) : disponiveis.length === 0 ? (
          <div className="sub">Nenhuma loja disponível para conectar. Autorize o Orzuni no iFood e atualize esta página.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {disponiveis.map((l) => (
              <div key={l.merchantId} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', border: '1px solid var(--line)', borderRadius: 12, background: 'var(--ink2)', padding: '12px 14px' }}>
                <div style={{ fontWeight: 600, minWidth: 0, flex: 1 }}>{l.nome}</div>
                <button className="btn" onClick={() => conectar(l)} disabled={conectando === l.merchantId}>
                  {conectando === l.merchantId ? 'Conectando…' : 'Conectar'}
                </button>
              </div>
            ))}
          </div>
        )}
        {msg && <div style={{ color: 'var(--coral)', fontSize: '.84rem', marginTop: 14 }}>{msg}</div>}
        <button className="btn ghost" style={{ marginTop: 16 }} onClick={carregar} disabled={carregando}>
          Atualizar lista
        </button>
      </section>
    </div>
  );
}
