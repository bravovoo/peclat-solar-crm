'use client';
import {useState} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {api,errorMessage} from '@/components/crm/api';
import type {Installation,InstallationOptions} from '@/modules/installations/domain';

export function InstallationForm({options,initial,contractId,userId,canReassign}:{options:InstallationOptions;initial?:Installation;contractId?:string;userId:string;canReassign:boolean}){
 const router=useRouter();
 const [selected,setSelected]=useState(initial?.contract_id??contractId??''),[address,setAddress]=useState(initial?.installation_address??options.contracts.find(c=>c.id===contractId)?.installation_address??'');
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const contract=options.contracts.find(c=>c.id===selected);
 async function save(e:React.FormEvent<HTMLFormElement>){
  e.preventDefault();setBusy(true);setError('');const f=new FormData(e.currentTarget);
  const payload={contract_id:selected,responsible_user_id:canReassign?String(f.get('responsible_user_id')??''):initial?.responsible_user_id??userId,
   team_name:String(f.get('team_name')??''),installation_address:address,planned_on:String(f.get('planned_on')??''),scheduled_on:String(f.get('scheduled_on')??''),
   started_on:String(f.get('started_on')??''),completed_on:initial?.completed_on??'',notes:String(f.get('notes')??''),version:initial?.version};
  try{const result=await api<Installation>(initial?`/api/installations/${initial.id}`:'/api/installations',initial?'PUT':'POST',payload);router.push(`/instalacoes/${result.id}`);router.refresh();}
  catch(e){setError(errorMessage(e));setBusy(false);}
 }
 return <form className="crm-form" onSubmit={save}>
  {initial?<div className="installation-contract-summary"><strong>{initial.contract_number}</strong><span>{initial.client_name} · {initial.contract_title}</span><Link href={`/contratos/${initial.contract_id}`}>Abrir contrato →</Link></div>:<label className="crm-field"><span>Contrato fechado *</span><select aria-label="Contrato fechado" required value={selected} onChange={e=>{setSelected(e.target.value);setAddress(options.contracts.find(c=>c.id===e.target.value)?.installation_address??'');}}><option value="">Selecione um contrato</option>{options.contracts.map(item=><option key={item.id} value={item.id}>{item.contract_number} · {item.client_name} · {item.title}</option>)}</select><small>Uma instalação por contrato assinado, ativo ou concluído.</small></label>}
  {!initial&&options.contracts.length===0&&<p className="crm-notice">Nenhum contrato fechado está disponível para nova instalação.</p>}
  {contract&&!initial&&<p className="muted">Cliente: {contract.client_name}</p>}
  <div className="contract-form-grid"><label className="crm-field"><span>Endereço da instalação *</span><textarea name="installation_address" value={address} onChange={e=>setAddress(e.target.value)} required minLength={5} maxLength={500} rows={3}/></label><label className="crm-field"><span>Responsável</span><select name="responsible_user_id" defaultValue={initial?.responsible_user_id??userId} disabled={!canReassign}>{!options.owners.some(o=>o.id===(initial?.responsible_user_id??userId))&&<option value={initial?.responsible_user_id??userId}>{initial?.responsible_name??'Você'}</option>}{options.owners.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select><small>A gestão pode atribuir um técnico ou outro membro autorizado.</small></label><label className="crm-field"><span>Equipe</span><input name="team_name" defaultValue={initial?.team_name??''} maxLength={180} placeholder="Nome da equipe ou referência interna"/></label><label className="crm-field"><span>Data prevista</span><input name="planned_on" type="date" defaultValue={initial?.planned_on??''}/></label><label className="crm-field"><span>Data agendada</span><input name="scheduled_on" type="date" defaultValue={initial?.scheduled_on??''}/></label><label className="crm-field"><span>Data de início</span><input name="started_on" type="date" defaultValue={initial?.started_on??''}/></label></div>
  <label className="crm-field"><span>Observações internas</span><textarea name="notes" defaultValue={initial?.notes??''} maxLength={4000} rows={5}/></label>
  {error&&<p className="error-box" role="alert">{error}</p>}
  <div className="crm-form-actions"><Link className="button secondary" href={initial?`/instalacoes/${initial.id}`:'/instalacoes'}>Cancelar</Link><button className="button primary" disabled={busy||(!initial&&!selected)}>{busy?'Salvando…':initial?'Salvar alterações':'Criar instalação'}</button></div>
 </form>;
}
