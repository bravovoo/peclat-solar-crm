'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Search } from 'lucide-react';
import { Modal } from './modal';
import { useRemote } from './use-remote';
import { labels,paths,type Kind } from '@/modules/crm/domain';
type Hit={id:string;name:string;kind:Kind|'opportunity';record_id?:string};
function SearchDialog({onClose}:{onClose:()=>void}){const [q,setQ]=useState('');const {data,error,loading}=useRemote<Record<string,Hit[]>>(q.trim().length>=2?`/api/search?q=${encodeURIComponent(q)}`:null);
 return <Modal title="Buscar no CRM" onClose={onClose}><label className="crm-field"><span>Nome, telefone, e-mail, documento ou empresa</span><input autoFocus maxLength={120} value={q} onChange={e=>setQ(e.target.value)} placeholder="Digite pelo menos 2 caracteres"/></label>{loading&&<p role="status">Buscando…</p>}{error&&<p role="alert" className="error-box">{error}</p>}{data&&Object.values(data).every(hits=>!hits.length)&&<p className="empty-state">Nenhum resultado para esta pesquisa.</p>}{data&&Object.entries(data).filter(([,hits])=>hits.length).map(([key,hits])=><section key={key} className="search-group"><h3>{key==='opportunities'?'Oportunidades':key==='contacts'?'Contatos':labels[key as Kind]}</h3>{hits.map(hit=><Link key={hit.id} onClick={onClose} href={hit.kind==='opportunity'?'/oportunidades/'+hit.id:`/${paths[hit.kind]}/${hit.record_id??hit.id}${key==='contacts'?'?tab=contacts':''}`}>{hit.name}<span>Abrir →</span></Link>)}</section>)}</Modal>;
}
export function GlobalSearch(){const [open,setOpen]=useState(false);return <><button className="global-search-button" aria-label="Buscar no CRM" onClick={()=>setOpen(true)}><Search size={18}/><span>Buscar no CRM</span></button>{open&&<SearchDialog onClose={()=>setOpen(false)}/>}</>;}
