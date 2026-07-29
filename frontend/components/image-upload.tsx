'use client';
import { useRef, useState } from 'react';

// O upload do iFood retorna 500 com imagens pesadas (ex.: 4500×3000 ou ~5 MB).
// Redimensionamos e comprimimos em JPEG no cliente até o payload ficar leve.
const ALVO = 1_400_000; // ~1 MB de payload base64 (o iFood aceita bem abaixo do que quebra)

/** Redimensiona + comprime (JPEG) reduzindo dimensão/qualidade até caber; devolve o data-URI. */
export function processar(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const render = (max: number, q: number): string | null => {
        let { width, height } = img;
        const maior = Math.max(width, height);
        if (maior > max) {
          const s = max / maior;
          width = Math.round(width * s);
          height = Math.round(height * s);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.drawImage(img, 0, 0, width, height);
        return canvas.toDataURL('image/jpeg', q);
      };
      // tenta progressivamente menor/mais comprimido até o payload ficar leve
      const tentativas: Array<[number, number]> = [[1600, 0.82], [1400, 0.75], [1200, 0.68], [1000, 0.6], [800, 0.55]];
      for (const [max, q] of tentativas) {
        const uri = render(max, q);
        if (!uri) return reject(new Error('canvas'));
        if (uri.length <= ALVO || max === 800) return resolve(uri);
      }
      reject(new Error('canvas'));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('imagem inválida'));
    };
    img.src = url;
  });
}

/**
 * Seletor de imagem com os limites do iFood: **JPG/JPEG/PNG, até 5 MB**.
 * Redimensiona no cliente (máx. 1600px, JPEG) — evita o 500 do upload do iFood
 * com fotos de alta resolução — e devolve o data-URI. onPick(null) = removida.
 */
export function ImageUpload({ value, onPick }: { value?: string | null; onPick: (dataUri: string | null) => void }) {
  const [erro, setErro] = useState('');
  const [processando, setProcessando] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  async function handle(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setErro('');
    if (!['image/jpeg', 'image/jpg', 'image/png'].includes(f.type)) {
      setErro('Formato inválido — use JPG ou PNG.');
      return;
    }
    if (f.size > 15 * 1024 * 1024) {
      setErro(`Arquivo muito grande (${(f.size / 1024 / 1024).toFixed(1)} MB).`);
      return;
    }
    setProcessando(true);
    try {
      onPick(await processar(f));
    } catch {
      setErro('Não consegui processar a imagem.');
    } finally {
      setProcessando(false);
    }
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
          <button className="btn ghost mini" disabled={processando} onClick={() => ref.current?.click()}>
            {processando ? 'Processando…' : value ? 'Trocar foto' : 'Escolher foto'}
          </button>
          {value && (
            <button className="btn ghost mini" style={{ marginLeft: 8 }} onClick={remover}>
              Remover
            </button>
          )}
          <div className="sub" style={{ marginTop: 6, fontSize: '.68rem' }}>JPG ou PNG · ajustamos o tamanho automaticamente</div>
        </div>
      </div>
      {erro && <div className="sub" style={{ marginTop: 8, color: 'var(--coral)' }}>{erro}</div>}
    </div>
  );
}

/**
 * Seletor de imagem COMPACTO (quadradinho) para linhas densas — ex.: opção de
 * complemento. Mesmos limites (JPG/PNG) e o MESMO resize no cliente (evita o 500
 * do iFood com fotos pesadas). Clique = escolher; clique com foto = trocar.
 */
export function ImagemMini({ value, onPick, titulo = 'Foto da opção' }: { value?: string | null; onPick: (dataUri: string | null) => void; titulo?: string }) {
  const [proc, setProc] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  async function handle(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!['image/jpeg', 'image/jpg', 'image/png'].includes(f.type)) return;
    setProc(true);
    try {
      onPick(await processar(f));
    } catch {
      /* ignora — mantém a foto atual */
    } finally {
      setProc(false);
      if (ref.current) ref.current.value = '';
    }
  }
  return (
    <div style={{ position: 'relative', flex: 'none' }}>
      <input ref={ref} type="file" accept="image/jpeg,image/png" onChange={handle} style={{ display: 'none' }} />
      <button
        type="button"
        title={value ? 'Trocar foto' : titulo}
        onClick={() => ref.current?.click()}
        style={{ width: 38, height: 38, borderRadius: 9, border: '1px dashed var(--line)', background: value ? 'transparent' : 'var(--ink)', overflow: 'hidden', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <span className="mono" style={{ fontSize: '.5rem', color: 'var(--dim)' }}>{proc ? '…' : 'foto'}</span>
        )}
      </button>
      {value && (
        <button type="button" title="Remover foto" onClick={() => onPick(null)} aria-label="Remover foto" style={{ position: 'absolute', top: -6, right: -6, width: 16, height: 16, borderRadius: 8, border: 'none', background: 'var(--coral, #e5533d)', color: '#fff', fontSize: '.6rem', lineHeight: '16px', cursor: 'pointer', padding: 0 }}>
          ×
        </button>
      )}
    </div>
  );
}
