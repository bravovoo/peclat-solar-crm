'use client';
import { useState } from 'react';
import { api, errorMessage } from './api';
import type { CommercialRecord, Kind } from '@/modules/crm/domain';

export type CommercialListOptions={
  owners:{id:string;name:string}[];
  teams:{id:string;name:string;auto_distribute:boolean}[];
  sellers:{id:string;name:string;active:boolean}[];
  scope:'all'|'team'|'mine';
};

export function CommercialControls({kind,options,filters,change,records,selected,setSelected,onUpdated,unassigned}:{
  kind:Kind;options:CommercialListOptions;filters:Record<string,string>;
  change:(key:string,value:string)=>void;records:CommercialRecord[];
  selected:Record<string,number>;setSelected:(value:Record<string,number>)=>void;
  onUpdated:()=>void;unassigned:number;
}){
  const [owner,setOwner]=useState('');
  const [team,setTeam]=useState('');
  const [source,setSource]=useState('');
  const [destination,setDestination]=useState('');
  const [confirmed,setConfirmed]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const chosen=records.filter(record=>selected[record.id]===record.version).map(record=>({id:record.id,version:record.version}));
  const activeSellers=options.sellers.filter(person=>person.active);
  async function assign(mode:'manual'|'automatic'){
    if(!chosen.length||!window.confirm(`Confirmar a atribuição de ${chosen.length} lead(s)?`))return;
    setBusy(true);setError('');
    try{
      const result=await api<{assigned:number}>('/api/leads/distribute','POST',mode==='manual'?{mode,leads:chosen,owner_id:owner}:{mode,leads:chosen,team_id:team});
      setNotice(`${result.assigned} lead(s) atribuídos.`);setSelected({});onUpdated();
    }catch(cause){setError(errorMessage(cause));}finally{setBusy(false);}
  }
  async function transfer(){
    if(!confirmed||!source||!destination||source===destination||!window.confirm('Transferir manualmente a carteira comercial?'))return;
    setBusy(true);setError('');
    try{
      const result=await api<{records:number;opportunities:number;tasks:number}>('/api/commercial-portfolio','POST',{from_user_id:source,to_user_id:destination,confirm:true});
      setNotice(`Transferidos ${result.records} cadastros, ${result.opportunities} oportunidades e ${result.tasks} tarefas.`);
      setConfirmed(false);onUpdated();
    }catch(cause){setError(errorMessage(cause));}finally{setBusy(false);}
  }
  return <>
    <div className="commercial-view-filters" aria-label="Visibilidade comercial">
      <label className="crm-field"><span>Carteira</span><select value={filters.view??options.scope} onChange={event=>change('view',event.target.value)}><option value="mine">Meu</option>{options.scope!=='mine'&&<option value="team">Minha equipe</option>}{options.scope==='all'&&<option value="all">Todos</option>}{kind==='lead'&&options.scope!=='mine'&&<option value="unassigned">Sem responsável</option>}</select></label>
      {options.scope!=='mine'&&<><label className="crm-field"><span>Responsável</span><select value={filters.owner??''} onChange={event=>change('owner',event.target.value)}><option value="">Todos</option>{options.owners.map(person=><option value={person.id} key={person.id}>{person.name}</option>)}</select></label><label className="crm-field"><span>Equipe</span><select value={filters.team??''} onChange={event=>change('team',event.target.value)}><option value="">Todas</option>{options.teams.map(item=><option value={item.id} key={item.id}>{item.name}</option>)}</select></label></>}
      {kind==='lead'&&options.scope!=='mine'&&<span className="badge">{unassigned} sem responsável</span>}
    </div>
    {kind==='lead'&&options.scope!=='mine'&&<>
      <div className="commercial-distribution"><strong>{chosen.length} lead(s) selecionados</strong><label className="crm-field"><span>Vendedor</span><select aria-label="Vendedor para atribuição" value={owner} onChange={event=>setOwner(event.target.value)}><option value="">Selecione</option>{activeSellers.map(person=><option key={person.id} value={person.id}>{person.name}</option>)}</select></label><button className="button secondary" disabled={busy||!owner||!chosen.length} onClick={()=>assign('manual')}>Atribuir responsável</button><label className="crm-field"><span>Equipe com round robin ativo</span><select aria-label="Equipe para distribuição automática" value={team} onChange={event=>setTeam(event.target.value)}><option value="">Selecione</option>{options.teams.filter(item=>item.auto_distribute).map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button className="button secondary" disabled={busy||!team||!chosen.length} onClick={()=>assign('automatic')}>Distribuição automática</button></div>
      <details className="crm-filters"><summary>Transferir carteira</summary><p>Transferência manual; registros históricos permanecem.</p><div className="commercial-distribution"><label className="crm-field"><span>Vendedor origem</span><select aria-label="Vendedor origem" value={source} onChange={event=>setSource(event.target.value)}><option value="">Selecione</option>{options.sellers.map(person=><option key={person.id} value={person.id}>{person.name}{person.active?'':' (inativo)'}</option>)}</select></label><label className="crm-field"><span>Vendedor destino</span><select aria-label="Vendedor destino" value={destination} onChange={event=>setDestination(event.target.value)}><option value="">Selecione</option>{activeSellers.map(person=><option key={person.id} value={person.id}>{person.name}</option>)}</select></label><label className="crm-checks"><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/> Confirmo a transferência manual</label><button className="button secondary" disabled={busy||!confirmed||!source||!destination||source===destination} onClick={transfer}>Transferir carteira</button></div></details>
    </>}
    {error&&<p role="alert" className="error-box">{error}</p>}{notice&&<p role="status" className="crm-notice">{notice}</p>}
  </>;
}
