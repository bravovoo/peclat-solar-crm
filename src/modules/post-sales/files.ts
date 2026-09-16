import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {database,transaction} from '@/server/db';
import {AccessError,requirePermission,type Actor} from '@/modules/auth/policy';
import {loadInstallationFile,removeInstallationFile,storeInstallationFile,validateInstallationFile} from '@/modules/installations/file-storage';
import {fileSchema,type PostSalesFile} from './domain';
import {getMaintenance,getTicket,getWarranty} from './repository';
import {uuid} from '@/modules/crm/domain';

type Db=Pick<PoolClient,'query'>;
type Parent='warranty'|'ticket'|'maintenance';
const column={warranty:'warranty_id',ticket:'ticket_id',maintenance:'maintenance_id'} as const;
const json=<T>(value:unknown):T=>JSON.parse(JSON.stringify(value)) as T;
async function parent(actor:Actor,type:Parent,id:string,db:Db){
 if(type==='warranty'){const item=await getWarranty(actor,id,db);return {clientId:item.client_id,number:item.description};}
 if(type==='ticket'){const item=await getTicket(actor,id,db);return {clientId:item.client_id,number:item.ticket_number};}
 const item=await getMaintenance(actor,id,db);return {clientId:item.client_id,number:item.reason};
}
async function history(db:Db,actor:Actor,type:Parent,id:string,clientId:string,action:string,detail:string){
 if(type==='ticket')await db.query('INSERT INTO post_sales_ticket_history(organization_id,ticket_id,actor_id,action,detail) VALUES ($1,$2,$3,$4,$5)',[actor.organizationId,id,actor.userId,action,detail]);
 await db.query('INSERT INTO crm_activities(organization_id,record_id,actor_id,action,detail) VALUES ($1,$2,$3,$4,$5)',[actor.organizationId,clientId,actor.userId,`post_sales.${action}`,detail]);
}
export async function addPostSalesFile(actor:Actor,input:unknown,file:{name:string;type:string;bytes:Uint8Array}){
 requirePermission(actor,'post_sales.edit');const data=fileSchema.parse(input),checked=validateInstallationFile(file.name,file.type,file.bytes,'document');
 await parent(actor,data.parent_type,data.parent_id,database());
 const id=randomUUID(),key=`${actor.organizationId}/post-sales/${data.parent_type}/${data.parent_id}/${id}.${checked.extension}`;
 await storeInstallationFile(key,file.bytes,checked.mimeType);
 try{return await transaction(async db=>{
  const related=await parent(actor,data.parent_type,data.parent_id,db);
  const result=await db.query(`INSERT INTO post_sales_files(id,organization_id,${column[data.parent_type]},name,description,category,original_filename,mime_type,file_size,content_sha256,storage_key,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id,warranty_id,ticket_id,maintenance_id,name,description,category,original_filename,mime_type,file_size,version,created_at`,[id,actor.organizationId,data.parent_id,data.name,data.description,data.category,checked.filename,checked.mimeType,file.bytes.length,checked.sha256,key,actor.userId]);
  await history(db,actor,data.parent_type,data.parent_id,related.clientId,'file_added',`${related.number} · ${data.name} anexado.`);
  return json<PostSalesFile>({...result.rows[0],created_by_name:actor.name});
 });}catch(error){await removeInstallationFile(key).catch(()=>{});throw error;}
}
async function fileRow(actor:Actor,id:string,db:Db,lock=false){uuid.parse(id);const result=await db.query(`SELECT * FROM post_sales_files WHERE organization_id=$1 AND id=$2 AND deleted_at IS NULL${lock?' FOR UPDATE':''}`,[actor.organizationId,id]);if(!result.rowCount)throw new AccessError(404,'Anexo não encontrado.');const file=result.rows[0] as {id:string;warranty_id:string|null;ticket_id:string|null;maintenance_id:string|null;storage_key:string;content_sha256:string;original_filename:string;mime_type:string;name:string;version:number};const type:Parent=file.warranty_id?'warranty':file.ticket_id?'ticket':'maintenance';const parentId=(file.warranty_id??file.ticket_id??file.maintenance_id)!;const related=await parent(actor,type,parentId,db);return {file,type,parentId,related};}
export async function getPostSalesFile(actor:Actor,id:string){requirePermission(actor,'post_sales.read');const {file}=await fileRow(actor,id,database());return {file,bytes:await loadInstallationFile(file.storage_key,file.content_sha256)};}
export async function listPostSalesFiles(actor:Actor,type:Parent,id:string){requirePermission(actor,'post_sales.read');await parent(actor,type,id,database());const result=await database().query(`SELECT f.id,f.warranty_id,f.ticket_id,f.maintenance_id,f.name,f.description,f.category,f.original_filename,f.mime_type,f.file_size,f.version,f.created_at,u.name created_by_name FROM post_sales_files f JOIN users u ON u.id=f.created_by WHERE f.organization_id=$1 AND f.${column[type]}=$2 AND f.deleted_at IS NULL ORDER BY f.created_at DESC,f.id DESC`,[actor.organizationId,id]);return json<PostSalesFile[]>(result.rows);}
export async function deletePostSalesFile(actor:Actor,id:string,version:unknown){requirePermission(actor,'post_sales.manage');const expected=Number(version);if(!Number.isInteger(expected)||expected<1)throw new AccessError(400,'Versão inválida.');const key=await transaction(async db=>{const {file,type,parentId,related}=await fileRow(actor,id,db,true);if(file.version!==expected)throw new AccessError(409,'Anexo atualizado por outra pessoa. Recarregue.');await db.query('UPDATE post_sales_files SET deleted_at=now(),deleted_by=$3,version=version+1,updated_at=now() WHERE organization_id=$1 AND id=$2',[actor.organizationId,id,actor.userId]);await history(db,actor,type,parentId,related.clientId,'file_removed',`${related.number} · ${file.name} removido.`);return file.storage_key;});await removeInstallationFile(key);return {removed:true};}
