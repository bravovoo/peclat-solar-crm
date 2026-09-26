import type { PoolClient } from 'pg';
import { database, transaction } from '@/server/db';
import { AccessError, requirePermission, type Actor } from '@/modules/auth/policy';
import { contactSchema, filterSchema, noteSchema, recordSchema, tagSchema, uuid, type CommercialRecord, type Kind, type RecordData, type Tag } from './domain';
import { assertCommercialAssignee, commercialScope, commercialScopeParams } from '@/modules/commercial/scope';
import {emitAutomationEvent} from '@/modules/automations/events';
import {syncWhatsAppRecordLinks} from '@/modules/whatsapp/contact-identity';
type Db=Pick<PoolClient,'query'>;
export class DuplicateError extends AccessError {
 constructor(public matches:{id:string;kind:Kind;name:string}[],public canOverride:boolean){super(409,'Encontramos um cadastro semelhante.');}
}
export function crmAccess(actor:Actor){if(!actor.permissions.includes('crm.all')&&!actor.permissions.includes('crm.own'))throw new AccessError(403,'Seu perfil não tem acesso aos cadastros comerciais.');}
function scope(actor:Actor,alias='r'){crmAccess(actor);return `${commercialScope(actor,alias,true)} AND ${alias}.deleted_at IS NULL`;}
function scopeParams(actor:Actor):unknown[]{return commercialScopeParams(actor);}
const selectRecord=`r.*,u.name AS owner_name,COALESCE(to_char(r.expected_close,'YYYY-MM-DD'),'') AS expected_close,
 (SELECT c.id FROM crm_records c WHERE c.organization_id=r.organization_id AND c.original_lead_id=r.id AND c.deleted_at IS NULL) AS converted_customer_id,
 COALESCE((SELECT json_agg(json_build_object('id',t.id,'name',t.name,'color',t.color) ORDER BY t.name) FROM crm_record_tags rt JOIN crm_tags t ON t.id=rt.tag_id AND t.organization_id=rt.organization_id WHERE rt.organization_id=r.organization_id AND rt.record_id=r.id),'[]') AS tags`;
