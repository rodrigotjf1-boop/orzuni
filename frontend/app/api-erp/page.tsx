'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, type Chave } from '@/lib/api';
import { useToast } from '@/components/toast';

const ESCOPOS = [
  { id: 'catalogo:ler', label: 'ler cardápio' },
  { id: 'preco:escrever', label: 'mudar preço' },
  { id: 'status:escrever', label: 'pausar/reativar' },
];

export default function ApiErpPage() {
  const [chaves, setChaves] = useState<Chave[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [novoNome, setNovoNome] = useState('');
  const [novoEsc, setNovoEsc] = useState<string[]>(['catalogo:ler']);
  const [criada, setCriada] = useState<string | null>(null);
  const toast = useToast();

  const carregar = useCallback(async () => {
    try {
      setChaves((await api.chaves.listar()).chaves);
      setErro(null);
    } catch (e: any) {
      setErro(e.message);
    }
  }, []);
  useEffect(() => {
    carregar();
  }, [carregar]);

  async function criar() {
    if (!novoNome.trim()) return;
    try {
      const r = await api.chaves.criar(novoNome.trim(), novoEsc);
      setCriada(r.chave);
      setNovoNome('');
      carregar();
    } catch (e: any) {
      toast(`Erro: ${e.message}`);
    }
  }
  async function revogar(id: string, nome: string) {
    if (!confirm(`Revogar a chave "${nome}"? O acesso é cortado na hora.`)) return;
    await api.chaves.revogar(id);
    toast('Chave revogada.');
    carregar();
  }

  const card = { border: '1px solid var(--line)', borderRadius: 20, background: 'rgba(23,17,20,.85)', padding: 22, marginBottom: 18 } as const;
  const box = { background: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 11, color: 'var(--cream)', fontFamily: 'inherit', fontSize: '.9rem', padding: '10px 13px' } as const;

  return (
    <>
      <div className="topbar">
        <div>
          <h1>
            API &amp; <span>ERP</span>
          </h1>
          <div className="sub">Conecte Saipos, Eclética, TOTVS, o Regem ou qualquer sistema. Eles editam o cardápio; o Orzuni publica no iFood.</div>
        </div>
      </div>

      {erro && <div className="errbox">Não consegui carregar: {erro}</div>}

      {/* criar */}
      <div style={card}>
        <h2 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: 6 }}>Nova chave</h2>
        <div className="sub" style={{ marginBottom: 16 }}>Uma chave por sistema conectado, com escopo próprio. O segredo aparece só uma vez.</div>
        {criada ? (
          <div style={{ border: '1px solid rgba(255,162,38,.5)', borderRadius: 12, background: 'rgba(255,162,38,.06)', padding: 16 }}>
            <div className="mono" style={{ color: 'var(--tanger)', marginBottom: 8 }}>copie agora — não será mostrada de novo</div>
            <div className="mono" style={{ fontSize: '.82rem', wordBreak: 'break-all', textTransform: 'none', letterSpacing: 0, marginBottom: 12 }}>{criada}</div>
            <div style={{ display: 'flex', gap: 9 }}>
              <button
                className="btn mini"
                onClick={() => {
                  navigator.clipboard?.writeText(criada);
                  toast('Copiada.');
                }}
              >
                Copiar
              </button>
              <button className="btn ghost mini" onClick={() => setCriada(null)}>
                Pronto, guardei
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <input style={{ ...box, flex: 1, minWidth: 200 }} placeholder="Nome (ex.: Saipos · Burger Centro)" value={novoNome} onChange={(e) => setNovoNome(e.target.value)} />
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
              {ESCOPOS.map((e) => {
                const on = novoEsc.includes(e.id);
                return (
                  <button
                    key={e.id}
                    onClick={() => setNovoEsc((s) => (on ? s.filter((x) => x !== e.id) : [...s, e.id]))}
                    className="mono"
                    style={{
                      fontSize: '.6rem',
                      padding: '7px 11px',
                      borderRadius: 99,
                      border: '1px solid var(--line)',
                      cursor: 'pointer',
                      background: on ? 'var(--accent-soft, rgba(139,92,246,.15))' : 'var(--ink3)',
                      color: on ? 'var(--lilac)' : 'var(--dim)',
                    }}
                  >
                    {e.label}
                  </button>
                );
              })}
            </div>
            <button className="btn" disabled={!novoNome.trim()} onClick={criar}>
              Gerar chave
            </button>
          </div>
        )}
      </div>

      {/* lista */}
      <div style={card}>
        <h2 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: 16 }}>Chaves ativas</h2>
        {!chaves && !erro && <div className="loading">Carregando…</div>}
        {chaves && chaves.length === 0 && <div className="sub" style={{ margin: 0 }}>Nenhuma chave ainda. Crie a primeira acima.</div>}
        {chaves?.map((c) => (
          <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 0', borderTop: '1px solid var(--line)' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <b style={{ fontSize: '.92rem' }}>{c.nome}</b>
              <div className="mono" style={{ color: 'var(--dim)', fontSize: '.7rem', textTransform: 'none', marginTop: 3 }}>
                {c.prefixo}••••••••
              </div>
              <div style={{ display: 'flex', gap: 5, marginTop: 6, flexWrap: 'wrap' }}>
                {c.escopos.map((s) => (
                  <span key={s} className="mono" style={{ fontSize: '.55rem', padding: '3px 8px', borderRadius: 6, background: 'var(--ink3)', color: 'var(--dim)' }}>
                    {s}
                  </span>
                ))}
              </div>
            </div>
            <span className="mono" style={{ color: 'var(--dim)', fontSize: '.6rem', textTransform: 'none' }}>
              {c.ultimoUso ? 'usada' : 'nunca usada'}
            </span>
            <button className="btn ghost mini" onClick={() => revogar(c.id, c.nome)}>
              Revogar
            </button>
          </div>
        ))}
      </div>

      {/* endpoints */}
      <div style={card}>
        <h2 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: 6 }}>Endpoints</h2>
        <div className="sub" style={{ marginBottom: 16 }}>
          Base <span className="mono" style={{ color: 'var(--lilac)', textTransform: 'none' }}>https://api.orzuni.com/v1</span> · autenticação <span className="mono" style={{ color: 'var(--lilac)', textTransform: 'none' }}>Bearer</span> da chave. O ERP fala por <b>código de PDV</b> — não precisa conhecer id do iFood.
        </div>
        <pre style={{ background: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 10, padding: 14, overflowX: 'auto', fontFamily: 'var(--font-mono)', fontSize: '.74rem', lineHeight: 1.7, margin: 0 }}>
{`GET    /cardapio                 → itens + estado + promoção
PATCH  /precos                   → { "itens":[{"pdv":"cw4620855","preco":33.5}] }
PATCH  /itens/{pdv}/status        → { "status":"pausado" }
GET    /vigia/alertas             → o vigia como serviço (fora do ar + desde)`}
        </pre>
      </div>
    </>
  );
}
