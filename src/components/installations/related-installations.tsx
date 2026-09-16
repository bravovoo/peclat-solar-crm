'use client';
import Link from 'next/link';
import {Plus,Wrench} from 'lucide-react';
import {useRemote} from '@/components/crm/use-remote';
import {installationStatuses,type Installation} from '@/modules/installations/domain';

export function RelatedInstallations({clientId,contractId,canCreate=false}:{clientId?:string;contractId?:string;canCreate?:boolean}){
 const query=contractId?`contract_id=${contractId}`:`client_id=${clientId}`;
 const result=useRemote<{items:Installation[]}>(`/api/installations?${query}&pageSize=100`);
 return <div className="related-contracts"><div className="card-heading"><div><h2>Instalações</h2><p className="muted">Execução vinculada aos contratos fechados.</p></div>{canCreate&&result.data?.items.length===0&&<Link className="button primary" href={`/instalacoes/nova?contract_id=${contractId}`}><Plus size={15}/>Criar instalação</Link>}</div>
  {result.loading&&<p className="crm-loading">Carregando instalações…</p>}{result.error&&<p role="alert" className="error-box">{result.error}</p>}
  {result.data?.items.map(item=><Link className="contract-related-row" href={`/instalacoes/${item.id}`} key={item.id}><Wrench size={18}/><div><strong>{item.installation_number}</strong><span>{item.contract_number} · {installationStatuses[item.status]} · checklist {item.checklist_completed}/{item.checklist_total} · {item.responsible_name}</span></div></Link>)}
  {result.data?.items.length===0&&<p className="muted">Nenhuma instalação vinculada.</p>}
 </div>;
}
