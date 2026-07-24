'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV = [
  { href: '/vigia', label: 'Vigia', icon: 'vigia' },
  { href: '/cardapio', label: 'Cardápio', icon: 'menu' },
  { href: '/precos', label: 'Preços', icon: 'price' },
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
  if (name === 'menu')
    return (
      <svg viewBox="0 0 24 24">
        <path d="M4 6h16M4 12h16M4 18h11" strokeLinecap="round" />
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
          orzuni
        </div>
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className={`nav-item${path.startsWith(n.href) ? ' active' : ''}`}>
            <Icon name={n.icon} />
            <span>{n.label}</span>
          </Link>
        ))}
        <div className="spacer" />
        <div className="hint">
          Conectado a <b>api.orzuni.com</b>. Todas as ações refletem no iFood da loja integrada.
        </div>
      </aside>
      <main>{children}</main>
    </div>
  );
}