const joins='FROM crm_records r LEFT JOIN users u ON u.id=r.owner_id';
function normalize(row:Record<string,unknown>):CommercialRecord{return JSON.parse(JSON.stringify({...row,potential_value:Number(row.potential_value),average_consumption:row.average_consumption===null?null:Number(row.average_consumption)}));}
export async function getRecord(actor:Actor,id:string,db:Db=database(),lock=false):Promise<CommercialRecord>{
 uuid.parse(id);const params=scopeParams(actor);params.push(id);
 const {rows}=await db.query(`SELECT ${selectRecord} ${joins} WHERE ${scope(actor)} AND r.id=$${params.length}${lock?' FOR UPDATE OF r':''}`,params);
 if(!rows[0])throw new AccessError(404,'Cadastro não encontrado.');return normalize(rows[0]);
}
function filtered(actor:Actor,kind:Kind,input:unknown){
 const f=filterSchema.parse(input);const params=scopeParams(actor);const clauses=[scope(actor)];
 const add=(sql:string,v:unknown)=>{params.push(v);clauses.push(sql.replaceAll('?',`$${params.length}`));};
 add('r.kind=?',kind);if(f.status!=='all')add('r.status=?',f.status);
 if(f.view==='all'&&actor.role!=='admin')throw new AccessError(403,'Visão total restrita ao administrador.');
 if(f.view==='team'&&actor.role==='seller')throw new AccessError(403,'Visão de equipe indisponível.');
 if(f.view==='unassigned'){
  if(kind!=='lead'||actor.role==='seller')throw new AccessError(403,'Filtro indisponível.');
  clauses.push('r.owner_id IS NULL');
 }else if(f.view==='mine')add('r.owner_id=?',actor.userId);
 else if(f.view==='team')clauses.push('r.owner_id IS NOT NULL');
 if(f.team){
  if(actor.role==='seller')throw new AccessError(403,'Filtro de equipe indisponível.');
  add('EXISTS(SELECT 1 FROM commercial_team_members tm WHERE tm.organization_id=r.organization_id AND tm.user_id=r.owner_id AND tm.team_id=?)',f.team);
 }
 if(f.q){const q=f.q.replace(/[\\%_]/g,'\\$&');const numeric=f.q.replace(/\D/g,'');add("(lower(r.name || ' ' || r.trade_name || ' ' || r.email || ' ' || r.phone || ' ' || r.whatsapp || ' ' || r.document || ' ' || r.city) LIKE lower(?) ESCAPE '\\')",`%${q}%`);if(numeric.length>=4){const textClause=clauses.pop();params.push(`%${numeric}%`);clauses.push(`(${textClause} OR r.phone LIKE $${params.length} OR r.whatsapp LIKE $${params.length} OR r.document LIKE $${params.length})`);}const doc=f.q.toUpperCase().replace(/[.\/\-\s]/g,'');if(/^[A-Z0-9]{12}\d{2}$/.test(doc)){const textClause=clauses.pop();params.push(doc);clauses.push(`(${textClause} OR r.document=$${params.length})`);}}
 for(const key of ['source','stage','temperature','priority','city','state','person_type'] as const)if(f[key])add(`lower(r.${key})=lower(?)`,f[key]);
 if(f.owner)add('r.owner_id=?',f.owner);
 if(f.tag)add('EXISTS(SELECT 1 FROM crm_record_tags rt WHERE rt.organization_id=r.organization_id AND rt.record_id=r.id AND rt.tag_id=?)',f.tag);
 if(f.from)add('r.created_at >= (?::date::timestamp AT TIME ZONE \'America/Sao_Paulo\')',f.from);
 if(f.to)add('r.created_at < ((?::date+1)::timestamp AT TIME ZONE \'America/Sao_Paulo\')',f.to);
 return {f,params,where:clauses.join(' AND ')};
}
export async function listRecords(actor:Actor,kind:Kind,input:unknown){
 const {f,params,where}=filtered(actor,kind,input);
 const order={newest:'r.created_at DESC,r.id',oldest:'r.created_at,r.id',name:'r.name,r.id',value:'r.potential_value DESC,r.id'}[f.sort];
 const result=await database().query(`SELECT ${selectRecord} ${joins} WHERE ${where} ORDER BY ${order} LIMIT $${params.length+1} OFFSET $${params.length+2}`,[...params,f.pageSize,(f.page-1)*f.pageSize]);
 const count=await database().query(`SELECT count(*)::int AS total FROM crm_records r WHERE ${where}`,params);
 const unassigned=kind==='lead'&&actor.role!=='seller'?await database().query(`SELECT count(*)::int total FROM crm_records r WHERE ${scope(actor)} AND r.kind='lead' AND r.owner_id IS NULL AND r.status='active'`,scopeParams(actor)):null;
 return {records:result.rows.map(normalize),total:count.rows[0].total as number,page:f.page,pageSize:f.pageSize,unassigned:unassigned?.rows[0]?.total??0};
}
export async function exportRecords(actor:Actor,kind:Kind,input:unknown){
 const {params,where}=filtered(actor,kind,input);
 const {rows}=await database().query(`SELECT ${selectRecord} ${joins} WHERE ${where} ORDER BY r.created_at DESC,r.id LIMIT 10001`,params);
 if(rows.length>10000)throw new AccessError(422,'A exportação está limitada a 10.000 cadastros. Refine os filtros.');
 return rows.map(normalize);
}
async function ownerAllowed(actor:Actor,owner:string,db:Db){
 await assertCommercialAssignee(actor,owner,db);
}
async function activity(db:Db,actor:Actor,id:string,action:string,detail=''){
 await db.query('INSERT INTO crm_activities(organization_id,record_id,actor_id,action,detail) VALUES ($1,$2,$3,$4,$5)',[actor.organizationId,id,actor.userId,action,detail]);
}
async function duplicates(db:Db,actor:Actor,data:RecordData,exclude?:CommercialRecord){
 const {rows}=await db.query(`SELECT id,kind,name,owner_id FROM crm_records WHERE organization_id=$1 AND deleted_at IS NULL
 AND ($2::uuid IS NULL OR (id!=$2 AND original_lead_id IS DISTINCT FROM $2))
 AND ($3::uuid IS NULL OR id!=$3)
 AND (($4!='' AND email=$4) OR ($5!='' AND document=$5) OR ($6!='' AND (phone=$6 OR whatsapp=$6)) OR ($7!='' AND (phone=$7 OR whatsapp=$7))) LIMIT 20`,[actor.organizationId,exclude?.id??null,exclude?.original_lead_id??null,data.email,data.document,data.phone,data.whatsapp]);
 if(rows.length){const canOverride=actor.permissions.includes('crm.duplicate.override');if(!data.allow_duplicate||!canOverride)throw new DuplicateError(rows.filter(r=>actor.role==='admin'||r.owner_id===actor.userId).map(({id,kind,name})=>({id,kind,name})),canOverride);}
}
const fields=['name','person_type','document','phone','whatsapp','email','postal_code','address','number','complement','neighborhood','city','state','source','campaign','priority','temperature','stage','potential_value','expected_close','observations','average_consumption','utility','property_type','roof_type','consumer_units','battery_interest','financing_interest','trade_name','state_registration','website'] as const;
async function setTags(db:Db,actor:Actor,id:string,ids:string[]){
 const unique=[...new Set(ids)];
 const valid=await db.query('SELECT id FROM crm_tags WHERE organization_id=$1 AND id=ANY($2::uuid[])',[actor.organizationId,unique]);
 if(valid.rowCount!==unique.length)throw new AccessError(400,'Uma das tags não pertence à organização.');
 await db.query('DELETE FROM crm_record_tags WHERE organization_id=$1 AND record_id=$2',[actor.organizationId,id]);
 for(const tag of unique)await db.query('INSERT INTO crm_record_tags(organization_id,record_id,tag_id) VALUES ($1,$2,$3)',[actor.organizationId,id,tag]);
}
export async function saveRecordInTransaction(actor:Actor,kind:Kind,input:unknown,db:Db,id?:string){
 crmAccess(actor);const data=recordSchema.parse(input);
 if(kind==='company'&&data.person_type!=='PJ')throw new AccessError(400,'Empresa deve ser do tipo PJ.');
 await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[actor.organizationId]);
 const before=id?await getRecord(actor,id,db,true):null;
 if(before&&before.kind!==kind)throw new AccessError(404,'Cadastro não encontrado.');
 if(before&&data.version!==before.version)throw new AccessError(409,'Este cadastro foi atualizado por outra pessoa. Recarregue antes de salvar.');
 const owner=data.owner_id!==undefined?data.owner_id:before?before.owner_id:actor.userId;
 if(owner===null){if(kind!=='lead'||actor.role==='seller')throw new AccessError(403,'Somente a gestão pode manter leads sem responsável.');}
 else if(!before||before.owner_id!==owner)await ownerAllowed(actor,owner,db);
 await duplicates(db,actor,data,before??undefined);
 const values=fields.map(key=>key==='expected_close'?(data[key]||null):data[key]);
 let savedId=id;
 if(before){
  await db.query(`UPDATE crm_records SET ${fields.map((key,i)=>`${key}=$${i+1}`).join(',')},owner_id=$${values.length+1},version=version+1,updated_at=now() WHERE organization_id=$${values.length+2} AND id=$${values.length+3}`,[...values,owner,actor.organizationId,id]);
  if(before.stage!==data.stage)await activity(db,actor,id!,'stage.changed',`${before.stage} -> ${data.stage}`);
  if(before.owner_id!==owner){await activity(db,actor,id!,'owner.changed',`${before.owner_name??'Sem responsável'} -> ${owner??'Sem responsável'}`);await db.query("INSERT INTO audit_logs(organization_id,actor_id,action) VALUES ($1,$2,'commercial.owner.changed')",[actor.organizationId,actor.userId]);}
  await activity(db,actor,id!,'record.updated','Dados do cadastro atualizados.');
 }else{
  const result=await db.query(`INSERT INTO crm_records(${fields.join(',')},organization_id,owner_id,kind) VALUES (${[...values,actor.organizationId,owner,kind].map((_,i)=>`$${i+1}`).join(',')}) RETURNING id`,[...values,actor.organizationId,owner,kind]);savedId=result.rows[0].id;
  await activity(db,actor,savedId!,'record.created','Cadastro criado.');
 }
 await setTags(db,actor,savedId!,data.tag_ids);
 await syncWhatsAppRecordLinks(db,{organizationId:actor.organizationId,recordId:savedId!,numbers:[data.phone,data.whatsapp],profileName:data.name,source:'manual'});
 if(kind==='lead'&&!before)await emitAutomationEvent(db,{organizationId:actor.organizationId,type:'lead.created',eventId:`lead:${savedId}:created`,entityType:'record',entityId:savedId,recordId:savedId,payload:{owner_id:owner,stage:data.stage}});
 if(kind==='lead'&&before&&before.stage!==data.stage)await emitAutomationEvent(db,{organizationId:actor.organizationId,type:'lead.stage_changed',eventId:`lead:${savedId}:stage:${before.version+1}`,entityType:'record',entityId:savedId,recordId:savedId,payload:{owner_id:owner,stage:data.stage,previous_stage:before.stage}});
 if(data.allow_duplicate)await activity(db,actor,savedId!,'duplicate.confirmed','Possível duplicidade confirmada por usuário autorizado.');
 return getRecord(actor,savedId!,db);
}
export async function saveRecord(actor:Actor,kind:Kind,input:unknown,id?:string){
 return transaction(db=>saveRecordInTransaction(actor,kind,input,db,id));
}
export async function recordAction(actor:Actor,id:string,action:'archive'|'restore'|'delete'|'convert',version:number){
 crmAccess(actor);if(action==='delete')requirePermission(actor,'crm.delete');
 return transaction(async db=>{
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[actor.organizationId]);
  const record=await getRecord(actor,id,db,true);
  if(record.version!==version)throw new AccessError(409,'Cadastro alterado. Recarregue a página.');
  if(action==='convert'){
   if(record.kind!=='lead'||record.status!=='active')throw new AccessError(409,'Somente um lead ativo pode ser convertido.');
   if(!record.owner_id)throw new AccessError(409,'Atribua um responsável antes de converter o lead.');
   const existing=await db.query('SELECT id FROM crm_records WHERE organization_id=$1 AND original_lead_id=$2',[actor.organizationId,id]);
   if(existing.rowCount)throw new AccessError(409,'Este lead já possui um cliente vinculado.');
   const created=await db.query(`INSERT INTO crm_records(${fields.join(',')},organization_id,owner_id,kind,original_lead_id,is_demo) SELECT ${fields.join(',')},organization_id,owner_id,'customer',id,is_demo FROM crm_records WHERE organization_id=$1 AND id=$2 RETURNING id`,[actor.organizationId,id]);
   const customerId=created.rows[0].id;
   await db.query('INSERT INTO crm_record_tags(organization_id,record_id,tag_id) SELECT organization_id,$3,tag_id FROM crm_record_tags WHERE organization_id=$1 AND record_id=$2',[actor.organizationId,id,customerId]);
   await db.query('INSERT INTO crm_record_contacts(organization_id,record_id,contact_id,is_primary) SELECT organization_id,$3,contact_id,is_primary FROM crm_record_contacts WHERE organization_id=$1 AND record_id=$2',[actor.organizationId,id,customerId]);
   await db.query("UPDATE crm_records SET status='converted',version=version+1,updated_at=now() WHERE organization_id=$1 AND id=$2",[actor.organizationId,id]);
   await activity(db,actor,id,'lead.converted','Lead convertido em cliente. Histórico preservado.');
   await activity(db,actor,customerId,'customer.converted','Cliente criado a partir do lead.');
   return getRecord(actor,customerId,db);
  }
  if(record.status==='converted')throw new AccessError(409,'O lead convertido deve ser preservado como origem do cliente.');
  if(action==='delete'){
   await db.query("UPDATE whatsapp_conversations SET record_id=NULL,link_status='unidentified',link_source='none',version=version+1,updated_at=now() WHERE organization_id=$1 AND record_id=$2",[actor.organizationId,id]);
   await db.query('DELETE FROM crm_whatsapp_identities WHERE organization_id=$1 AND record_id=$2',[actor.organizationId,id]);
   await db.query('UPDATE crm_records SET deleted_at=now(),version=version+1 WHERE organization_id=$1 AND id=$2',[actor.organizationId,id]);
  }
  else await db.query('UPDATE crm_records SET status=$3,version=version+1,updated_at=now() WHERE organization_id=$1 AND id=$2',[actor.organizationId,id,action==='archive'?'archived':'active']);
  await activity(db,actor,id,`record.${action}`,action==='delete'?'Cadastro excluído da operação; histórico preservado.':'Status do cadastro atualizado.');
  return {id};
 });
}
export async function crmOptions(actor:Actor){
 crmAccess(actor);
 const owners=await database().query(`SELECT u.id,u.name FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.organization_id=$1 AND m.active AND u.active AND EXISTS(SELECT 1 FROM role_permissions rp WHERE rp.role_code=m.role_code AND rp.permission_code IN ('crm.all','crm.own')) ${actor.role==='admin'?'':actor.role==='manager'?`AND (u.id=$2 OR EXISTS(SELECT 1 FROM commercial_team_members tm JOIN commercial_teams t ON t.organization_id=tm.organization_id AND t.id=tm.team_id WHERE tm.organization_id=m.organization_id AND tm.user_id=u.id AND t.manager_user_id=$2 AND t.active))`:'AND u.id=$2'} ORDER BY u.name LIMIT 200`,scopeParams(actor));
 const tags=await database().query<Tag>('SELECT id,name,color FROM crm_tags WHERE organization_id=$1 ORDER BY name LIMIT 500',[actor.organizationId]);
 const teams=actor.role==='seller'?{rows:[]} : await database().query<{id:string;name:string;auto_distribute:boolean}>(`SELECT id,name,auto_distribute FROM commercial_teams WHERE organization_id=$1 AND active AND ($2::boolean OR manager_user_id=$3) ORDER BY name`,[actor.organizationId,actor.role==='admin',actor.userId]);
 const sellers=actor.role==='seller'?{rows:[]} : await database().query<{id:string;name:string;active:boolean}>(`SELECT u.id,u.name,(u.active AND m.active) active FROM memberships m JOIN users u ON u.id=m.user_id
   WHERE m.organization_id=$1 AND m.role_code='seller' AND ($2::boolean OR EXISTS(
     SELECT 1 FROM commercial_team_members tm JOIN commercial_teams t ON t.organization_id=tm.organization_id AND t.id=tm.team_id
     WHERE tm.organization_id=m.organization_id AND tm.user_id=m.user_id AND t.manager_user_id=$3 AND t.active))
   ORDER BY u.name,u.id LIMIT 500`,[actor.organizationId,actor.role==='admin',actor.userId]);
 const viewScope:'all'|'team'|'mine'=actor.role==='admin'?'all':actor.role==='manager'?'team':'mine';
 return {owners:owners.rows as {id:string;name:string}[],tags:tags.rows,teams:teams.rows,sellers:sellers.rows,scope:viewScope};
}
export async function mutateTag(actor:Actor,input:unknown,id?:string,remove=false){
 requirePermission(actor,'crm.tags.manage');if(id)uuid.parse(id);
 const data=remove?null:tagSchema.parse(input);
 return transaction(async db=>{
  if(remove){const result=await db.query('DELETE FROM crm_tags WHERE organization_id=$1 AND id=$2 RETURNING id',[actor.organizationId,id]);if(!result.rowCount)throw new AccessError(404,'Tag não encontrada.');}
  else{try{if(id){const result=await db.query('UPDATE crm_tags SET name=$3,color=$4 WHERE organization_id=$1 AND id=$2 RETURNING id',[actor.organizationId,id,data!.name,data!.color]);if(!result.rowCount)throw new AccessError(404,'Tag não encontrada.');}else{const count=await db.query('SELECT count(*)::int AS n FROM crm_tags WHERE organization_id=$1',[actor.organizationId]);if(count.rows[0].n>=500)throw new AccessError(422,'Limite de 500 tags atingido.');await db.query('INSERT INTO crm_tags(organization_id,name,color) VALUES ($1,$2,$3)',[actor.organizationId,data!.name,data!.color]);}}catch(e){if((e as {code?:string}).code==='23505')throw new AccessError(409,'Já existe uma tag com este nome.');throw e;}}
  await db.query('INSERT INTO audit_logs(organization_id,actor_id,action) VALUES ($1,$2,$3)',[actor.organizationId,actor.userId,remove?'crm.tag.deleted':id?'crm.tag.updated':'crm.tag.created']);
  return {ok:true};
 });
}
export async function recordFeed(actor:Actor,id:string,type:'activities'|'notes'|'contacts'|'tasks',page=1){
 if(type==='tasks')return (await import('@/modules/commercial/repository')).listTasks(actor,{record_id:id,page});
 const record=await getRecord(actor,id);const ids=[id,...(record.original_lead_id?[record.original_lead_id]:[])];
 if(type==='contacts'){
  const {rows}=await database().query(`SELECT c.*,rc.is_primary FROM crm_contacts c JOIN crm_record_contacts rc ON rc.organization_id=c.organization_id AND rc.contact_id=c.id WHERE rc.organization_id=$1 AND rc.record_id=$2 ORDER BY rc.is_primary DESC,c.name,c.id LIMIT 20 OFFSET $3`,[actor.organizationId,id,(page-1)*20]);
  const count=await database().query('SELECT count(*)::int AS n FROM crm_record_contacts WHERE organization_id=$1 AND record_id=$2',[actor.organizationId,id]);return {items:rows,total:count.rows[0].n,page};
 }
 const table={activities:'crm_activities',notes:'crm_notes',tasks:'crm_tasks'}[type];
 const {rows}=await database().query(`SELECT x.*,u.name AS actor_name FROM ${table} x JOIN users u ON u.id=x.${'actor_id'} WHERE x.organization_id=$1 AND x.record_id=ANY($2::uuid[]) ORDER BY x.created_at DESC,x.id LIMIT 20 OFFSET $3`,[actor.organizationId,ids,(page-1)*20]);
 const count=await database().query(`SELECT count(*)::int AS n FROM ${table} WHERE organization_id=$1 AND record_id=ANY($2::uuid[])`,[actor.organizationId,ids]);return {items:rows,total:count.rows[0].n,page};
}
export async function addNote(actor:Actor,input:unknown){const data=noteSchema.parse(input);return transaction(async db=>{await getRecord(actor,data.record_id,db,true);const r=await db.query('INSERT INTO crm_notes(organization_id,record_id,actor_id,body) VALUES ($1,$2,$3,$4) RETURNING id',[actor.organizationId,data.record_id,actor.userId,data.body]);await activity(db,actor,data.record_id,'note.created',data.body);return r.rows[0];});}
export async function addContact(actor:Actor,input:unknown){const data=contactSchema.parse(input);return transaction(async db=>{
 await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[actor.organizationId]);
 await getRecord(actor,data.record_id,db,true);
 const result=await db.query('INSERT INTO crm_contacts(organization_id,name,job_title,phone,whatsapp,email,observations) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',[actor.organizationId,data.name,data.job_title,data.phone,data.whatsapp,data.email,data.observations]);
 if(data.is_primary)await db.query('UPDATE crm_record_contacts SET is_primary=false WHERE organization_id=$1 AND record_id=$2',[actor.organizationId,data.record_id]);
 await db.query('INSERT INTO crm_record_contacts(organization_id,record_id,contact_id,is_primary) VALUES ($1,$2,$3,$4)',[actor.organizationId,data.record_id,result.rows[0].id,data.is_primary]);
 await syncWhatsAppRecordLinks(db,{organizationId:actor.organizationId,recordId:data.record_id,numbers:[data.phone,data.whatsapp],profileName:data.name,source:'manual'});
 await activity(db,actor,data.record_id,'contact.created',data.name);return result.rows[0];
});}
export async function addTask(actor:Actor,input:unknown){return (await import('@/modules/commercial/repository')).saveTask(actor,input);}
export async function completeTask(actor:Actor,id:string){await (await import('@/modules/commercial/repository')).updateTaskStatus(actor,id,{status:'completed'});return {ok:true};}
export async function dashboard(actor:Actor){
 crmAccess(actor);const params=scopeParams(actor);const where=scope(actor)+" AND r.status!='archived' AND r.is_demo=false";
 const counts=await database().query(`SELECT count(*) FILTER(WHERE kind='lead')::int AS leads,count(*) FILTER(WHERE kind='lead' AND stage='new' AND status='active')::int AS new_leads,count(*) FILTER(WHERE kind='lead' AND stage NOT IN ('new','won','lost') AND status='active')::int AS in_service,count(*) FILTER(WHERE kind='customer')::int AS customers FROM crm_records r WHERE ${where}`,params);
 const grouped:Record<string,{label:string;total:number}[]>={};
 for(const key of ['source','stage','owner'] as const){const expression=key==='owner'?'u.name':`r.${key}`;const result=await database().query(`SELECT ${expression} AS label,count(*)::int AS total ${joins} WHERE ${where} AND r.kind='lead' GROUP BY ${expression}${key==='owner'?',r.owner_id':''} ORDER BY total DESC,label LIMIT 100`,params);grouped[key]=result.rows;}
 const row=counts.rows[0];return {leads:Number(row.leads),new_leads:Number(row.new_leads),in_service:Number(row.in_service),customers:Number(row.customers),grouped};
}
export async function globalSearch(actor:Actor,q:string){
 crmAccess(actor);if(q.trim().length<2)return {lead:[],customer:[],company:[],contacts:[]};
 const result:Record<string,unknown[]>={};
 for(const kind of ['lead','customer','company'] as const)result[kind]=(await listRecords(actor,kind,{q,pageSize:8,status:'all'})).records.map(r=>({id:r.id,name:r.name,kind:r.kind}));
 const params=scopeParams(actor);params.push(`%${q.toLowerCase().replace(/[\\%_]/g,'\\$&')}%`);const pos=params.length;const phone=q.replace(/\D/g,'');params.push(phone.length>=4?`%${phone}%`:null);const phonePos=params.length;
 const {rows}=await database().query(`SELECT c.id,c.name,link.record_id,link.kind FROM crm_contacts c JOIN LATERAL (SELECT r.id AS record_id,r.kind FROM crm_record_contacts rc JOIN crm_records r ON r.id=rc.record_id AND r.organization_id=rc.organization_id WHERE rc.contact_id=c.id AND rc.organization_id=c.organization_id AND ${scope(actor)} ORDER BY r.created_at DESC LIMIT 1) link ON true WHERE c.organization_id=$1 AND (lower(c.name||' '||c.phone||' '||c.whatsapp||' '||c.email) LIKE $${pos} ESCAPE '\\' OR c.phone LIKE $${phonePos} OR c.whatsapp LIKE $${phonePos}) ORDER BY c.name LIMIT 8`,params);
 result.contacts=rows;return result;
}
