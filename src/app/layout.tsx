import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'Peclat Solar | CRM', description: 'A operação comercial da Peclat Solar em um só lugar.', robots: { index: false, follow: false } };
const themeInitializer = `(()=>{let theme='light';try{theme=localStorage.getItem('peclat-crm-theme')==='dark'?'dark':'light'}catch{}document.documentElement.dataset.theme=theme;document.documentElement.style.colorScheme=theme})();`;
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR" data-theme="light" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{__html:themeInitializer}}/></head><body>{children}</body></html>;
}
