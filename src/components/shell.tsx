'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LayoutDashboard, Users, Building2, Target, GitBranch, MessageCircle, FileText, FileCheck, Wrench, HeartHandshake, CalendarDays, CheckSquare, Folder, ChartNoAxesCombined, Workflow, Settings, Menu, X, LogOut, ChevronRight, Sun, LockKeyhole, Package } from 'lucide-react';
import { Brand } from './brand';
import { GlobalSearch } from './crm/global-search';
import type { Actor } from '@/modules/auth/policy';
const futureItems = [ ['WhatsApp',MessageCircle],['Propostas',FileText],['Contratos',FileCheck],['Instalações',Wrench],['Pós-venda',HeartHandshake],['Documentos',Folder],['Relatórios',ChartNoAxesCombined],['Automação',Workflow] ] as const;
export function Shell({ actor, children }: {actor: Actor; children: React.ReactNode}) {
  const router=useRouter();
  const sidebarRef=useRef<HTMLElement>(null);
  const menuRef=useRef<HTMLButtonElement>(null);
  const [open,setOpen]=useState(false); const [busy,setBusy]=useState(false); const [error,setError]=useState('');
  const path=usePathname(); const commercial=actor.permissions.some(p=>p==='crm.all'||p==='crm.own'); const section=path.split('/')[1]; const title=({equipe:'Equipe',configuracoes:'Configurações',leads:'Leads',clientes:'Clientes',empresas:'Empresas',tags:'Tags',pipeline:'Pipeline',oportunidades:'Oportunidades',tarefas:'Tarefas',agenda:'Agenda','follow-up':'Follow-up','catalogo-solar':'Catálogo solar'} as Record<string,string>)[section]??'Dashboard';
  useEffect(()=>{
    if(!open)return;
    const menuButton=menuRef.current;
    const previousOverflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    sidebarRef.current?.querySelector<HTMLButtonElement>('.mobile-close')?.focus();
    const media=window.matchMedia('(min-width: 641px)');
    const resize=()=>{if(media.matches)setOpen(false);};
    const keydown=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){event.preventDefault();setOpen(false);return;}
      if(event.key!=='Tab')return;
      const elements=Array.from(sidebarRef.current?.querySelectorAll<HTMLElement>('a[href],button,summary')??[]).filter(element=>element.getClientRects().length>0);
      const first=elements[0],last=elements.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    };
    document.addEventListener('keydown',keydown);media.addEventListener('change',resize);
    return ()=>{document.body.style.overflow=previousOverflow;document.removeEventListener('keydown',keydown);media.removeEventListener('change',resize);menuButton?.focus();};
  },[open]);
  async function signOut() {
    setBusy(true); setError('');
    try { const response=await fetch('/api/auth/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}); if (!response.ok) throw new Error(); router.replace('/login'); router.refresh(); }
    catch {setError('Não foi possível sair. Tente novamente.');setBusy(false);}
  }
  return <div className="app-shell"><a className="skip-link" href="#main" inert={open}>Pular para o conteúdo</a>{open&&<div className="sidebar-overlay" aria-hidden="true" onClick={()=>setOpen(false)}/>}
    <aside id="workspace-menu" ref={sidebarRef} role={open?'dialog':undefined} aria-modal={open?true:undefined} aria-label={open?'Menu principal':undefined} className={`sidebar ${open?'is-open':''}`}><div className="sidebar-brand"><Brand/><button className="mobile-close icon-button" aria-label="Fechar menu" onClick={()=>setOpen(false)}><X size={20}/></button></div><div className="workspace"><span className="workspace-icon">P</span><span>{actor.organizationName}<small>Workspace comercial</small></span><LockKeyhole size={13}/></div>
    <nav aria-label="Navegação principal"><span className="nav-label">VISÃO GERAL</span><Link onClick={()=>setOpen(false)} className={`nav-item ${path==='/'?'active':''}`} href="/" aria-current={path==='/'?'page':undefined}><LayoutDashboard size={18}/>Dashboard</Link>{commercial&&<><span className="nav-label">RELACIONAMENTO</span>{[['leads','Leads'],['clientes','Clientes'],['empresas','Empresas']].map(([href,label])=><Link key={href} onClick={()=>setOpen(false)} href={'/'+href} className={'nav-item '+(section===href?'active':'')} aria-current={section===href?'page':undefined}>{href==='empresas'?<Building2 size={18}/>:<Users size={18}/>} {label}</Link>)}</>}{commercial&&<><span className="nav-label">OPERAÇÃO COMERCIAL</span>{[['pipeline','Pipeline',GitBranch],['oportunidades','Oportunidades',Target],['tarefas','Tarefas',CheckSquare],['agenda','Agenda',CalendarDays],['follow-up','Follow-up',Users]].map(([href,label,Icon])=>{const I=Icon as typeof Users;return <Link key={String(href)} onClick={()=>setOpen(false)} href={'/'+href} className={'nav-item '+(section===href?'active':'')} aria-current={section===href?'page':undefined}><I size={18}/>{String(label)}</Link>;})}<span className="nav-label">ENERGIA SOLAR</span><Link onClick={()=>setOpen(false)} href="/catalogo-solar" className={'nav-item '+(section==='catalogo-solar'?'active':'')} aria-current={section==='catalogo-solar'?'page':undefined}><Package size={18}/>Equipamentos e kits</Link></>}<span className="nav-label">ORGANIZAÇÃO</span>{actor.permissions.includes('team.read')&&<Link onClick={()=>setOpen(false)} href="/equipe" className={`nav-item ${path==='/equipe'?'active':''}`} aria-current={path==='/equipe'?'page':undefined}><Users size={18}/>Equipe</Link>}{actor.permissions.includes('settings.read')&&<Link onClick={()=>setOpen(false)} href="/configuracoes" className={`nav-item ${path==='/configuracoes'?'active':''}`} aria-current={path==='/configuracoes'?'page':undefined}><Settings size={18}/>Configurações</Link>}{actor.permissions.includes('crm.tags.manage')&&<Link onClick={()=>setOpen(false)} className={'nav-item '+(section==='tags'?'active':'')} href="/tags" aria-current={section==='tags'?'page':undefined}><Folder size={18}/>Tags</Link>}<details className="future-navigation"><summary>Próximos módulos</summary><p>Disponíveis nas próximas fases.</p>{futureItems.map(([label,Icon])=><span key={label} className="nav-item unavailable" aria-disabled="true" title="Disponível em uma próxima fase"><Icon size={17}/>{label}</span>)}</details></nav><div className="sidebar-bottom"><span className="status-dot"/> Fase 4 · Energia solar</div></aside>
    <div className="main-shell" inert={open}><header className="topbar"><div className="breadcrumb"><button ref={menuRef} aria-controls="workspace-menu" className="mobile-menu icon-button" aria-label="Abrir menu" aria-expanded={open} onClick={()=>setOpen(true)}><Menu size={21}/></button><span>Workspace</span><ChevronRight size={14}/><strong>{title}</strong></div>{commercial&&<GlobalSearch/>}<div className="profile"><span className="avatar">{actor.name.charAt(0).toUpperCase()}</span><span className="profile-text">{actor.name}<small>{actor.roleName}</small></span><button className="icon-button logout" aria-label="Sair da conta" disabled={busy} onClick={signOut}><LogOut size={18}/></button></div></header>{error&&<p role="alert" className="error-box">{error}</p>}<main id="main" className="main-content">{children}</main><footer className="app-footer"><span>PECLAT SOLAR</span><span><Sun size={13}/> Conectando pessoas à energia.</span></footer></div>
  </div>;
}
