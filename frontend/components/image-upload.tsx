'use client';
import { useRef, useState } from 'react';

/**
 * Seletor de imagem com os limites do iFood: **JPG/JPEG/PNG, até 5 MB**.
 * Valida no cliente (tipo + tamanho), mostra preview e devolve o data-URI base64
 * (formato que o endpoint de upload do iFood espera). onPick(null) = removida.
 */
export function ImageUpload({ value, onPick }: { value?: string | null; onPick: (dataUri: string | null) => void }) {
  const [erro, setErro] = useState('');
  const ref = useRef<HTMLInputElement>(null);

  function handle(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setErro('');
    if (!['image/jpeg', 'image/jpg', 'image/png'].includes(f.type)) {
      setErro('Formato inválido — use JPG ou PNG.');
      return;
    }
    if (f.size > 5 * 1024 * 1024) {
      setErro(`Imagem muito grande (${(f.size / 1024 / 1024).toFixed(1)} MB) — máximo 5 MB.`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => onPick(reader.result as string);
    reader.onerror = () => setErro('Não consegui ler o arquivo.');
    reader.readAsDataURL(f);
  }

  function remover() {
    onPick(null);
    if (ref.current) ref.current.value = '';
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div
          style={{
            width: 84,
            height: 84,
            borderRadius: 12,
            border: '1px dashed var(--line)',
            background: 'var(--ink)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            flex: 'none',
          }}
        >
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt="Prévia" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <span className="mono" style={{ fontSize: '.55rem', color: 'var(--dim)', textAlign: 'center', padding: 4 }}>sem foto</span>
          )}
        </div>
        <div>
          <input ref={ref} type="file" accept="image/jpeg,image/png" onChange={handle} style={{ display: 'none' }} id="img-upl" />
          <button className="btn ghost mini" onClick={() => ref.current?.click()}>
            {value ? 'Trocar foto' : 'Escolher foto'}
          </button>
          {value && (
            <button className="btn ghost mini" style={{ marginLeft: 8 }} onClick={remover}>
              Remover
            </button>
          )}
          <div className="sub" style={{ marginTop: 6, fontSize: '.68rem' }}>JPG ou PNG · até 5 MB</div>
        </div>
      </div>
      {erro && <div className="sub" style={{ marginTop: 8, color: 'var(--coral)' }}>{erro}</div>}
    </div>
  );
}
