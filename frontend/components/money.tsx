'use client';
import type { CSSProperties } from 'react';

/** Formata reais em pt-BR (12.9 → "12,90"). */
export const brl = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Campo de moeda BRL à prova de erro: o usuário só digita dígitos e o valor
 * preenche os centavos da DIREITA para a esquerda (1234 → R$ 12,34). Não há como
 * errar separador de milhar/decimal. Guarda e devolve o valor numérico em reais.
 */
export function MoneyInput({
  valor,
  onChange,
  placeholder = '0,00',
  style,
  disabled,
  ariaLabel,
}: {
  valor: number;
  onChange: (reais: number) => void;
  placeholder?: string;
  style?: CSSProperties;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const display = valor ? brl(valor) : '';
  function handle(e: React.ChangeEvent<HTMLInputElement>) {
    const digits = e.target.value.replace(/\D/g, '').slice(0, 12); // até bilhões
    onChange(digits ? parseInt(digits, 10) / 100 : 0);
  }
  const base: CSSProperties = {
    width: '100%',
    background: 'var(--ink)',
    border: '1px solid var(--line)',
    borderRadius: 11,
    color: 'var(--cream)',
    fontFamily: 'var(--font-mono)',
    fontSize: '.9rem',
    padding: '11px 13px 11px 34px',
    textAlign: 'right',
    textTransform: 'none',
  };
  return (
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', width: style?.width ?? '100%' }}>
      <span className="mono" style={{ position: 'absolute', left: 12, color: 'var(--dim)', fontSize: '.72rem', textTransform: 'none', pointerEvents: 'none' }}>
        R$
      </span>
      <input
        inputMode="numeric"
        disabled={disabled}
        aria-label={ariaLabel}
        value={display}
        onChange={handle}
        placeholder={placeholder}
        style={{ ...base, ...style }}
      />
    </span>
  );
}
