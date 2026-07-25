'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);
  const router = useRouter();

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setErro('');
    setCarregando(true);
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ senha }),
      });
      if (res.ok) {
        router.replace('/vigia');
        router.refresh();
      } else {
        const j = await res.json().catch(() => ({}));
        setErro(j.erro === 'muitas tentativas' ? 'Muitas tentativas. Aguarde um minuto.' : 'Senha inválida.');
      }
    } catch {
      setErro('Falha de conexão.');
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 20, position: 'relative', zIndex: 1 }}>
      <form onSubmit={entrar} className="card" style={{ width: 360, maxWidth: '100%', textAlign: 'center' }}>
        <svg viewBox="0 0 100 100" width={48} height={48} style={{ margin: '4px auto 14px', display: 'block', filter: 'drop-shadow(0 0 10px rgba(255,68,56,.5))' }}>
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
        <div style={{ fontWeight: 800, fontSize: '1.4rem', letterSpacing: '-.02em', marginBottom: 4 }}>orzuni</div>
        <div className="mono" style={{ fontSize: '.58rem', color: 'var(--tanger)', letterSpacing: '.16em', marginBottom: 10 }}>gestão de cardápio · iFood</div>
        <div className="sub" style={{ marginBottom: 22 }}>Gerencie o cardápio do seu iFood — sem abrir o portal.</div>
        <input
          type="password"
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          placeholder="Senha"
          autoFocus
          style={{
            width: '100%',
            background: 'var(--ink)',
            border: '1px solid var(--line)',
            borderRadius: 11,
            color: 'var(--cream)',
            fontFamily: 'inherit',
            fontSize: '.95rem',
            padding: '12px 14px',
            marginBottom: 12,
          }}
        />
        {erro && <div style={{ color: 'var(--coral)', fontSize: '.82rem', marginBottom: 12 }}>{erro}</div>}
        <button className="btn" type="submit" disabled={carregando || !senha} style={{ width: '100%', justifyContent: 'center' }}>
          {carregando ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
