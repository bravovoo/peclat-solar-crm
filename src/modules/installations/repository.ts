import type {PoolClient} from 'pg';
import {database,transaction} from '@/server/db';
import {AccessError,requirePermission,type Actor} from '@/modules/auth/policy';
import {getContract} from '@/modules/contracts/repository';
import {uuid} from '@/modules/crm/domain';
import {defaultChecklist,installationFiltersSchema,installationSchema,installationStatusSchema,installationStatuses,installationTransitions,type Installation,type InstallationDetail,type InstallationOptions} from './domain';

type Db=Pick<PoolClient,'query'>;
const json=<T>(value:unknown)=>JSON.parse(JSON.stringify(value)) as T;
const all=(actor:Actor)=>actor.permissions.includes('contracts.all');
const canAssign=(actor:Actor)=>actor.permissions.includes('installations.manage');
const scope=(actor:Actor)=>all(actor)?'i.organization_id=$1':'i.organization_id=$1 AND (i.responsible_user_id=$2 OR c.responsible_user_id=$2)';
const params=(actor:Actor):unknown[]=>all(actor)?[actor.organizationId]:[actor.organizationId,actor.userId];
const select=`i.*,c.contract_number,c.title contract_title,c.client_id,c.opportunity_id,r.name client_name,o.title opportunity_title,u.name responsible_name,creator.name created_by_name,
 (SELECT count(*)::int FROM installation_checklist_items x WHERE x.organization_id=i.organization_id AND x.installation_id=i.id) checklist_total,
 (SELECT count(*)::int FROM installation_checklist_items x WHERE x.organization_id=i.organization_id AND x.installation_id=i.id AND x.checked) checklist_completed,
 (SELECT count(*)::int FROM installation_issues x WHERE x.organization_id=i.organization_id AND x.installation_id=i.id AND x.status IN ('open','in_progress')) open_issues_count,
 to_char(i.planned_on,'YYYY-MM-DD') planned_on,to_char(i.scheduled_on,'YYYY-MM-DD') scheduled_on,
 to_char(i.started_on,'YYYY-MM-DD') started_on,to_char(i.completed_on,'YYYY-MM-DD') completed_on`;
const joins=`FROM installations i JOIN contracts c ON c.organization_id=i.organization_id AND c.id=i.contract_id
 JOIN crm_records r ON r.organization_id=c.organization_id AND r.id=c.client_id
 LEFT JOIN crm_opportunities o ON o.organization_id=c.organization_id AND o.id=c.opportunity_id
 JOIN users u ON u.id=i.responsible_user_id JOIN users creator ON creator.id=i.created_by`;

