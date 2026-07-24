import type { Metadata } from 'next';
import { Outfit, DM_Mono } from 'next/font/google';
import './globals.css';
import Shell from '@/components/shell';
import { ToastProvider } from '@/components/toast';

const outfit = Outfit({ subsets: ['latin'], weight: ['400', '500', '700', '800', '900'], variable: '--font-outfit' });
const mono = DM_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-mono' });

export const metadata: Metadata = {
  title: 'Orzuni · Cardápio iFood',
  description: 'Controle do cardápio do iFood — vigia, preços e edição.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${outfit.variable} ${mono.variable}`}>
      <body>
        <ToastProvider>
          <Shell>{children}</Shell>
        </ToastProvider>
      </body>
    </html>
  );
}
