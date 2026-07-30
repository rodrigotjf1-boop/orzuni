'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, lojaAtiva, setLojaAtiva, type Loja } from '@/lib/api';
import { usePending } from '@/components/pending-changes';

const NAV = [
  { href: '/vigia', label: 'Vigia', icon: 'vigia' },
  { href: '/loja', label: 'Loja', icon: 'loja' },
  { href: '/cardapio', label: 'Cardápio', icon: 'menu' },
  { href: '/api-erp', label: 'API & ERP', icon: 'api' },
  { href: '/diagnostico', label: 'Diagnóstico', icon: 'diag' },
];

function Icon({ name }: { name: string }) {
  if (name === 'vigia')
    return (
      <svg viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="3" />
        <circle cx="12" cy="12" r="8" opacity=".5" />
        <path d="M12 4V2M12 22v-2M4 12H2M22 12h-2" strokeLinecap="round" />
      </svg>
    );
  if (name === 'loja')
    return (
      <svg viewBox="0 0 24 24">
        <path d="M4 9l1-4h14l1 4M4 9v10h16V9M4 9h16M9 19v-5h6v5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  if (name === 'menu')
    return (
      <svg viewBox="0 0 24 24">
        <path d="M4 6h16M4 12h16M4 18h11" strokeLinecap="round" />
      </svg>
    );
  if (name === 'api')
    return (
      <svg viewBox="0 0 24 24">
        <path d="M8 7l-4 5 4 5M16 7l4 5-4 5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  if (name === 'diag')
    return (
      <svg viewBox="0 0 24 24">
        <path d="M3 12h4l2 6 4-14 2 8h6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  return (
    <svg viewBox="0 0 24 24">
      <path d="M12 2v20M7 6h8a3 3 0 0 1 0 6H9a3 3 0 0 0 0 6h8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const { navegar } = usePending();
  const [lojas, setLojas] = useState<Loja[]>([]);
  const [loja, setLoja] = useState<string | null>(null);

  useEffect(() => {
    if (path === '/login') return;
    setLoja(lojaAtiva());
    api.lojas
      .listar()
      .then((r) => setLojas(r.lojas))
      .catch(() => {});
  }, [path]);

  function trocarLoja(m: string) {
    navegar(() => {
      setLojaAtiva(m || null);
      window.location.reload();
    });
  }

  // loja iFood conectada (para o indicador). Nome genérico "loja" vira "Loja iFood".
  const ativaId = loja ?? lojas[0]?.merchantId;
  const store = lojas.find((l) => l.merchantId === ativaId) ?? lojas[0];
  const lojaConectada = store && store.nome && store.nome !== 'loja' ? store.nome : 'Loja iFood';

  // o login não usa o shell (sem sidebar)
  if (path === '/login') return <>{children}</>;

  function sair() {
    navegar(async () => {
      await fetch('/api/auth', { method: 'DELETE' });
      window.location.href = '/login';
    });
  }
  return (
    <div className="shell">
      <aside>
        <div className="brand">
          <svg viewBox="0 0 100 100" aria-hidden>
            <defs>
              <linearGradient id="hg" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#FF4438" />
                <stop offset="1" stopColor="#FFA226" />
              </linearGradient>
            </defs>
            <path d="M 57.25 12.70 A 38 38 0 1 0 87.30 42.75" fill="none" stroke="url(#hg)" strokeWidth="11.4" strokeLinecap="round" />
            <circle cx="76.87" cy="23.13" r="8.2" fill="#FFA226" />
            <circle cx="50" cy="50" r="11.4" fill="#FF6031" />
          </svg>
          <div style={{ lineHeight: 1.1 }}>
            orzuni
            <div className="mono" style={{ fontSize: '.52rem', color: 'var(--dim)', letterSpacing: '.14em', marginTop: 2 }}>cardápio iFood</div>
          </div>
        </div>
        {lojas.length > 1 && (
          <select
            value={loja ?? lojas[0]?.merchantId ?? ''}
            onChange={(e) => trocarLoja(e.target.value)}
            aria-label="Loja"
            style={{ background: 'var(--ink2)', border: '1px solid var(--line)', borderRadius: 10, color: 'var(--cream)', fontFamily: 'inherit', fontSize: '.82rem', padding: '9px 11px', marginBottom: 8, cursor: 'pointer' }}
          >
            {lojas.map((l) => (
              <option key={l.merchantId} value={l.merchantId}>
                {l.nome}
              </option>
            ))}
          </select>
        )}
        {NAV.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className={`nav-item${path.startsWith(n.href) ? ' active' : ''}`}
            onClick={(e) => {
              if (path.startsWith(n.href)) return; // já está na tela
              e.preventDefault();
              navegar(() => router.push(n.href));
            }}
          >
            <Icon name={n.icon} />
            <span>{n.label}</span>
          </Link>
        ))}
        <div className="spacer" />
        <div style={{ border: '1px solid var(--line)', borderRadius: 14, background: 'var(--ink2)', padding: '12px 13px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: 'var(--green)', flex: 'none', boxShadow: '0 0 8px var(--green)' }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: '.82rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {lojaConectada}
            </div>
            <div className="mono" style={{ fontSize: '.56rem', color: 'var(--dim)', marginTop: 2 }}>
              iFood · conectado
            </div>
          </div>
        </div>
        <button className="nav-item" onClick={sair} style={{ marginTop: 8, cursor: 'pointer', background: 'none', font: 'inherit', width: '100%' }}>
          <svg viewBox="0 0 24 24">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>Sair</span>
        </button>
      </aside>
      <main>{children}</main>
    </div>
  );
}
