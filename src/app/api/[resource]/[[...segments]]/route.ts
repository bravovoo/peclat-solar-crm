import { getOpportunity,saveOpportunity,moveOpportunity,listOpportunities,pipeline,opportunityFeed,addOpportunityNote,listTasks,getTask,saveTask,updateTaskStatus,settings,saveSettings,indicators,followUp } from '@/modules/commercial/repository';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiActor } from '@/server/session';
import { failure,readMultipartMutation,readMutation } from '@/server/http';
import { AccessError } from '@/modules/auth/policy';
import { csvCell,stages,uuid,type Kind } from '@/modules/crm/domain';
import { addContact,addNote,addTask,completeTask,crmOptions,dashboard,DuplicateError,exportRecords,getRecord,globalSearch,listRecords,mutateTag,recordAction,recordFeed,saveRecord } from '@/modules/crm/repository';
import { createSolarSizing,getEnergyUnit,listEnergyUnits,listSolarSizings,saveBill,saveConsumption,saveEnergyUnit,setEnergyUnitStatus } from '@/modules/energy/repository';
import { getEquipment,getKit,listEquipment,listKits,listKitSelections,saveEquipment,saveKit,selectKitForSizing,setEquipmentStatus,setKitStatus } from '@/modules/solar-catalog/repository';
import { createDocument,getDocument,getDocumentFile,listDocuments,sendDocumentEmail,setDocumentSignature,setDocumentStatus,updateDocument } from '@/modules/documents/repository';
import { MAX_PDF_BYTES } from '@/modules/documents/storage';
import { smtpProvider } from '@/integrations/mail';
import {contractAlerts,contractDashboard,contractOptions,getContractDetail,listContracts,registerPayment,saveContract,setContractStatus,updatePayment} from '@/modules/contracts/repository';
import {getInstallationDetail,installationOptions,listInstallations,saveInstallation,setInstallationStatus} from '@/modules/installations/repository';
import {addInstallationFile,deleteInstallationFile,getInstallationFile,saveInstallationDelivery,saveInstallationIssue,updateChecklistItem} from '@/modules/installations/execution';
import {MAX_INSTALLATION_FILE_BYTES} from '@/modules/installations/file-storage';
type Context={params:Promise<{resource:string;segments?:string[]}>};
const resources:Record<string,Kind>={leads:'lead',customers:'customer',companies:'company'};
const respond=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}});
async function handle(request:Request,context:Context){
 try{
  const actor=await apiActor();const {resource,segments=[]}=await context.params;const [id,action]=segments;
  if(segments.length>2)throw new AccessError(404,'Não encontrado.');
  const url=new URL(request.url);const query=Object.fromEntries(url.searchParams);const kind=resources[resource];
  if(request.method==='GET'){
   if(resource==='installation-files'&&id&&action==='file'){
    const {file,bytes}=await getInstallationFile(actor,id);const filename=file.original_filename.replace(/[^a-zA-Z0-9._-]/g,'_');
    const disposition=file.kind==='photo'&&query.download!=='1'?'inline':'attachment';
    return new NextResponse(new Uint8Array(bytes),{headers:{'Content-Type':file.mime_type,'Content-Length':String(bytes.length),'Content-Disposition':`${disposition}; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(file.original_filename)}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
   }
   if(resource==='installations'){if(action)throw new AccessError(404,'Não encontrado.');return respond(id?await getInstallationDetail(actor,id):await listInstallations(actor,query));}
   if(resource==='installation-options'&&!id)return respond(await installationOptions(actor));
   if(resource==='contracts'){if(action)throw new AccessError(404,'Não encontrado.');return respond(id?await getContractDetail(actor,id):await listContracts(actor,query));}
   if(resource==='contract-dashboard'&&!id)return respond(await contractDashboard(actor));
   if(resource==='contract-alerts'&&!id)return respond(await contractAlerts(actor,query));
   if(resource==='contract-options'&&!id)return respond(await contractOptions(actor));
   if(resource==='documents'){
    if(id&&action==='file'){const {document,bytes}=await getDocumentFile(actor,id);const fallback=document.original_filename.replace(/[^a-zA-Z0-9._-]/g,'_');return new NextResponse(new Uint8Array(bytes),{headers:{'Content-Type':'application/pdf','Content-Length':String(bytes.length),'Content-Disposition':`attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(document.original_filename)}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});}
    if(action)throw new AccessError(404,'Não encontrado.');return respond(id?await getDocument(actor,id):await listDocuments(actor,query));
   }
   if(resource==='solar-equipment'){if(action)throw new AccessError(404,'Não encontrado.');return respond(id?await getEquipment(actor,id):await listEquipment(actor,query));}
   if(resource==='solar-kits'){if(action)throw new AccessError(404,'Não encontrado.');return respond(id?await getKit(actor,id):await listKits(actor,query));}
   if(resource==='solar-kit-selections'&&!id)return respond(await listKitSelections(actor,uuid.parse(query.sizing_id)));
   if(resource==='solar-sizings'&&!id)return respond(await listSolarSizings(actor,uuid.parse(query.consumer_unit_id)));
   if(resource==='energy-units'){
    if(action)throw new AccessError(404,'Não encontrado.');
    return respond(id?await getEnergyUnit(actor,id):await listEnergyUnits(actor,uuid.parse(query.customer_id)));
   }
   if(resource==='opportunities'){
    if(id&&action==='activities'||id&&action==='notes')return respond(await opportunityFeed(actor,id,action as 'activities'|'notes',z.coerce.number().int().min(1).parse(query.page??1)));
    if(action)throw new AccessError(404,'Não encontrado.');
    return respond(id?await getOpportunity(actor,id):await listOpportunities(actor,query));
   }
   if(resource==='tasks'){if(action)throw new AccessError(404,'Não encontrado.');return respond(id?await getTask(actor,id):await listTasks(actor,query));}
   if(resource==='pipeline'&&!id)return respond(await pipeline(actor,query));
   if(resource==='commercial-settings'&&!id)return respond(await settings(actor));
   if(resource==='commercial-indicators'&&!id)return respond(await indicators(actor,query));
   if(resource==='follow-up'&&!id)return respond(await followUp(actor,query.demo==='demo'));

   if(kind){
    if(id==='export'){
     const records=await exportRecords(actor,kind,query);
     const rows=[['Nome','Tipo','CPF/CNPJ','Telefone','WhatsApp','E-mail','Cidade','UF','Origem','Estágio','Responsável','Valor potencial','Tags'],...records.map(r=>[r.name,r.person_type,r.document,r.phone,r.whatsapp,r.email,r.city,r.state,r.source,stages[r.stage],r.owner_name,r.potential_value,r.tags.map(t=>t.name).join(', ')])];
     return new NextResponse('\uFEFF'+rows.map(row=>row.map(csvCell).join(';')).join('\r\n'),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="peclat-${resource}.csv"`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
    }
    if(id){const record=await getRecord(actor,id);if(record.kind!==kind||action)throw new AccessError(404,'Cadastro não encontrado.');return respond(record);}
    return respond(await listRecords(actor,kind,query));
   }
   if(id)throw new AccessError(404,'Não encontrado.');
   if(resource==='crm-options')return respond(await crmOptions(actor));
   if(resource==='tags')return respond((await crmOptions(actor)).tags);
   if(resource==='search'){const q=z.string().max(120).parse(query.q??'');const result=await globalSearch(actor,q);return respond({...result,opportunities:q.trim().length<2?[]:(await listOpportunities(actor,{q,pageSize:8,demo:'all'})).items.map(o=>({id:o.id,name:o.title,kind:'opportunity'}))});}
   if(resource==='dashboard')return respond(await dashboard(actor));
   if(['activities','notes','contacts','tasks'].includes(resource))return respond(await recordFeed(actor,uuid.parse(query.record_id),resource as 'activities'|'notes'|'contacts'|'tasks',z.coerce.number().int().min(1).max(100000).parse(query.page??1)));
  }else{
   if(resource==='installation-files'&&request.method==='POST'&&!id){
    const form=await readMultipartMutation(request,MAX_INSTALLATION_FILE_BYTES+131072),file=form.get('file');
    if(!(file instanceof File))throw new AccessError(400,'Selecione um arquivo.');
    const metadata=Object.fromEntries(['installation_id','kind','name','description','category'].map(key=>[key,String(form.get(key)??'')]));
    return respond(await addInstallationFile(actor,metadata,{name:file.name,type:file.type,bytes:new Uint8Array(await file.arrayBuffer())}),201);
   }
   if(resource==='installation-checklist'&&request.method==='PUT'&&id&&!action)return respond(await updateChecklistItem(actor,id,await readMutation(request)));
   if(resource==='installation-issues'&&request.method==='POST'&&!id)return respond(await saveInstallationIssue(actor,await readMutation(request)),201);
   if(resource==='installation-issues'&&request.method==='PUT'&&id&&!action)return respond(await saveInstallationIssue(actor,await readMutation(request),id));
   if(resource==='installation-files'&&request.method==='DELETE'&&id&&!action){const body=z.object({version:z.number().int().positive()}).strict().parse(await readMutation(request));return respond(await deleteInstallationFile(actor,id,body.version));}
   if(resource==='installations'){
    const body=await readMutation(request);
    if(request.method==='POST'&&!id)return respond(await saveInstallation(actor,body),201);
    if(request.method==='PUT'&&id&&!action)return respond(await saveInstallation(actor,body,id));
    if(request.method==='POST'&&id&&action==='status')return respond(await setInstallationStatus(actor,id,body));
    if(request.method==='POST'&&id&&action==='delivery')return respond(await saveInstallationDelivery(actor,id,body),201);
   }
   if(resource==='contracts'){
    const body=await readMutation(request);
    if(request.method==='POST'&&!id)return respond(await saveContract(actor,body),201);
    if(request.method==='PUT'&&id&&!action)return respond(await saveContract(actor,body,id));
    if(request.method==='POST'&&id&&action==='status')return respond(await setContractStatus(actor,id,body));
    if(request.method==='POST'&&id&&action==='payments')return respond(await registerPayment(actor,id,body),201);
   }
   if(resource==='contract-payments'&&request.method==='PUT'&&id&&!action)return respond(await updatePayment(actor,id,await readMutation(request)));
   if(resource==='documents'&&request.method==='POST'&&!id){const form=await readMultipartMutation(request,MAX_PDF_BYTES+131072);const file=form.get('file');if(!(file instanceof File))throw new AccessError(400,'Selecione o arquivo PDF.');const metadata=Object.fromEntries(['customer_id','opportunity_id','contract_id','document_type','name','budget_value','valid_until','notes'].map(key=>[key,String(form.get(key)??'')]));return respond(await createDocument(actor,metadata,{name:file.name,type:file.type,bytes:new Uint8Array(await file.arrayBuffer())}),201);}
   const body=await readMutation(request);
   if(resource==='documents'){
    if(request.method==='PUT'&&id&&!action)return respond(await updateDocument(actor,id,body));
    if(request.method==='POST'&&id&&action==='status'){const parsed=z.object({status:z.string(),version:z.number().int().positive()}).strict().parse(body);return respond(await setDocumentStatus(actor,id,parsed.status,parsed.version));}
    if(request.method==='POST'&&id&&action==='signature')return respond(await setDocumentSignature(actor,id,body));
    if(request.method==='POST'&&id&&action==='email')return respond(await sendDocumentEmail(actor,id,body,smtpProvider()),201);
   }
   if(resource==='solar-equipment'){
    if(request.method==='POST'&&!id)return respond(await saveEquipment(actor,body),201);
    if(request.method==='PUT'&&id&&!action)return respond(await saveEquipment(actor,body,id));
    if(request.method==='POST'&&id&&['archive','restore'].includes(action)){const parsed=z.object({version:z.number().int().positive()}).strict().parse(body);return respond(await setEquipmentStatus(actor,id,action==='archive'?'archived':'active',parsed.version));}
   }
   if(resource==='solar-kits'){
    if(request.method==='POST'&&!id)return respond(await saveKit(actor,body),201);
    if(request.method==='PUT'&&id&&!action)return respond(await saveKit(actor,body,id));
    if(request.method==='POST'&&id&&['archive','restore'].includes(action)){const parsed=z.object({version:z.number().int().positive()}).strict().parse(body);return respond(await setKitStatus(actor,id,action==='archive'?'archived':'active',parsed.version));}
   }
   if(resource==='solar-kit-selections'&&request.method==='POST'&&!id)return respond(await selectKitForSizing(actor,body),201);
   if(resource==='solar-sizings'&&request.method==='POST'&&!id)return respond(await createSolarSizing(actor,body),201);
   if(resource==='energy-units'){
    if(request.method==='POST'&&!id)return respond(await saveEnergyUnit(actor,body),201);
    if(request.method==='PUT'&&id&&!action)return respond(await saveEnergyUnit(actor,body,id));
    if(request.method==='POST'&&id&&['archive','restore'].includes(action)){const parsed=z.object({version:z.number().int().positive()}).strict().parse(body);return respond(await setEnergyUnitStatus(actor,id,action==='archive'?'archived':'active',parsed.version));}
   }
   if(resource==='energy-consumptions'){
    if(request.method==='POST'&&!id)return respond(await saveConsumption(actor,body),201);
    if(request.method==='PUT'&&id&&!action)return respond(await saveConsumption(actor,body,id));
   }
   if(resource==='energy-bills'){
    if(request.method==='POST'&&!id)return respond(await saveBill(actor,body),201);
    if(request.method==='PUT'&&id&&!action)return respond(await saveBill(actor,body,id));
   }
   if(resource==='opportunities'){
    if(request.method==='POST'&&!id)return respond(await saveOpportunity(actor,body),201);
    if(request.method==='PUT'&&id&&!action)return respond(await saveOpportunity(actor,body,id));
    if(request.method==='POST'&&id&&['stage','win','lose'].includes(action)){const movement=action==='stage'?body:{...z.record(z.string(),z.unknown()).parse(body),stage:action==='win'?'won':'lost'};return respond(await moveOpportunity(actor,id,movement));}
    if(request.method==='POST'&&id&&action==='notes')return respond(await addOpportunityNote(actor,{...z.object({body:z.string()}).strict().parse(body),opportunity_id:id}),201);
   }
   if(resource==='commercial-settings'&&request.method==='PUT'&&!id)return respond(await saveSettings(actor,body));
   if(resource==='tasks'&&request.method==='PUT'&&id&&!action)return respond(await saveTask(actor,body,id));
   if(resource==='tasks'&&request.method==='POST'&&id&&action==='status')return respond(await updateTaskStatus(actor,id,body));

   if(kind){
    if(request.method==='POST'&&!id)return respond(await saveRecord(actor,kind,body),201);
    if(id){const record=await getRecord(actor,id);if(record.kind!==kind)throw new AccessError(404,'Cadastro não encontrado.');
     if(request.method==='PUT'&&!action)return respond(await saveRecord(actor,kind,body,id));
     if(request.method==='DELETE'&&!action){const {version}=z.object({version:z.number().int().positive()}).strict().parse(body);return respond(await recordAction(actor,id,'delete',version));}
     if(request.method==='POST'&&['archive','restore','convert'].includes(action)){const {version}=z.object({version:z.number().int().positive()}).strict().parse(body);return respond(await recordAction(actor,id,action as 'archive'|'restore'|'convert',version));}
    }
   }
   if(resource==='tags'&&!action){if(request.method==='POST'&&!id)return respond(await mutateTag(actor,body),201);if(request.method==='PUT'&&id)return respond(await mutateTag(actor,body,id));if(request.method==='DELETE'&&id)return respond(await mutateTag(actor,body,id,true));}
   if(request.method==='POST'&&!id){if(resource==='notes')return respond(await addNote(actor,body),201);if(resource==='contacts')return respond(await addContact(actor,body),201);if(resource==='tasks')return respond(await addTask(actor,body),201);}
   if(resource==='tasks'&&id&&action==='complete'&&request.method==='POST')return respond(await completeTask(actor,id));
  }
  throw new AccessError(404,'Endpoint não encontrado.');
 }catch(error){if(error instanceof DuplicateError)return respond({error:error.message,matches:error.matches,canOverride:error.canOverride},409);if((error as {code?:string})?.code==='22P05')return respond({error:'O banco local não suporta um dos caracteres informados. Remova emojis ou caracteres especiais e tente novamente.'},422);return failure(error);}
}
export const GET=handle;export const POST=handle;export const PUT=handle;export const DELETE=handle;
