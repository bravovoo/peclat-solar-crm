'use client';

import {useState} from 'react';
import {api,errorMessage} from '@/components/crm/api';
import {
 claimStatuses,maintenanceStatuses,maintenanceTypes,ticketCategories,ticketPriorities,ticketStatuses,
 warrantyCategories,warrantyLifecycle,type Claim,type Maintenance,type PostSalesOptions,type Ticket,type Warranty,
} from '@/modules/post-sales/domain';

type Saved={id:string};
const today=()=>new Date().toISOString().slice(0,10);
const optional=(form:FormData,key:string)=>String(form.get(key)??'');
const retainCurrent=(key:string,initial?:string,canManage=false)=>canManage||!['closed','cancelled','completed'].includes(key)||key===initial;

export function WarrantyForm({options,userId,initial,onSaved,canManage}:{options:PostSalesOptions;userId:string;initial?:Warranty;onSaved:(value:Saved)=>void;canManage:boolean}){
 const [installationId,setInstallationId]=useState(initial?.installation_id??options.installations[0]?.id??'');
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const installation=options.installations.find(row=>row.id===installationId);
 async function submit(event:React.FormEvent<HTMLFormElement>){
  event.preventDefault();setBusy(true);setError('');const form=new FormData(event.currentTarget);
  try{
   const result=await api<Warranty>(initial?`/api/post-sales-warranties/${initial.id}`:'/api/post-sales-warranties',initial?'PUT':'POST',{
    installation_id:installationId,contract_item_id:optional(form,'contract_item_id'),category:optional(form,'category'),description:optional(form,'description'),manufacturer:optional(form,'manufacturer'),serial_number:optional(form,'serial_number'),supplier:optional(form,'supplier'),start_on:optional(form,'start_on'),duration_months:Number(form.get('duration_months')),notes:optional(form,'notes'),lifecycle:optional(form,'lifecycle')||'normal',responsible_user_id:optional(form,'responsible_user_id'),...(initial?{version:initial.version}:{}),
   });
   onSaved(result);
  }catch(reason){setError(errorMessage(reason));}finally{setBusy(false);}
 }
 return <form className="crm-form" onSubmit={submit}>
  <div className="contract-form-grid">
   <label className="crm-field"><span>Instalação</span><select required value={installationId} onChange={event=>setInstallationId(event.target.value)} disabled={!!initial}><option value="">Selecione</option>{options.installations.map(row=><option key={row.id} value={row.id}>{row.installation_number}</option>)}</select></label>
   <label className="crm-field"><span>Item vendido</span><select key={installationId} name="contract_item_id" defaultValue={initial?.contract_item_id??''}><option value="">Sem item específico</option>{options.contractItems.filter(row=>row.contract_id===installation?.contract_id).map(row=><option key={row.id} value={row.id}>{row.description}</option>)}</select></label>
   <label className="crm-field"><span>Categoria</span><select name="category" defaultValue={initial?.category??'module'}>{Object.entries(warrantyCategories).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
   <label className="crm-field"><span>Responsável</span><select name="responsible_user_id" defaultValue={initial?.responsible_user_id??userId}>{options.owners.map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
   <label className="crm-field"><span>Início da garantia</span><input name="start_on" type="date" required defaultValue={initial?.start_on??today()}/></label>
   <label className="crm-field"><span>Prazo em meses</span><input name="duration_months" type="number" min={1} max={600} required defaultValue={initial?.duration_months??12}/></label>
   <label className="crm-field"><span>Fabricante</span><input name="manufacturer" maxLength={180} defaultValue={initial?.manufacturer??''}/></label>
   <label className="crm-field"><span>Fornecedor responsável</span><input name="supplier" maxLength={180} defaultValue={initial?.supplier??''}/></label>
   <label className="crm-field"><span>Número de série</span><input name="serial_number" maxLength={180} defaultValue={initial?.serial_number??''}/></label>
   {initial&&<label className="crm-field"><span>Situação</span><select name="lifecycle" defaultValue={initial.lifecycle}>{Object.entries(warrantyLifecycle).filter(([key])=>retainCurrent(key,initial.lifecycle,canManage)).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>}
  </div>
  <label className="crm-field"><span>Descrição</span><input name="description" required minLength={2} maxLength={500} defaultValue={initial?.description??''}/></label>
  <label className="crm-field"><span>Observações</span><textarea name="notes" maxLength={4000} defaultValue={initial?.notes??''}/></label>
  {error&&<p className="error-box" role="alert">{error}</p>}
  <button className="button primary" disabled={busy||!installationId}>{busy?'Salvando…':initial?'Salvar garantia':'Criar garantia'}</button>
 </form>;
}

export function TicketForm({options,userId,initial,onSaved,canManage}:{options:PostSalesOptions;userId:string;initial?:Ticket;onSaved:(value:Saved)=>void;canManage:boolean}){
 const [installationId,setInstallationId]=useState(initial?.installation_id??'');
 const [contractId,setContractId]=useState(initial?.contract_id??'');
 const [clientId,setClientId]=useState(initial?.client_id??'');
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const installation=options.installations.find(row=>row.id===installationId);
 function selectInstallation(id:string){setInstallationId(id);const row=options.installations.find(item=>item.id===id);if(row){setContractId(row.contract_id);setClientId(row.client_id);}else setContractId('');}
 function selectContract(id:string){setContractId(id);setInstallationId('');const row=options.contracts.find(item=>item.id===id);if(row)setClientId(row.client_id);}
 async function submit(event:React.FormEvent<HTMLFormElement>){
  event.preventDefault();setBusy(true);setError('');const form=new FormData(event.currentTarget);
  try{
   const result=await api<Ticket>(initial?`/api/post-sales-tickets/${initial.id}`:'/api/post-sales-tickets',initial?'PUT':'POST',{
    client_id:clientId,contract_id:contractId,installation_id:installationId,warranty_id:optional(form,'warranty_id'),contract_item_id:optional(form,'contract_item_id'),title:optional(form,'title'),description:optional(form,'description'),category:optional(form,'category'),priority:optional(form,'priority'),status:optional(form,'status')||'open',responsible_user_id:optional(form,'responsible_user_id'),due_on:optional(form,'due_on'),resolution:optional(form,'resolution'),...(initial?{version:initial.version}:{}),
   });
   onSaved(result);
  }catch(reason){setError(errorMessage(reason));}finally{setBusy(false);}
 }
 return <form className="crm-form" onSubmit={submit}>
  <div className="contract-form-grid">
   <label className="crm-field"><span>Cliente</span><select required value={clientId} onChange={event=>{setClientId(event.target.value);setContractId('');setInstallationId('');}} disabled={!!initial}><option value="">Selecione</option>{!options.clients.some(row=>row.id===clientId)&&clientId&&<option value={clientId}>{initial?.client_name??'Cliente da instalação'}</option>}{options.clients.map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
   <label className="crm-field"><span>Contrato</span><select value={contractId} onChange={event=>selectContract(event.target.value)}><option value="">Sem contrato</option>{options.contracts.filter(row=>row.client_id===clientId).map(row=><option key={row.id} value={row.id}>{row.contract_number}</option>)}</select></label>
   <label className="crm-field"><span>Instalação</span><select value={installationId} onChange={event=>selectInstallation(event.target.value)}><option value="">Sem instalação</option>{options.installations.filter(row=>!clientId||row.client_id===clientId).map(row=><option key={row.id} value={row.id}>{row.installation_number}</option>)}</select></label>
   <label className="crm-field"><span>Garantia</span><select key={installationId} name="warranty_id" defaultValue={initial?.warranty_id??''}><option value="">Sem garantia</option>{options.warranties.filter(row=>row.installation_id===installationId).map(row=><option key={row.id} value={row.id}>{row.description}</option>)}</select></label>
   <label className="crm-field"><span>Equipamento vendido</span><select key={contractId} name="contract_item_id" defaultValue={initial?.contract_item_id??''}><option value="">Sem equipamento específico</option>{options.contractItems.filter(row=>row.contract_id===contractId).map(row=><option key={row.id} value={row.id}>{row.description}</option>)}</select></label>
   <label className="crm-field"><span>Categoria</span><select name="category" defaultValue={initial?.category??'question'}>{Object.entries(ticketCategories).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
   <label className="crm-field"><span>Prioridade</span><select name="priority" defaultValue={initial?.priority??'medium'}>{Object.entries(ticketPriorities).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
   <label className="crm-field"><span>Responsável</span><select name="responsible_user_id" defaultValue={initial?.responsible_user_id??userId}>{options.owners.map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
   <label className="crm-field"><span>Prazo</span><input name="due_on" type="date" defaultValue={initial?.due_on??''}/></label>
   {initial&&<label className="crm-field"><span>Status</span><select name="status" defaultValue={initial.status}>{Object.entries(ticketStatuses).filter(([key])=>retainCurrent(key,initial.status,canManage)).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>}
  </div>
  <label className="crm-field"><span>Título</span><input name="title" required minLength={2} maxLength={180} defaultValue={initial?.title??''}/></label>
  <label className="crm-field"><span>Descrição</span><textarea name="description" maxLength={4000} defaultValue={initial?.description??''}/></label>
  {initial&&<label className="crm-field"><span>Solução / resolução</span><textarea name="resolution" maxLength={4000} defaultValue={initial.resolution}/></label>}
  {error&&<p className="error-box" role="alert">{error}</p>}
  <button className="button primary" disabled={busy||!clientId}>{busy?'Salvando…':initial?'Salvar chamado':'Abrir chamado'}</button>
  {installation&&<small>Vinculado à instalação {installation.installation_number}.</small>}
 </form>;
}

export function MaintenanceForm({options,userId,initial,onSaved,canManage}:{options:PostSalesOptions;userId:string;initial?:Maintenance;onSaved:(value:Saved)=>void;canManage:boolean}){
 const [installationId,setInstallationId]=useState(initial?.installation_id??options.installations[0]?.id??'');
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 async function submit(event:React.FormEvent<HTMLFormElement>){
  event.preventDefault();setBusy(true);setError('');const form=new FormData(event.currentTarget);
  try{
   const result=await api<Maintenance>(initial?`/api/post-sales-maintenances/${initial.id}`:'/api/post-sales-maintenances',initial?'PUT':'POST',{
    installation_id:installationId,ticket_id:optional(form,'ticket_id'),warranty_id:optional(form,'warranty_id'),type:optional(form,'type'),reason:optional(form,'reason'),description:optional(form,'description'),responsible_user_id:optional(form,'responsible_user_id'),planned_on:optional(form,'planned_on'),scheduled_on:optional(form,'scheduled_on'),executed_on:optional(form,'executed_on'),status:optional(form,'status')||'requested',notes:optional(form,'notes'),resolution:optional(form,'resolution'),internal_cost:Number(form.get('internal_cost')??0),charged_amount:Number(form.get('charged_amount')??0),no_charge:form.get('no_charge')==='on',financial_notes:optional(form,'financial_notes'),...(initial?{version:initial.version}:{}),
   });
   onSaved(result);
  }catch(reason){setError(errorMessage(reason));}finally{setBusy(false);}
 }
 return <form className="crm-form" onSubmit={submit}>
  <div className="contract-form-grid">
   <label className="crm-field"><span>Instalação</span><select value={installationId} onChange={event=>setInstallationId(event.target.value)} disabled={!!initial} required><option value="">Selecione</option>{options.installations.map(row=><option key={row.id} value={row.id}>{row.installation_number}</option>)}</select></label>
   <label className="crm-field"><span>Chamado</span><select key={installationId} name="ticket_id" defaultValue={initial?.ticket_id??''}><option value="">Sem chamado</option>{options.tickets.filter(row=>row.installation_id===installationId).map(row=><option key={row.id} value={row.id}>{row.ticket_number}</option>)}</select></label>
   <label className="crm-field"><span>Garantia</span><select key={installationId} name="warranty_id" defaultValue={initial?.warranty_id??''}><option value="">Sem garantia</option>{options.warranties.filter(row=>row.installation_id===installationId).map(row=><option key={row.id} value={row.id}>{row.description}</option>)}</select></label>
   <label className="crm-field"><span>Tipo</span><select name="type" defaultValue={initial?.type??'preventive'}>{Object.entries(maintenanceTypes).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
   <label className="crm-field"><span>Responsável</span><select name="responsible_user_id" defaultValue={initial?.responsible_user_id??userId}>{options.owners.map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
   <label className="crm-field"><span>Data prevista</span><input name="planned_on" type="date" defaultValue={initial?.planned_on??''}/></label>
   <label className="crm-field"><span>Data agendada</span><input name="scheduled_on" type="date" defaultValue={initial?.scheduled_on??''}/></label>
   {initial&&<><label className="crm-field"><span>Data executada</span><input name="executed_on" type="date" defaultValue={initial.executed_on??''}/></label><label className="crm-field"><span>Status</span><select name="status" defaultValue={initial.status}>{Object.entries(maintenanceStatuses).filter(([key])=>retainCurrent(key,initial.status,canManage)).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label></>}
  </div>
  <label className="crm-field"><span>Motivo</span><input name="reason" required minLength={2} maxLength={500} defaultValue={initial?.reason??''}/></label>
  <label className="crm-field"><span>Descrição</span><textarea name="description" maxLength={4000} defaultValue={initial?.description??''}/></label>
  <label className="crm-field"><span>Observações</span><textarea name="notes" maxLength={4000} defaultValue={initial?.notes??''}/></label>
  {initial&&<label className="crm-field"><span>Serviço realizado</span><textarea name="resolution" maxLength={4000} defaultValue={initial.resolution}/></label>}
  <div className="contract-form-grid"><label className="crm-field"><span>Custo interno</span><input name="internal_cost" type="number" min={0} step="0.01" defaultValue={initial?.internal_cost??0}/></label><label className="crm-field"><span>Valor cobrado</span><input name="charged_amount" type="number" min={0} step="0.01" defaultValue={initial?.charged_amount??0}/></label></div>
  <label className="crm-checks"><input name="no_charge" type="checkbox" defaultChecked={initial?.no_charge??false}/>Gratuito / em garantia</label>
  <label className="crm-field"><span>Observação financeira</span><input name="financial_notes" maxLength={2000} defaultValue={initial?.financial_notes??''}/></label>
  {error&&<p className="error-box" role="alert">{error}</p>}
  <button className="button primary" disabled={busy||!installationId}>{busy?'Salvando…':initial?'Salvar manutenção':'Solicitar manutenção'}</button>
 </form>;
}

export function ClaimForm({warrantyId,ticketId,options,userId,canManage,initial,onSaved}:{warrantyId:string;ticketId:string;options:PostSalesOptions;userId:string;canManage:boolean;initial?:Claim;onSaved:(value:Saved)=>void}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 async function submit(event:React.FormEvent<HTMLFormElement>){
  event.preventDefault();setBusy(true);setError('');const form=new FormData(event.currentTarget);
  try{
   const result=await api<Claim>(initial?`/api/post-sales-claims/${initial.id}`:'/api/post-sales-claims',initial?'PUT':'POST',{
    warranty_id:warrantyId,ticket_id:ticketId,reason:optional(form,'reason'),supplier:optional(form,'supplier'),protocol:optional(form,'protocol'),notes:optional(form,'notes'),status:optional(form,'status')||'awaiting_send',result:optional(form,'result'),responsible_user_id:optional(form,'responsible_user_id'),...(initial?{version:initial.version}:{}),
   });
   onSaved(result);
  }catch(reason){setError(errorMessage(reason));}finally{setBusy(false);}
 }
 return <form className="crm-form" onSubmit={submit}>
  <label className="crm-field"><span>Motivo do acionamento</span><textarea name="reason" required minLength={2} maxLength={4000} defaultValue={initial?.reason??''}/></label>
  <div className="contract-form-grid">
   <label className="crm-field"><span>Fornecedor ou fabricante</span><input name="supplier" maxLength={180} defaultValue={initial?.supplier??''}/></label>
   <label className="crm-field"><span>Protocolo</span><input name="protocol" maxLength={180} defaultValue={initial?.protocol??''}/></label>
   <label className="crm-field"><span>Responsável</span><select name="responsible_user_id" defaultValue={initial?.responsible_user_id??userId}>{options.owners.map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
   {initial&&<label className="crm-field"><span>Status do acionamento</span><select name="status" defaultValue={initial.status}>{Object.entries(claimStatuses).filter(([key])=>canManage||key!=='closed'||initial.status==='closed').map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>}
  </div>
  <label className="crm-field"><span>Observações</span><textarea name="notes" maxLength={4000} defaultValue={initial?.notes??''}/></label>
  {initial&&<label className="crm-field"><span>Resultado</span><textarea name="result" maxLength={4000} defaultValue={initial.result}/></label>}
  {error&&<p role="alert" className="error-box">{error}</p>}
  <button className="button primary" disabled={busy}>{busy?'Salvando…':initial?'Salvar acionamento':'Acionar garantia'}</button>
 </form>;
}
