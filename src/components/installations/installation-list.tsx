'use client';
import {useState} from 'react';
import Link from 'next/link';
import {Search,Plus,Wrench} from 'lucide-react';
import {useRemote} from '@/components/crm/use-remote';
import {installationStatuses,type Installation} from '@/modules/installations/domain';

const date=(value:string|null)=>value?new Intl.DateTimeFormat('pt-BR',{timeZone:'UTC'}).format(new Date(`${value}T12:00:00Z`)):'A definir';
export function InstallationList({canCreate}:{canCreate:boolean}){
 const [q,setQ]=useState(''),[status,setStatus]=useState('all'),[page,setPage]=useState(1);
 const query=new URLSearchParams({q,status,page:String(page),pageSize:'20'});
 const result=useRemote<{items:Installation[];total:number;pageSize:number}>(`/api/installations?${query}`);
 return <><div className="page-heading"><div><span className="eyebrow green">EXECUÇÃO SOLAR</span><h1>Instalações</h1><p>Acompanhe o agendamento, a equipe e a execução dos contratos fechados.</p></div>{canCreate&&<Link className="button primary" href="/instalacoes/nova"><Plus size={16}/>Nova instalação</Link>}</div>
  <div className="crm-toolbar card installation-toolbar"><label className="crm-search"><Search size={16}/><input aria-label="Pesquisar instalações" value={q} onChange={e=>{setQ(e.target.value);setPage(1);}} placeholder="Número, cliente, contrato ou endereço" maxLength={120}/></label><label className="crm-field"><span>Status</span><select aria-label="Filtrar status da instalação" value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}><option value="all">Todos</option>{Object.entries(installationStatuses).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label></div>
  {result.loading&&<p className="crm-loading" role="status">Carregando instalações…</p>}{result.error&&<p className="error-box" role="alert">{result.error}</p>}
  {result.data?.items.length===0&&<div className="card document-empty"><Wrench size={28}/><h2>Nenhuma instalação encontrada</h2><p>Crie uma instalação a partir de um contrato assinado ou ajuste os filtros.</p></div>}
  <div className="installation-list">{result.data?.items.map(item=><Link className="card installation-row" href={`/instalacoes/${item.id}`} key={item.id}><div><span className={`document-status ${item.status}`}>{installationStatuses[item.status]}</span><h2>{item.installation_number}</h2><p>{item.client_name} · {item.contract_number}</p><small>{item.installation_address}</small></div><dl><div><dt>Agendada</dt><dd>{date(item.scheduled_on)}</dd></div><div><dt>Responsável</dt><dd>{item.responsible_name}</dd></div></dl></Link>)}</div>
  {result.data&&result.data.total>20&&<div className="crm-pagination"><span>{result.data.total} instalações · Página {page}</span><div><button className="button secondary" disabled={page===1} onClick={()=>setPage(p=>p-1)}>Anterior</button><button className="button secondary" disabled={page*20>=result.data.total} onClick={()=>setPage(p=>p+1)}>Próxima</button></div></div>}
 </>;
}
