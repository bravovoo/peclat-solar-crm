import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'Peclat Solar | CRM', description: 'A operação comercial da Peclat Solar em um só lugar.', robots: { index: false, follow: false } };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body>{children}</body></html>;
}
