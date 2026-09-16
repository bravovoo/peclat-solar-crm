import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {database,transaction} from '@/server/db';
import {AccessError,requirePermission,type Actor} from '@/modules/auth/policy';
import {uuid} from '@/modules/crm/domain';
import {appendInstallationHistory,getInstallation} from './repository';
import {checklistUpdateSchema,deliverySchema,fileMetadataSchema,issueSchema,type ChecklistItem,type InstallationDelivery,type InstallationFile,type InstallationIssue} from './domain';
import {loadInstallationFile,removeInstallationFile,storeInstallationFile,validateInstallationFile} from './file-storage';

type Db=Pick<PoolClient,'query'>;
const json=<T>(value:unknown)=>JSON.parse(JSON.stringify(value)) as T;
const photoCategories=['before','equipment','roof','during','electrical','modules','inverter','completed','issue','other'];
const documentCategories=['installation','delivery','other'];
async function currentInstallation(actor:Actor,id:string,db:Db,lock=false){return getInstallation(actor,id,db,lock);}
async function editable(actor:Actor,id:string,db:Db){
 requirePermission(actor,'installations.edit');const item=await currentInstallation(actor,id,db,true);
 if(['completed','cancelled'].includes(item.status))throw new AccessError(409,'Instalação encerrada não permite esta alteração.');
 return item;
}
async function activeOwner(actor:Actor,id:string,db:Db){
 const found=await db.query("SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id JOIN role_permissions rp ON rp.role_code=m.role_code WHERE m.organization_id=$1 AND m.user_id=$2 AND m.active AND u.active AND rp.permission_code='installations.read'",[actor.organizationId,id]);
 if(!found.rowCount)throw new AccessError(400,'O responsável precisa estar ativo e ter acesso a instalações.');
}
export async function updateChecklistItem(actor:Actor,id:string,input:unknown){
 const data=checklistUpdateSchema.parse(input);uuid.parse(id);
 return transaction(async db=>{
  const reference=await db.query('SELECT installation_id FROM installation_checklist_items WHERE organization_id=$1 AND id=$2',[actor.organizationId,id]);
  if(!reference.rowCount)throw new AccessError(404,'Item do checklist não encontrado.');
  const installation=await editable(actor,reference.rows[0].installation_id,db);
  const row=await db.query('SELECT * FROM installation_checklist_items WHERE organization_id=$1 AND id=$2 FOR UPDATE',[actor.organizationId,id]);
  if(!row.rowCount||row.rows[0].installation_id!==installation.id)throw new AccessError(404,'Item do checklist não encontrado.');
  const previous=row.rows[0];
  if(previous.version!==data.version)throw new AccessError(409,'Item do checklist atualizado por outra pessoa. Recarregue.');
  if(previous.checked===data.checked&&previous.notes===data.notes)return json<ChecklistItem>(previous);
  const updated=await db.query("UPDATE installation_checklist_items SET checked=$3,checked_by=CASE WHEN $3 THEN $4::uuid ELSE NULL END,checked_at=CASE WHEN $3 THEN now() ELSE NULL END,notes=$5,version=version+1,updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *",[actor.organizationId,id,data.checked,actor.userId,data.notes]);
  await appendInstallationHistory(db,actor,installation,'checklist_changed',`${previous.label}: ${data.checked?'concluído':'desmarcado'}${data.notes?` · ${data.notes}`:''}`);
  return json<ChecklistItem>(updated.rows[0]);
 });
}
async function fileRow(actor:Actor,id:string,db:Db,lock=false){
 uuid.parse(id);const result=await db.query(`SELECT f.* FROM installation_files f WHERE f.organization_id=$1 AND f.id=$2 AND f.deleted_at IS NULL${lock?' FOR UPDATE OF f':''}`,[actor.organizationId,id]);
 if(!result.rowCount)throw new AccessError(404,'Arquivo da instalação não encontrado.');
 await getInstallation(actor,result.rows[0].installation_id,db);
 return result.rows[0] as {id:string;installation_id:string;storage_key:string;content_sha256:string;mime_type:string;original_filename:string;name:string;kind:'photo'|'document';version:number};
}
export async function addInstallationFile(actor:Actor,input:unknown,file:{name:string;type:string;bytes:Uint8Array}){
 requirePermission(actor,'installations.edit');const data=fileMetadataSchema.parse(input);
 if(data.kind==='photo'&&!photoCategories.includes(data.category)||data.kind==='document'&&!documentCategories.includes(data.category))throw new AccessError(400,'Categoria de arquivo inválida.');
 const checked=validateInstallationFile(file.name,file.type,file.bytes,data.kind);
 const installation=await getInstallation(actor,data.installation_id);
 if(installation.status==='cancelled')throw new AccessError(409,'Instalação cancelada não aceita arquivos.');
 const id=randomUUID(),storageKey=`${actor.organizationId}/installations/${data.installation_id}/${id}.${checked.extension}`;
 await storeInstallationFile(storageKey,file.bytes,checked.mimeType);
 try{return await transaction(async db=>{
  const current=await getInstallation(actor,data.installation_id,db,true);
  if(current.status==='cancelled')throw new AccessError(409,'Instalação cancelada não aceita arquivos.');
  const result=await db.query('INSERT INTO installation_files(id,organization_id,installation_id,kind,name,description,category,original_filename,mime_type,file_size,content_sha256,storage_key,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id,kind,name,description,category,original_filename,mime_type,file_size,version,created_at',[id,actor.organizationId,data.installation_id,data.kind,data.name,data.description,data.category,checked.filename,checked.mimeType,file.bytes.length,checked.sha256,storageKey,actor.userId]);
  await appendInstallationHistory(db,actor,current,data.kind==='photo'?'photo_added':'document_added',`${data.name} anexado.`);
  return json<InstallationFile>({...result.rows[0],created_by_name:actor.name});
 });}catch(error){await removeInstallationFile(storageKey).catch(()=>{});throw error;}
}
export async function getInstallationFile(actor:Actor,id:string){const row=await fileRow(actor,id,database());return {file:row,bytes:await loadInstallationFile(row.storage_key,row.content_sha256)};}
export async function deleteInstallationFile(actor:Actor,id:string,version:unknown){
 requirePermission(actor,'installations.manage');const expected=Number(version);if(!Number.isInteger(expected)||expected<1)throw new AccessError(400,'Versão inválida.');
 const row=await transaction(async db=>{
  const file=await fileRow(actor,id,db,true);if(file.version!==expected)throw new AccessError(409,'Arquivo atualizado por outra pessoa. Recarregue.');
  const installation=await getInstallation(actor,file.installation_id,db,true);
  await db.query('UPDATE installation_files SET deleted_by=$3,deleted_at=now(),version=version+1,updated_at=now() WHERE organization_id=$1 AND id=$2',[actor.organizationId,id,actor.userId]);
  await appendInstallationHistory(db,actor,installation,file.kind==='photo'?'photo_removed':'document_removed',`${file.name} removido.`);
  return file;
 });
 await removeInstallationFile(row.storage_key);
 return {removed:true};
}
export async function saveInstallationIssue(actor:Actor,input:unknown,id?:string){
 const data=issueSchema.parse(input);requirePermission(actor,'installations.edit');
 return transaction(async db=>{
  const installation=id?await getInstallation(actor,data.installation_id,db,true):await editable(actor,data.installation_id,db);
  if(installation.status==='cancelled')throw new AccessError(409,'Instalação cancelada não permite alterar pendências.');
  await activeOwner(actor,data.responsible_user_id,db);
  let previous:null|{installation_id:string;version:number;status:string}=null;
  if(id){uuid.parse(id);const found=await db.query('SELECT * FROM installation_issues WHERE organization_id=$1 AND id=$2 FOR UPDATE',[actor.organizationId,id]);if(!found.rowCount)throw new AccessError(404,'Pendência não encontrada.');previous=found.rows[0];if(previous!.installation_id!==installation.id)throw new AccessError(400,'A pendência pertence a outra instalação.');if(previous!.version!==data.version)throw new AccessError(409,'Pendência atualizada por outra pessoa. Recarregue.');}
  if(data.status==='resolved'&&!data.resolution_notes)throw new AccessError(400,'Informe a resolução da pendência.');
  if(!id&&data.status!=='open')throw new AccessError(400,'A pendência deve ser criada como aberta.');
  const result=id?await db.query("UPDATE installation_issues SET title=$3,description=$4,status=$5,priority=$6,responsible_user_id=$7,due_on=$8,resolved_at=CASE WHEN $5='resolved' THEN COALESCE(resolved_at,now()) ELSE NULL END,resolution_notes=$9,updated_by=$10,version=version+1,updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *",[actor.organizationId,id,data.title,data.description,data.status,data.priority,data.responsible_user_id,data.due_on,data.resolution_notes,actor.userId]):await db.query('INSERT INTO installation_issues(organization_id,installation_id,title,description,priority,responsible_user_id,due_on,created_by,updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING *',[actor.organizationId,installation.id,data.title,data.description,data.priority,data.responsible_user_id,data.due_on,actor.userId]);
  const action=!id?'issue_created':data.status==='resolved'&&previous?.status!=='resolved'?'issue_resolved':'issue_updated';
  await appendInstallationHistory(db,actor,installation,action,`${data.title} · ${data.status}.`);
  return json<InstallationIssue>(result.rows[0]);
 });
}
export async function saveInstallationDelivery(actor:Actor,installationId:string,input:unknown){
 requirePermission(actor,'installations.manage');const data=deliverySchema.parse(input);
 if(!data.confirmed)throw new AccessError(400,'Confirme a entrega para registrar o aceite.');
 return transaction(async db=>{
  const installation=await getInstallation(actor,installationId,db,true);
  if(installation.status!=='completed')throw new AccessError(409,'Conclua a instalação antes de registrar a entrega.');
  await activeOwner(actor,data.delivered_by,db);
  const existing=await db.query('SELECT * FROM installation_deliveries WHERE organization_id=$1 AND installation_id=$2 FOR UPDATE',[actor.organizationId,installationId]);
  if(existing.rowCount&&existing.rows[0].version!==data.version)throw new AccessError(409,'Entrega atualizada por outra pessoa. Recarregue.');
  if(!existing.rowCount&&data.version)throw new AccessError(409,'Registro de entrega não encontrado.');
  const result=existing.rowCount?await db.query('UPDATE installation_deliveries SET delivered_at=$3,delivered_by=$4,recipient_name=$5,notes=$6,confirmed=$7,version=version+1,updated_at=now() WHERE organization_id=$1 AND installation_id=$2 RETURNING *',[actor.organizationId,installationId,data.delivered_at,data.delivered_by,data.recipient_name,data.notes,data.confirmed]):await db.query('INSERT INTO installation_deliveries(organization_id,installation_id,delivered_at,delivered_by,recipient_name,notes,confirmed,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[actor.organizationId,installationId,data.delivered_at,data.delivered_by,data.recipient_name,data.notes,data.confirmed,actor.userId]);
  await appendInstallationHistory(db,actor,installation,existing.rowCount?'delivery_updated':'delivery_recorded',`Entrega confirmada por ${data.recipient_name}.`);
  return json<InstallationDelivery>(result.rows[0]);
 });
}
