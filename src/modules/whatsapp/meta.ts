import {AccessError} from '@/modules/auth/policy';

type Json=Record<string,unknown>;
export type MetaFetcher=(input:string,init?:RequestInit)=>Promise<Response>;
export type MetaConfiguration={apiVersion:string;phoneNumberId:string;businessAccountId:string;accessToken:string};
export type MetaTemplate={id:string;name:string;language:string;category:string;status:string;components:unknown[];rejectedReason:string};
export type MetaTemplateCreateInput={name:string;language:string;category:'MARKETING'|'UTILITY';components:unknown[]};
export type MetaFlow={id:string;name:string;categories:string[];status:string;validationErrors:unknown[];jsonVersion:string;dataApiVersion:string;previewUrl:string;healthStatus:Json};
export type MetaFlowCreateInput={name:string;category:string;endpointUri?:string};
export class MetaSendError extends Error{
 constructor(public readonly kind:'rejected'|'uncertain',public readonly safeCode:string,public readonly safeTitle:string,public readonly safeDetail:string){super(safeDetail);this.name='MetaSendError';}
}
export class MetaTemplateError extends Error{
 constructor(public readonly kind:'rejected'|'uncertain',public readonly safeCode:string,public readonly safeDetail:string){super(safeDetail);this.name='MetaTemplateError';}
}
export class MetaFlowError extends Error{
 constructor(public readonly kind:'rejected'|'uncertain',public readonly safeCode:string,public readonly safeDetail:string,public readonly validationErrors:unknown[]=[]){super(safeDetail);this.name='MetaFlowError';}
}
const object=(value:unknown):Json=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Json:{};
const safe=(value:unknown,max:number)=>typeof value==='string'?value.replace(/[\r\n\t]+/g,' ').trim().slice(0,max):'';
async function body(response:Response){try{return object(await response.json());}catch{return {};}}
function endpoint(config:MetaConfiguration,path:string){const testBase=process.env.WHATSAPP_META_TEST_MODE==='true'?process.env.WHATSAPP_GRAPH_API_BASE_URL:'';if(testBase){const url=new URL(testBase);if(!['127.0.0.1','localhost'].includes(url.hostname))throw new AccessError(503,'Endpoint de teste do WhatsApp inválido.');return `${url.origin}/${encodeURIComponent(config.apiVersion)}/${path}`;}return `https://graph.facebook.com/${encodeURIComponent(config.apiVersion)}/${path}`;}
function headers(config:MetaConfiguration){return {'Authorization':`Bearer ${config.accessToken}`,'Content-Type':'application/json'};}
function mappedError(status:number,payload:Json){const error=object(payload.error),code=safe(error.code,40)||String(status),title=status===401||status===403?'Credencial do WhatsApp recusada':status===429?'Limite temporário da Meta atingido':status>=500?'Serviço da Meta indisponível':'Envio recusado pela Meta';return {code,title,detail:safe(error.message,300)||'Não foi possível enviar a mensagem pelo WhatsApp.'};}
async function flowResponse(response:Response){const payload=await body(response);if(!response.ok){const mapped=mappedError(response.status,payload),validation=Array.isArray(payload.validation_errors)?payload.validation_errors:[];throw new MetaFlowError(response.status>=500?'uncertain':'rejected',mapped.code,mapped.detail,validation);}return payload;}
export async function sendMetaMessage(config:MetaConfiguration,payload:Json,fetcher:MetaFetcher=fetch){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);let response:Response;
 try{response=await fetcher(endpoint(config,`${encodeURIComponent(config.phoneNumberId)}/messages`),{method:'POST',headers:headers(config),body:JSON.stringify(payload),signal:controller.signal,cache:'no-store'});}catch{clearTimeout(timer);throw new MetaSendError('uncertain','network_unknown','Resultado não confirmado','A conexão foi interrompida e o resultado do envio não pôde ser confirmado. Não reenvie automaticamente.');}finally{clearTimeout(timer);}
 const data=await body(response);if(!response.ok){const mapped=mappedError(response.status,data);throw new MetaSendError(response.status>=500?'uncertain':'rejected',mapped.code,mapped.title,mapped.detail);}
 const messages=Array.isArray(data.messages)?data.messages:[],wamid=safe(object(messages[0]).id,240);if(!wamid)throw new MetaSendError('uncertain','invalid_response','Resultado não confirmado','A Meta respondeu sem um identificador de mensagem. Não reenvie automaticamente.');return {wamid};
}
export async function fetchMetaTemplates(config:MetaConfiguration,fetcher:MetaFetcher=fetch){
 const url=new URL(endpoint(config,`${encodeURIComponent(config.businessAccountId)}/message_templates`));url.searchParams.set('fields','id,name,language,category,status,components,rejected_reason');url.searchParams.set('limit','250');const rows:unknown[]=[];for(let page=0;page<10;page++){const response=await fetcher(url.toString(),{headers:headers(config),cache:'no-store'}),payload=await body(response);if(!response.ok){const mapped=mappedError(response.status,payload);throw new AccessError(502,mapped.title+'.');}rows.push(...(Array.isArray(payload.data)?payload.data:[]));const after=safe(object(object(payload.paging).cursors).after,500);if(!after)break;url.searchParams.set('after',after);}return rows.map(raw=>{const item=object(raw);return {id:safe(item.id,180),name:safe(item.name,512),language:safe(item.language,35),category:safe(item.category,50),status:safe(item.status,30)||'UNKNOWN',components:Array.isArray(item.components)?item.components:[],rejectedReason:safe(item.rejected_reason,500)} satisfies MetaTemplate;}).filter(item=>item.id&&item.name&&item.language);
}
export async function createMetaTemplate(config:MetaConfiguration,input:MetaTemplateCreateInput,fetcher:MetaFetcher=fetch){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);let response:Response;
 try{response=await fetcher(endpoint(config,`${encodeURIComponent(config.businessAccountId)}/message_templates`),{method:'POST',headers:headers(config),body:JSON.stringify({name:input.name,language:input.language,category:input.category,parameter_format:'POSITIONAL',components:input.components}),signal:controller.signal,cache:'no-store'});}catch{throw new MetaTemplateError('uncertain','network_unknown','A conexão foi interrompida e a submissão não pôde ser confirmada. Sincronize os modelos antes de tentar novamente.');}finally{clearTimeout(timer);}
 const payload=await body(response);if(!response.ok){const mapped=mappedError(response.status,payload);throw new MetaTemplateError(response.status>=500?'uncertain':'rejected',mapped.code,mapped.detail);}
 const id=safe(payload.id,180),status=safe(payload.status,30)||'PENDING',category=safe(payload.category,50)||input.category;if(!id)throw new MetaTemplateError('uncertain','invalid_response','A Meta respondeu sem o identificador do modelo. Sincronize antes de tentar novamente.');return {id,status,category};
}
export async function fetchMetaFlows(config:MetaConfiguration,fetcher:MetaFetcher=fetch){
 const url=new URL(endpoint(config,`${encodeURIComponent(config.businessAccountId)}/flows`));url.searchParams.set('fields','id,name,categories,status,validation_errors,json_version,data_api_version,preview,health_status');url.searchParams.set('limit','100');const rows:unknown[]=[];
 for(let page=0;page<10;page++){const response=await fetcher(url.toString(),{headers:headers(config),cache:'no-store'}),payload=await flowResponse(response);rows.push(...(Array.isArray(payload.data)?payload.data:[]));const after=safe(object(object(payload.paging).cursors).after,500);if(!after)break;url.searchParams.set('after',after);}
 return rows.map(raw=>{const item=object(raw),preview=object(item.preview);return {id:safe(item.id,180),name:safe(item.name,200),categories:Array.isArray(item.categories)?item.categories.map(value=>safe(value,50)).filter(Boolean):[],status:safe(item.status,30)||'UNKNOWN',validationErrors:Array.isArray(item.validation_errors)?item.validation_errors:[],jsonVersion:safe(item.json_version,20),dataApiVersion:safe(item.data_api_version,20),previewUrl:safe(preview.preview_url,3000),healthStatus:object(item.health_status)} satisfies MetaFlow;}).filter(item=>item.id&&item.name);
}
export async function createMetaFlow(config:MetaConfiguration,input:MetaFlowCreateInput,fetcher:MetaFetcher=fetch){
 const form=new FormData();form.set('name',input.name);form.set('categories',JSON.stringify([input.category]));if(input.endpointUri)form.set('endpoint_uri',input.endpointUri);
 let response:Response;try{response=await fetcher(endpoint(config,`${encodeURIComponent(config.businessAccountId)}/flows`),{method:'POST',headers:{Authorization:`Bearer ${config.accessToken}`},body:form,cache:'no-store'});}catch{throw new MetaFlowError('uncertain','network_unknown','A criação do Flow não pôde ser confirmada. Sincronize antes de tentar novamente.');}
 const payload=await flowResponse(response),id=safe(payload.id,180);if(!id)throw new MetaFlowError('uncertain','invalid_response','A Meta respondeu sem o identificador do Flow. Sincronize antes de tentar novamente.');return {id};
}
export async function uploadMetaFlowJson(config:MetaConfiguration,flowId:string,definition:Json,fetcher:MetaFetcher=fetch){
 const form=new FormData();form.set('name','flow.json');form.set('asset_type','FLOW_JSON');form.set('file',new Blob([JSON.stringify(definition)],{type:'application/json'}),'flow.json');
 let response:Response;try{response=await fetcher(endpoint(config,`${encodeURIComponent(flowId)}/assets`),{method:'POST',headers:{Authorization:`Bearer ${config.accessToken}`},body:form,cache:'no-store'});}catch{throw new MetaFlowError('uncertain','network_unknown','A validação do Flow não pôde ser confirmada. Sincronize antes de tentar novamente.');}
 const payload=await flowResponse(response),validationErrors=Array.isArray(payload.validation_errors)?payload.validation_errors:[];return {success:payload.success===true,validationErrors};
}
async function mutateMetaFlow(config:MetaConfiguration,flowId:string,action:'publish'|'deprecate',fetcher:MetaFetcher){let response:Response;try{response=await fetcher(endpoint(config,`${encodeURIComponent(flowId)}/${action}`),{method:'POST',headers:headers(config),body:'{}',cache:'no-store'});}catch{throw new MetaFlowError('uncertain','network_unknown',`A operação ${action} não pôde ser confirmada. Sincronize o Flow.`);}const payload=await flowResponse(response);if(payload.success!==true)throw new MetaFlowError('uncertain','invalid_response','A Meta não confirmou a operação. Sincronize o Flow.');return {success:true};}
export async function publishMetaFlow(config:MetaConfiguration,flowId:string,fetcher:MetaFetcher=fetch){return mutateMetaFlow(config,flowId,'publish',fetcher);}
export async function deprecateMetaFlow(config:MetaConfiguration,flowId:string,fetcher:MetaFetcher=fetch){return mutateMetaFlow(config,flowId,'deprecate',fetcher);}
export async function uploadMetaMedia(config:MetaConfiguration,file:File,fetcher:MetaFetcher=fetch){
 const form=new FormData();form.set('messaging_product','whatsapp');form.set('type',file.type);form.set('file',file,file.name);
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
 let response:Response;try{response=await fetcher(endpoint(config,`${encodeURIComponent(config.phoneNumberId)}/media`),{method:'POST',headers:{Authorization:`Bearer ${config.accessToken}`},body:form,cache:'no-store',signal:controller.signal});}catch{throw new AccessError(502,'Não foi possível enviar o anexo para o WhatsApp.');}finally{clearTimeout(timer);}
 const payload=await body(response),id=safe(payload.id,240);if(!response.ok||!id)throw new AccessError(502,'Não foi possível enviar o anexo para o WhatsApp.');return id;
}
export async function fetchMetaMedia(config:MetaConfiguration,mediaId:string,range:string|null,fetcher:MetaFetcher=fetch){
 if(!/^[A-Za-z0-9._:-]{1,240}$/.test(mediaId))throw new AccessError(404,'Mídia não encontrada.');
 const metadataUrl=new URL(endpoint(config,encodeURIComponent(mediaId)));metadataUrl.searchParams.set('phone_number_id',config.phoneNumberId);
 let metadataResponse:Response;try{metadataResponse=await fetcher(metadataUrl.toString(),{headers:{Authorization:`Bearer ${config.accessToken}`},cache:'no-store'});}catch{throw new AccessError(502,'Mídia temporariamente indisponível.');}
 if(!metadataResponse.ok)throw new AccessError(404,'Mídia não está mais disponível.');
 const metadata=await body(metadataResponse),rawUrl=safe(metadata.url,3000),size=Number(metadata.file_size);
 if(!rawUrl||Number.isFinite(size)&&size>100*1024*1024)throw new AccessError(404,'Mídia não está mais disponível.');
 let url:URL;try{url=new URL(rawUrl);}catch{throw new AccessError(502,'Resposta de mídia inválida.');}
 const test=process.env.WHATSAPP_META_TEST_MODE==='true'&&['127.0.0.1','localhost'].includes(url.hostname);
 if(!(url.protocol==='https:'&&['lookaside.fbsbx.com','lookaside.facebook.com'].includes(url.hostname))&&!test)throw new AccessError(502,'Origem de mídia inválida.');
 let response:Response;try{response=await fetcher(url.toString(),{headers:{Authorization:`Bearer ${config.accessToken}`,...(range?{Range:range}:{})},cache:'no-store',redirect:'manual'});}catch{throw new AccessError(502,'Mídia temporariamente indisponível.');}
 if(response.status===404||response.status===410)throw new AccessError(404,'Mídia não está mais disponível.');
 if(!response.ok&&response.status!==206)throw new AccessError(502,'Mídia temporariamente indisponível.');
 return {response,mimeType:safe(metadata.mime_type,180)};
}
export function metaConfiguration(row:{api_version:string;phone_number_id:string;business_account_id:string}){
 const accessToken=process.env.WHATSAPP_ACCESS_TOKEN;if(!accessToken)throw new AccessError(503,'O envio pelo WhatsApp ainda não está configurado.');if(!row.api_version||!row.phone_number_id||!row.business_account_id)throw new AccessError(503,'A integração do WhatsApp está incompleta.');return {apiVersion:row.api_version,phoneNumberId:row.phone_number_id,businessAccountId:row.business_account_id,accessToken};
}
