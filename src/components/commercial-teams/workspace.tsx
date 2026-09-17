'use client';
import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '@/components/crm/api';
import { Modal } from '@/components/crm/modal';
import type { CommercialTeam } from '@/modules/commercial-teams/domain';
import type { commercialTeamOverview } from '@/modules/commercial-teams/repository';

type Overview=Awaited<ReturnType<typeof commercialTeamOverview>>;
const labels:Record<string,string>={created:'Equipe criada',updated:'Equipe editada',manager_changed:'Gerente alterado',member_added:'Vendedor adicionado',member_removed:'Vendedor removido',deactivated:'Equipe desativada',reactivated:'Equipe reativada'};

export function CommercialTeamWorkspace({initial}:{initial:Overview}) {
  const [data,setData]=useState(initial);
  const [editing,setEditing]=useState<CommercialTeam|Record<string,never>|null>(null);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [busy,setBusy]=useState(false);
  const managers=data.members.filter(member=>member.role_code==='manager'&&member.active);
  const sellers=data.members.filter(member=>member.role_code==='seller');
  const refresh=async()=>setData(await api<Overview>('/api/commercial-teams'));
  async function save(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();setBusy(true);setError('');
    const form=new FormData(event.currentTarget);
    const current=editing&&'id' in editing?editing as CommercialTeam:null;
    try {
      await api('/api/commercial-teams'+(current?`/${current.id}`:''),current?'PUT':'POST',{
        name:String(form.get('name')??''),description:String(form.get('description')??''),
        manager_user_id:String(form.get('manager_user_id')??''),active:form.get('active')==='true',
        ...(current?{version:current.version}:{})
      });
      await refresh();setEditing(null);setNotice(current?'Equipe atualizada.':'Equipe criada.');
    } catch (cause) {setError(errorMessage(cause));} finally {setBusy(false);}
  }
  async function membership(teamId:string,userId:string,action:'add'|'remove') {
    setBusy(true);setError('');setNotice('');
    try {await api(`/api/commercial-teams/${teamId}/members`,'POST',{user_id:userId,action});await refresh();setNotice(action==='add'?'Vendedor adicionado.':'Vendedor removido.');}
    catch (cause) {setError(errorMessage(cause));} finally {setBusy(false);}
  }
  return <div className="commercial-team-workspace">
    <div className="page-heading"><div><span className="eyebrow blue">OPERAÇÃO COMERCIAL</span><h1>Equipe comercial</h1><p>Gerentes, vendedores e carteiras de atendimento em uma única visão.</p></div>
      {data.can_manage&&<button className="button primary" onClick={()=>{setError('');setEditing({});}}>Criar equipe</button>}</div>
    {notice&&<p role="status" className="crm-notice">{notice}</p>}{error&&!editing&&<p role="alert" className="error-box">{error}</p>}
    <section className="commercial-team-summary" aria-label="Resumo da equipe">
      <div className="card"><small>Equipes ativas</small><strong>{data.teams.filter(team=>team.active).length}</strong></div>
      <div className="card"><small>Vendedores ativos</small><strong>{sellers.filter(seller=>seller.active).length}</strong></div>
      <div className="card"><small>Leads atribuídos</small><strong>{data.members.reduce((sum,member)=>sum+member.leads,0)}</strong></div>
      <div className="card"><small>Oportunidades abertas</small><strong>{data.members.reduce((sum,member)=>sum+member.opportunities_open,0)}</strong></div>
    </section>
    <section className="card commercial-team-section"><div className="card-heading"><h2>Equipes</h2><span className="badge">{data.teams.length} equipe(s)</span></div>
      {!data.teams.length&&<p className="empty-state">Nenhuma equipe comercial organizada ainda.</p>}
      <div className="commercial-team-grid">{data.teams.map(team=><article className="commercial-team-card" key={team.id}>
        <div className="commercial-team-card-heading"><div><h3>{team.name}</h3><p>{team.description||'Sem descrição adicional.'}</p></div><span className="badge">{team.active?'Ativa':'Inativa'}</span></div>
        <p><strong>Gerente:</strong> {team.manager_name}</p><p><strong>Vendedores:</strong> {team.member_count}</p>
        {data.can_manage&&<div className="commercial-team-actions"><button className="button secondary" onClick={()=>{setError('');setEditing(team);}}>Editar equipe</button></div>}
        <div className="commercial-team-members"><h4>Membros</h4>{sellers.filter(member=>member.team_id===team.id).map(member=><div key={member.id}><span>{member.name}<small>{member.active?'Ativo':'Inativo'}</small></span>{data.can_manage&&<button className="button secondary" disabled={busy} onClick={()=>membership(team.id,member.id,'remove')}>Remover</button>}</div>)}
          {!sellers.some(member=>member.team_id===team.id)&&<p className="muted">Nenhum vendedor nesta equipe.</p>}</div>
        {data.can_manage&&team.active&&<label className="crm-field"><span>Adicionar vendedor</span><select aria-label={`Adicionar vendedor à ${team.name}`} disabled={busy} defaultValue="" onChange={event=>{const id=event.target.value;if(id)void membership(team.id,id,'add');event.target.value='';}}><option value="">Selecione um vendedor</option>{sellers.filter(member=>member.active&&!member.team_id).map(member=><option value={member.id} key={member.id}>{member.name}</option>)}</select></label>}
      </article>)}</div>
    </section>
    <section className="card commercial-team-section"><div className="card-heading"><h2>{data.can_manage?'Pessoas da operação comercial':'Meu perfil comercial'}</h2></div>
      <div className="commercial-team-people">{data.members.map(member=><article key={member.id} className="commercial-person-card">
        <div><h3>{member.name}</h3><p>{member.email}</p><span className="badge">{member.role_name}</span> <span className="badge">{member.active?'Ativo':'Inativo'}</span></div>
        <dl><div><dt>Equipe</dt><dd>{member.team_name??'Não definida'}</dd></div><div><dt>Gerente</dt><dd>{member.manager_name??'Não definido'}</dd></div></dl>
        <div className="commercial-person-metrics"><span><strong>{member.leads}</strong> leads</span><span><strong>{member.customers}</strong> clientes</span><span><strong>{member.opportunities_open}</strong> oportunidades</span><span><strong>{member.tasks_open}</strong> tarefas abertas</span></div>
      </article>)}</div>
    </section>
    {data.can_manage&&data.history.length>0&&<section className="card commercial-team-section"><h2>Histórico recente</h2><div className="commercial-team-history">{data.history.map(item=><p key={item.id}><strong>{labels[item.action]??item.action}</strong><span>{item.detail} · {item.actor_name}</span><time>{new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Sao_Paulo'}).format(new Date(item.created_at))}</time></p>)}</div></section>}
    {editing&&<Modal title={'id' in editing?'Editar equipe':'Criar equipe'} onClose={()=>{if(!busy)setEditing(null);}}><form className="crm-form" onSubmit={save}>
      <label className="crm-field"><span>Nome da equipe</span><input name="name" required minLength={2} maxLength={120} defaultValue={'name' in editing?String(editing.name):''}/></label>
      <label className="crm-field"><span>Descrição (opcional)</span><textarea name="description" maxLength={1000} rows={3} defaultValue={'description' in editing?String(editing.description):''}/></label>
      <label className="crm-field"><span>Gerente comercial</span><select name="manager_user_id" required defaultValue={'manager_user_id' in editing?String(editing.manager_user_id):''}><option value="">Selecione</option>{managers.map(manager=><option value={manager.id} key={manager.id}>{manager.name}</option>)}</select></label>
      <label className="crm-field"><span>Status</span><select name="active" defaultValue={'active' in editing&&editing.active===false?'false':'true'}><option value="true">Ativa</option><option value="false">Inativa</option></select></label>
      {error&&<p role="alert" className="error-box">{error}</p>}
      <div className="crm-form-actions"><button type="button" className="button secondary" disabled={busy} onClick={()=>setEditing(null)}>Cancelar</button><button className="button primary" disabled={busy}>{busy?'Salvando…':'Salvar equipe'}</button></div>
    </form></Modal>}
  </div>;
}
