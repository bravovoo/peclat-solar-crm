'use client';
export default function ErrorPage({reset}:{reset:()=>void}) {return <main className="standalone-state"><h1>Não foi possível carregar o ambiente.</h1><p>Confira a disponibilidade do serviço e tente novamente.</p><button className="button primary" onClick={reset}>Tentar novamente</button></main>;}
