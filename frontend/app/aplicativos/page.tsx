'use client';
import { useEffect, useState } from 'react';
import { autorizacao, type AplicativoConectado } from '@/lib/autorizacao';

// Aplicativos conectados (Padrão DMS §3): o que cada aplicativo pode fazer em cada loja, o texto que o dono leu ao
// autorizar e o desligar — que vale na chamada seguinte do aplicativo.

const quando = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'ainda não usou';

export default function AplicativosPage() {
  const [lista, setLista] = useState<AplicativoConectado[] | null>(null);
  const [erro, setErro] = useState('');
  const [confirmando, setConfirmando] = useState('');
  const [desligando, setDesligando] = useState('');
  const [aviso, setAviso] = useState('');

  async function carregar() {
    setErro('');
    try {
      setLista(await autorizacao.conectados());
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui carregar agora.');
    }
  }

  useEffect(() => {
    carregar();
  }, []);

  async function desligar(a: AplicativoConectado) {
    setDesligando(a.id);
    setErro('');
    try {
      await autorizacao.desligar(a.id);
      setAviso(`${a.aplicativo} desligado da loja ${a.loja}. Ele perde o acesso na próxima chamada.`);
      setConfirmando('');
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui desligar agora.');
    } finally {
      setDesligando('');
    }
  }

  return (
    <div style={{ padding: '28px clamp(16px, 4vw, 40px)', maxWidth: 760, margin: '0 auto', display: 'grid', gap: 16 }}>
      <div>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 800, letterSpacing: '-.02em', margin: '0 0 4px' }}>Aplicativos conectados</h1>
        <div className="sub">Os sistemas que você autorizou a mexer nas suas lojas do iFood. Desligar vale na hora.</div>
      </div>

      {aviso && (
        <div role="status" className="card" style={{ padding: '10px 14px', borderColor: 'rgba(76,217,100,.5)' }}>
          {aviso}
        </div>
      )}
      {erro && (
        <div role="alert" style={{ color: 'var(--coral)', fontSize: '.9rem' }}>
          {erro}{' '}
          <button className="btn ghost mini" type="button" onClick={carregar}>
            Tentar de novo
          </button>
        </div>
      )}

      {lista === null && !erro && <div className="sub" role="status">Carregando…</div>}

      {lista && lista.length === 0 && (
        <div className="card" style={{ padding: '18px 16px' }}>
          <b>Nenhum aplicativo conectado</b>
          <div className="sub" style={{ marginTop: 4 }}>Quando você autorizar um sistema (o Regem, por exemplo), ele aparece aqui.</div>
        </div>
      )}

      {lista?.map((a) => (
        <section key={a.id} className="card" style={{ padding: '14px 16px', display: 'grid', gap: 10 }} aria-label={`${a.aplicativo} na loja ${a.loja}`}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 10px' }}>
            <b style={{ fontSize: '1.05rem' }}>{a.aplicativo}</b>
            <span className="sub">na loja {a.loja}</span>
            <span className="sub" style={{ marginLeft: 'auto' }}>{a.via === 'clique' ? 'autorizado por você' : 'ligado pela chave da equipe'}</span>
          </div>
          {(a.quemPediu.nome || a.quemPediu.loja) && (
            <div className="sub">
              Pedido por {a.quemPediu.nome ?? '—'}
              {a.quemPediu.loja ? ` · loja ${a.quemPediu.loja}` : ''}
            </div>
          )}
          <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>
            {a.permissoes.map((p) => (
              <li key={p.id}>{p.frase}</li>
            ))}
          </ul>
          <div className="sub">
            Desde {quando(a.desde)} · último uso: {quando(a.ultimoUso)}
          </div>
          {a.texto && (
            <details>
              <summary style={{ cursor: 'pointer' }}>O texto que você autorizou</summary>
              <pre className="sub" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontFamily: 'inherit', margin: '8px 0 0' }}>{a.texto}</pre>
            </details>
          )}
          {confirmando === a.id ? (
            <div role="alertdialog" aria-label={`Desligar ${a.aplicativo}`} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px', display: 'grid', gap: 8 }}>
              <b>Desligar o {a.aplicativo} da loja {a.loja}?</b>
              <span className="sub">Ele deixa de mexer no cardápio desta loja na próxima chamada. Para voltar, autorize de novo pelo {a.aplicativo}.</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <button className="btn ghost" type="button" onClick={() => setConfirmando('')} disabled={desligando === a.id}>
                  Cancelar
                </button>
                <button className="btn" type="button" onClick={() => desligar(a)} disabled={desligando === a.id}>
                  {desligando === a.id ? 'Desligando…' : 'Desligar'}
                </button>
              </div>
            </div>
          ) : (
            <button className="btn ghost" type="button" style={{ justifySelf: 'start' }} onClick={() => setConfirmando(a.id)}>
              Desligar
            </button>
          )}
        </section>
      ))}
    </div>
  );
}