async function readInstallation(actor:Actor,id:string,db:Db,lock:boolean,afterAuthorizedUpdate:boolean):Promise<Installation>{
 requirePermission(actor,'installations.read');uuid.parse(id);
 const p=afterAuthorizedUpdate?[actor.organizationId]:params(actor);p.push(id);
 const result=await db.query(`SELECT ${select} ${joins} WHERE ${afterAuthorizedUpdate?'i.organization_id=$1':scope(actor)} AND i.id=$${p.length}${lock?' FOR UPDATE OF i':''}`,p);
 if(!result.rows[0])throw new AccessError(404,'Instalação não encontrada.');
 return json(result.rows[0]);
}
export async function getInstallation(actor:Actor,id:string,db:Db=database(),lock=false):Promise<Installation>{
 return readInstallation(actor,id,db,lock,false);
}
async function validOwner(actor:Actor,userId:string,previous:string|null,db:Db){
 if(userId!==previous&&userId!==actor.userId&&!canAssign(actor))throw new AccessError(403,'Somente a gestão pode atribuir outro responsável.');
 const found=await db.query("SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id JOIN role_permissions rp ON rp.role_code=m.role_code WHERE m.organization_id=$1 AND m.user_id=$2 AND m.active AND u.active AND rp.permission_code='installations.read'",[actor.organizationId,userId]);
 if(!found.rowCount)throw new AccessError(400,'O responsável precisa estar ativo e ter acesso a instalações.');
}
export async function appendInstallationHistory(db:Db,actor:Actor,item:Installation,action:string,detail:string){
 await db.query('INSERT INTO installation_history(organization_id,installation_id,actor_id,action,detail,snapshot) VALUES ($1,$2,$3,$4,$5,$6::jsonb)',[actor.organizationId,item.id,actor.userId,action,detail,JSON.stringify(item)]);
 await db.query("INSERT INTO crm_activities(organization_id,record_id,actor_id,action,detail) VALUES ($1,$2,$3,'installation.'||$4,$5)",[actor.organizationId,item.client_id,actor.userId,action,`${item.installation_number} · ${detail}`]);
 if(item.opportunity_id)await db.query('UPDATE crm_opportunities SET last_activity_at=now() WHERE organization_id=$1 AND id=$2',[actor.organizationId,item.opportunity_id]);
}
export async function saveInstallation(actor:Actor,input:unknown,id?:string){
 requirePermission(actor,id?'installations.edit':'installations.create');
 const data=installationSchema.parse(input);
 return transaction(async db=>{
  const before=id?await getInstallation(actor,id,db,true):null;
  if(before&&before.version!==data.version)throw new AccessError(409,'Instalação atualizada por outra pessoa. Recarregue.');
  if(before&&['completed','cancelled'].includes(before.status))throw new AccessError(409,'Instalação encerrada não pode ser editada.');
  if(before&&before.contract_id!==data.contract_id)throw new AccessError(409,'O contrato vinculado não pode ser alterado.');
  if(!before){
   const contract=await getContract(actor,data.contract_id,db,true);
   if(!['signed','active','completed'].includes(contract.status))throw new AccessError(409,'Assine ou ative o contrato antes de criar a instalação.');
  }
  const responsible=data.responsible_user_id??before?.responsible_user_id??actor.userId;
  await validOwner(actor,responsible,before?.responsible_user_id??null,db);
  if(before?.status==='scheduled'&&!data.scheduled_on)throw new AccessError(400,'Informe a data agendada.');
  if(before?.status==='in_progress'&&!data.started_on)throw new AccessError(400,'Informe a data de início.');
  if(data.completed_on)throw new AccessError(400,'A conclusão deve ser registrada pela mudança de status.');
  let saved=id;
  if(before){
   await db.query('UPDATE installations SET responsible_user_id=$3,team_name=$4,installation_address=$5,planned_on=$6,scheduled_on=$7,started_on=$8,notes=$9,updated_by=$10,version=version+1,updated_at=now() WHERE organization_id=$1 AND id=$2',[actor.organizationId,id,responsible,data.team_name,data.installation_address,data.planned_on,data.scheduled_on,data.started_on,data.notes,actor.userId]);
  }else{
   const number=await db.query('SELECT contract_number FROM contracts WHERE organization_id=$1 AND id=$2',[actor.organizationId,data.contract_id]);
   const inserted=await db.query(`INSERT INTO installations(organization_id,contract_id,installation_number,responsible_user_id,team_name,installation_address,planned_on,scheduled_on,started_on,notes,created_by,updated_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11) ON CONFLICT(organization_id,contract_id) DO NOTHING RETURNING id`,
    [actor.organizationId,data.contract_id,`INST-${number.rows[0].contract_number}`,responsible,data.team_name,data.installation_address,data.planned_on,data.scheduled_on,data.started_on,data.notes,actor.userId]);
   if(!inserted.rowCount)throw new AccessError(409,'Este contrato já possui uma instalação.');
   saved=inserted.rows[0].id;
  }
  const item=await readInstallation(actor,saved!,db,false,true);
  if(!before){
   for(const [index,[code,label]] of defaultChecklist.entries())await db.query('INSERT INTO installation_checklist_items(organization_id,installation_id,code,label,position) VALUES ($1,$2,$3,$4,$5)',[actor.organizationId,item.id,code,label,index+1]);
   await appendInstallationHistory(db,actor,item,'created','Instalação criada a partir do contrato.');
  }
  else{
   const changes:Array<[boolean,string,string]>=[
    [before.responsible_user_id!==item.responsible_user_id,'responsible_changed','Responsável alterado.'],
    [before.planned_on!==item.planned_on||before.scheduled_on!==item.scheduled_on,'schedule_changed','Datas previstas ou agendadas alteradas.'],
    [before.started_on!==item.started_on,'start_changed','Data de início alterada.'],
    [before.installation_address!==item.installation_address||before.team_name!==item.team_name||before.notes!==item.notes,'updated','Endereço, equipe ou observações atualizados.']
   ];
   for(const [changed,action,detail] of changes)if(changed)await appendInstallationHistory(db,actor,item,action,detail);
  }
  return item;
 });
}
export async function setInstallationStatus(actor:Actor,id:string,input:unknown){
 const data=installationStatusSchema.parse(input);
 requirePermission(actor,['completed','cancelled'].includes(data.status)?'installations.manage':'installations.edit');
 return transaction(async db=>{
  const before=await getInstallation(actor,id,db,true);
  if(before.version!==data.version)throw new AccessError(409,'Instalação atualizada por outra pessoa. Recarregue.');
  if(before.status===data.status)return before;
  if(!installationTransitions[before.status].includes(data.status))throw new AccessError(409,'Mudança de status indisponível nesta etapa.');
  const scheduled=data.scheduled_on??before.scheduled_on;
  const started=data.started_on??before.started_on;
  const today=(await db.query("SELECT to_char(now() AT TIME ZONE 'America/Sao_Paulo','YYYY-MM-DD') today")).rows[0].today as string;
  const actualStart=data.status==='in_progress'?(started??today):started;
  const completed=data.status==='completed'?(data.completed_on??today):before.completed_on;
  if(data.status==='scheduled'&&!scheduled)throw new AccessError(400,'Informe a data agendada.');
  if(data.status==='completed'&&!actualStart)throw new AccessError(400,'Registre o início antes de concluir.');
  if(completed&&actualStart&&completed<actualStart)throw new AccessError(400,'A conclusão não pode anteceder o início.');
  let checklist:unknown[]=[],issues:unknown[]=[],openIssues=0,unchecked=0;
  if(data.status==='completed'){
   if(!before.installation_address.trim())throw new AccessError(400,'Informe o endereço antes de concluir.');
   checklist=(await db.query('SELECT code,label,checked,checked_by,checked_at,notes FROM installation_checklist_items WHERE organization_id=$1 AND installation_id=$2 ORDER BY position FOR UPDATE',[actor.organizationId,id])).rows;
   issues=(await db.query('SELECT id,title,status,priority,responsible_user_id,due_on,resolved_at FROM installation_issues WHERE organization_id=$1 AND installation_id=$2 ORDER BY created_at,id FOR UPDATE',[actor.organizationId,id])).rows;
   openIssues=issues.filter((issue)=>['open','in_progress'].includes((issue as {status:string}).status)).length;
   unchecked=checklist.filter((entry)=>!(entry as {checked:boolean}).checked).length;
   if(openIssues&&!data.confirm_open_issues)throw new AccessError(409,'Há pendências abertas. Confirme a conclusão com pendências para prosseguir.');
  }
  await db.query('UPDATE installations SET status=$3,scheduled_on=$4,started_on=$5,completed_on=$6,updated_by=$7,version=version+1,updated_at=now() WHERE organization_id=$1 AND id=$2',[actor.organizationId,id,data.status,scheduled,actualStart,completed,actor.userId]);
  if(data.status==='completed')await db.query("INSERT INTO installation_completions(organization_id,installation_id,completed_at,completed_by,final_notes,checklist_snapshot,issues_snapshot,had_open_issues) VALUES ($1,$2,CASE WHEN $3::date=(now() AT TIME ZONE 'America/Sao_Paulo')::date THEN now() ELSE ($3::date+time '12:00') AT TIME ZONE 'America/Sao_Paulo' END,$4,$5,$6::jsonb,$7::jsonb,$8)",[actor.organizationId,id,completed,actor.userId,data.final_notes,JSON.stringify(checklist),JSON.stringify(issues),openIssues>0]);
  const item=await getInstallation(actor,id,db);
  const action=data.status==='completed'?'completed':data.status==='cancelled'?'cancelled':'status_changed';
  await appendInstallationHistory(db,actor,item,action,data.status==='completed'?`Instalação concluída. Checklist: ${checklist.length-unchecked}/${checklist.length}; pendências abertas: ${openIssues}.${data.final_notes?` ${data.final_notes}`:''}`:`Status alterado para ${installationStatuses[data.status]}.`);
  return item;
 });
}
export async function listInstallations(actor:Actor,input:unknown){
 requirePermission(actor,'installations.read');
 const f=installationFiltersSchema.parse(input),p=params(actor),conditions=[scope(actor)];
 const add=(sql:string,value:unknown)=>{p.push(value);conditions.push(sql.replace('?',`$${p.length}`));};
 if(f.status!=='all')add('i.status=?',f.status);
 if(f.owner)add('i.responsible_user_id=?',f.owner);
 if(f.client_id)add('c.client_id=?',f.client_id);
 if(f.contract_id)add('i.contract_id=?',f.contract_id);
 if(f.q)add("lower(concat_ws(' ',i.installation_number,c.contract_number,c.title,r.name,o.title,u.name,i.installation_address)) LIKE lower(?)",`%${f.q.replace(/[\\%_]/g,'\\$&')}%`);
 const where=conditions.join(' AND ');
 const [items,count]=await Promise.all([
  database().query(`SELECT ${select} ${joins} WHERE ${where} ORDER BY i.created_at DESC,i.id LIMIT $${p.length+1} OFFSET $${p.length+2}`,[...p,f.pageSize,(f.page-1)*f.pageSize]),
  database().query(`SELECT count(*)::int total ${joins} WHERE ${where}`,p)
 ]);
 return {items:json<Installation[]>(items.rows),total:count.rows[0].total as number,page:f.page,pageSize:f.pageSize};
}
export async function getInstallationDetail(actor:Actor,id:string):Promise<InstallationDetail>{
 const item=await getInstallation(actor,id),p=[actor.organizationId,item.contract_id];
 const [items,history,checklist,files,issues,completion,delivery]=await Promise.all([
  database().query("SELECT i.id,i.description,i.category,i.quantity,COALESCE(e.name,k.name,'') source_name FROM contract_items i LEFT JOIN solar_equipment e ON e.organization_id=i.organization_id AND e.id=i.equipment_id LEFT JOIN solar_kits k ON k.organization_id=i.organization_id AND k.id=i.kit_id WHERE i.organization_id=$1 AND i.contract_id=$2 ORDER BY i.display_order",p),
  database().query('SELECT h.*,u.name actor_name FROM installation_history h JOIN users u ON u.id=h.actor_id WHERE h.organization_id=$1 AND h.installation_id=$2 ORDER BY h.created_at DESC,h.id DESC',[actor.organizationId,id]),
  database().query('SELECT x.*,u.name checked_by_name FROM installation_checklist_items x LEFT JOIN users u ON u.id=x.checked_by WHERE x.organization_id=$1 AND x.installation_id=$2 ORDER BY x.position',[actor.organizationId,id]),
  database().query('SELECT f.id,f.kind,f.name,f.description,f.category,f.original_filename,f.mime_type,f.file_size,f.version,f.created_at,u.name created_by_name FROM installation_files f JOIN users u ON u.id=f.created_by WHERE f.organization_id=$1 AND f.installation_id=$2 AND f.deleted_at IS NULL ORDER BY f.created_at DESC,f.id DESC',[actor.organizationId,id]),
  database().query("SELECT x.*,to_char(x.due_on,'YYYY-MM-DD') due_on,u.name responsible_name,c.name created_by_name FROM installation_issues x JOIN users u ON u.id=x.responsible_user_id JOIN users c ON c.id=x.created_by WHERE x.organization_id=$1 AND x.installation_id=$2 ORDER BY CASE x.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'resolved' THEN 2 ELSE 3 END,x.created_at DESC",[actor.organizationId,id]),
  database().query('SELECT c.*,u.name completed_by_name FROM installation_completions c JOIN users u ON u.id=c.completed_by WHERE c.organization_id=$1 AND c.installation_id=$2',[actor.organizationId,id]),
  database().query('SELECT d.*,u.name delivered_by_name FROM installation_deliveries d JOIN users u ON u.id=d.delivered_by WHERE d.organization_id=$1 AND d.installation_id=$2',[actor.organizationId,id])
 ]);
 return {installation:item,items:json(items.rows.map(row=>({...row,quantity:Number(row.quantity)}))),history:json(history.rows),checklist:json(checklist.rows),files:json(files.rows),issues:json(issues.rows),completion:completion.rows[0]?json(completion.rows[0]):null,delivery:delivery.rows[0]?json(delivery.rows[0]):null};
}
export async function installationOptions(actor:Actor):Promise<InstallationOptions>{
 if(!actor.permissions.includes('installations.create')&&!actor.permissions.includes('installations.edit'))throw new AccessError(403,'Seu perfil não tem acesso a esta área.');
 const p=all(actor)?[actor.organizationId]:[actor.organizationId,actor.userId];
 const [contracts,owners]=await Promise.all([
  database().query(`SELECT c.id,c.contract_number,c.title,r.name client_name,concat_ws(', ',NULLIF(concat_ws(' ',r.address,r.number),''),NULLIF(r.complement,''),NULLIF(r.neighborhood,''),NULLIF(concat_ws(' - ',r.city,r.state),''),NULLIF(r.postal_code,'')) installation_address FROM contracts c JOIN crm_records r ON r.organization_id=c.organization_id AND r.id=c.client_id LEFT JOIN installations i ON i.organization_id=c.organization_id AND i.contract_id=c.id WHERE c.organization_id=$1 ${all(actor)?'':'AND c.responsible_user_id=$2'} AND c.status IN ('signed','active','completed') AND i.id IS NULL ORDER BY c.created_at DESC LIMIT 100`,p),
  database().query("SELECT DISTINCT u.id,u.name FROM memberships m JOIN users u ON u.id=m.user_id JOIN role_permissions rp ON rp.role_code=m.role_code WHERE m.organization_id=$1 AND m.active AND u.active AND rp.permission_code='installations.read' ORDER BY u.name",[actor.organizationId])
 ]);
 return {contracts:contracts.rows,owners:canAssign(actor)?owners.rows:owners.rows.filter(row=>row.id===actor.userId)};
}
