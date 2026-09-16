'use client';
import Link from 'next/link';
import {HeartHandshake} from 'lucide-react';
import {useRemote} from '@/components/crm/use-remote';
import {maintenanceStatuses,ticketStatuses,warrantyStatuses,type Maintenance,type Ticket,type Warranty} from '@/modules/post-sales/domain';

export function RelatedPostSales({clientId,contractId,installationId}:{clientId?:string;contractId?:string;installationId?:string}){
 const filter=new URLSearchParams({pageSize:'100'});
 if(installationId)filter.set('installation_id',installationId);else if(contractId)filter.set('contract_id',contractId);else if(clientId)filter.set('client_id',clientId);
 const tickets=useRemote<{items:Ticket[];total:number}>(`/api/post-sales-tickets?${filter}`);
 const warranties=useRemote<{items:Warranty[];total:number}>(`/api/post-sales-warranties?${filter}`);
 const maintenances=useRemote<{items:Maintenance[];total:number}>(`/api/post-sales-maintenances?${filter}`);
 const pending=tickets.data?.items.filter(row=>!['resolved','closed','cancelled'].includes(row.status)).length??0;
 return <section className="card"><div className="card-heading"><div><span className="eyebrow green">PÓS-VENDA</span><h2>Garantias, chamados e manutenção</h2><p className="muted">Registros vinculados a este {installationId?'serviço':contractId?'contrato':'cliente'}.</p></div><Link className="button secondary" href="/pos-venda">Abrir pós-venda</Link></div><div className="installation-summary post-sales-metrics"><div><span>Garantias ativas</span><strong>{warranties.data?.items.filter(row=>['active','expiring','claimed'].includes(row.effective_status)).length??'—'}</strong></div><div><span>Chamados abertos</span><strong>{tickets.data?pending:'—'}</strong></div><div><span>Manutenções realizadas</span><strong>{maintenances.data?.items.filter(row=>row.status==='completed').length??'—'}</strong></div></div>{[tickets.error,warranties.error,maintenances.error].filter(Boolean).map((error,index)=><p className="error-box" role="alert" key={index}>{error}</p>)}<div className="post-sales-related-grid"><div><h3>Garantias</h3>{warranties.data?.items.slice(0,5).map(row=><Link key={row.id} href={`/pos-venda/garantias/${row.id}`}>{row.description} · {warrantyStatuses[row.effective_status]}</Link>)}{warranties.data?.items.length===0&&<p className="muted">Nenhuma garantia.</p>}</div><div><h3>Chamados</h3>{tickets.data?.items.slice(0,5).map(row=><Link key={row.id} href={`/pos-venda/chamados/${row.id}`}>{row.ticket_number} · {ticketStatuses[row.status]}</Link>)}{tickets.data?.items.length===0&&<p className="muted">Nenhum chamado.</p>}</div><div><h3>Manutenções</h3>{maintenances.data?.items.slice(0,5).map(row=><Link key={row.id} href={`/pos-venda/manutencoes/${row.id}`}>{row.reason} · {maintenanceStatuses[row.status]}</Link>)}{maintenances.data?.items.length===0&&<p className="muted">Nenhuma manutenção.</p>}</div></div><HeartHandshake className="post-sales-related-icon" size={22} aria-hidden="true"/></section>;
}
