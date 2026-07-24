'use client';
import { createContext, useCallback, useContext, useState } from 'react';

type ToastCtx = (msg: string) => void;
const Ctx = createContext<ToastCtx>(() => {});
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [list, setList] = useState<{ id: number; msg: string }[]>([]);
  const push = useCallback((msg: string) => {
    const id = Date.now() + Math.random();
    setList((l) => [...l, { id, msg }]);
    setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), 3000);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div id="toasts">
        {list.map((t) => (
          <div key={t.id} className="toast" dangerouslySetInnerHTML={{ __html: t.msg }} />
        ))}
      </div>
    </Ctx.Provider>
  );
}
