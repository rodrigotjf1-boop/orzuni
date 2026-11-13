'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';

// A VOLTA do "Conectar pelo Regem" (Padrão DMS §3). O Regem devolve o navegador para cá com `code`, `state` e `iss`
// (ou `error`, quando o presidente não autorizou). Esta página só entrega isso ao servidor do Orzuni, que confere o
// pedido de quem começou e troca o código pela ligação da loja. O código vale UMA vez: por isso sai do endereço na hora
// e o envio acontece uma vez só.

type Fase = 'concluindo' | 'recusado' | 'erro';

export default function VoltaDoRegemPage() {
  const [fase, setFase] = useState<Fase>('concluindo');
  const [erro, setErro] = useState('');
  const enviado = useRef(false);

  useEffect(() => {
    if (enviado.current) return;
    enviado.current = true;
    const q = new URLSearchParams(window.location.search);
    const volta = {
      code: q.get('code') ?? undefined,
      state: q.get('state') ?? undefined,
      iss: q.get('iss') ?? undefined,
      error: q.get('error') ?? undefined,
    };
    // o código e o state não ficam no endereço (histórico, "voltar", print da tela)
    window.history.replaceState(null, '', window.location.pathname);
    api.importarRegem
      .cliqueConcluir(volta)
      .then((r) => {
        if (r.ok && r.situacao === 'conectado') {
          window.location.replace('/importar?conectado=1');
        } else if (r.ok && r.situacao === 'recusado') {
          setFase('recusado');
        } else {
          setErro(r.erro || 'Não foi possível concluir a conexão com o Regem.');
          setFase('erro');
        }
      })
      .catch(() => {
        setErro('Não foi possível concluir a conexão agora. Comece de novo pelo botão "Conectar pelo Regem".');
        setFase('erro');
      });
  }, []);

  return (
    <div style={{ padding: '28px clamp(16px, 4vw, 40px)', maxWidth: 560, margin: '0 auto' }}>
      <section className="card" aria-live="polite">
        {fase === 'concluindo' && (
          <>
            <h1 style={{ fontSize: '1.2rem', fontWeight: 800, letterSpacing: '-.02em', marginBottom: 6 }}>Concluindo a conexão com o Regem…</h1>
            <div className="sub">Só um instante. Não feche esta página.</div>
          </>
        )}
        {fase === 'recusado' && (
          <>
            <h1 style={{ fontSize: '1.2rem', fontWeight: 800, letterSpacing: '-.02em', marginBottom: 6 }}>A conexão não foi autorizada</h1>
            <div className="sub" style={{ marginBottom: 16 }}>No Regem, a autorização foi cancelada. Nada mudou: o Orzuni não recebeu acesso nenhum.</div>
            <Link className="btn" href="/importar" style={{ justifyContent: 'center' }}>
              Voltar para Importar do Regem
            </Link>
          </>
        )}
        {fase === 'erro' && (
          <>
            <h1 style={{ fontSize: '1.2rem', fontWeight: 800, letterSpacing: '-.02em', marginBottom: 6 }}>Não deu para concluir a conexão</h1>
            <div role="alert" style={{ color: 'var(--coral)', fontSize: '.9rem', marginBottom: 16 }}>
              {erro}
            </div>
            <Link className="btn" href="/importar" style={{ justifyContent: 'center' }}>
              Voltar para Importar do Regem
            </Link>
          </>
        )}
      </section>
    </div>
  );
}
