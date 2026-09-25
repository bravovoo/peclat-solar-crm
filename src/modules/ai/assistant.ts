import {database,transaction} from '@/server/db';
import {AccessError,requirePermission,type Actor} from '@/modules/auth/policy';
import {commercialScope,commercialScopeParams} from '@/modules/commercial/scope';
import {assertWhatsAppConversation} from '@/modules/whatsapp/inbox';
import {aiSettingsInput,commercialAiRequest,type CommercialAiAction,type CommercialAiContext,type CommercialAiOutput} from './domain';
import {AiProviderError,aiProviderConfigured,configuredAiProvider,type CommercialAiProvider} from './provider';

type Setting={enabled:boolean;provider:'gemini'|'openai';model:string;context_message_limit:number;max_requests_per_hour:number;version:number;updated_at:string};
export const commercialAiProviderTimeoutMs=30_000;
const defaults={enabled:false,provider:'gemini',model:'gemini-3.5-flash-lite',context_message_limit:40,max_requests_per_hour:60,version:null as number|null,updated_at:null as string|null};
export async function aiAssistantSettings(actor:Actor){
 requirePermission(actor,'ai_assistant.use');
 const row=(await database().query<Setting>('SELECT enabled,provider,model,context_message_limit,max_requests_per_hour,version,updated_at FROM ai_assistant_settings WHERE organization_id=$1',[actor.organizationId])).rows[0];
 const settings=row??defaults;return {...settings,configured:aiProviderConfigured(settings.provider),configured_providers:{gemini:aiProviderConfigured('gemini'),openai:aiProviderConfigured('openai')},can_manage:actor.permissions.includes('ai_assistant.manage')};
}
export async function saveAiAssistantSettings(actor:Actor,input:unknown){
 requirePermission(actor,'ai_assistant.manage');const data=aiSettingsInput.parse(input);
 await transaction(async db=>{const current=(await db.query<{version:number}>('SELECT version FROM ai_assistant_settings WHERE organization_id=$1 FOR UPDATE',[actor.organizationId])).rows[0];
  if(current&&data.version!==Number(current.version))throw new AccessError(409,'A configuração foi atualizada. Recarregue a página.');
  if(!current&&data.version!==null)throw new AccessError(409,'A configuração foi atualizada. Recarregue a página.');
  if(current)await db.query('UPDATE ai_assistant_settings SET enabled=$2,provider=$3,model=$4,context_message_limit=$5,max_requests_per_hour=$6,updated_by=$7,version=version+1,updated_at=now() WHERE organization_id=$1',[actor.organizationId,data.enabled,data.provider,data.model,data.context_message_limit,data.max_requests_per_hour,actor.userId]);
  else await db.query('INSERT INTO ai_assistant_settings(organization_id,enabled,provider,model,context_message_limit,max_requests_per_hour,updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7)',[actor.organizationId,data.enabled,data.provider,data.model,data.context_message_limit,data.max_requests_per_hour,actor.userId]);
  await db.query('INSERT INTO audit_logs(organization_id,actor_id,action,detail) VALUES ($1,$2,$3,$4)',[actor.organizationId,actor.userId,'ai_assistant.settings_updated',`Assistente ${data.enabled?'ativado':'desativado'}; provedor ${data.provider}; limite ${data.max_requests_per_hour}/h.`]);
 });return aiAssistantSettings(actor);
}

function minimizeContextText(value:string){return value.replace(/https?:\/\/\S+|www\.\S+/gi,'[URL removida]').replace(/\b\d{2}\.?\d{3}\.?\d{3}\/\d{4}-?\d{2}\b/g,'[CNPJ removido]').replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g,'[CPF removido]').replace(/(?:\+?55[\s.-]*)?(?:\(?\d{2}\)?[\s.-]*)?9?\d{4}[\s.-]*\d{4}\b/g,'[telefone removido]').replace(/\b[^\s@]+@[^\s@]+\.[^\s@]+\b/g,'[e-mail removido]');}
function messageContent(row:{message_type:string;text_body:string;caption:string}){
 if(row.message_type==='text'||row.message_type==='template')return minimizeContextText(row.text_body.slice(0,4096));
 const labels:Record<string,string>={audio:'Áudio recebido',image:'Imagem recebida',document:'Documento recebido',video:'Vídeo recebido',sticker:'Figurinha recebida',location:'Localização recebida',contacts:'Contato recebido'};
 return `${labels[row.message_type]??'Conteúdo recebido'}${row.caption?`: ${minimizeContextText(row.caption.slice(0,1000))}`:''}`;
}
export async function buildCommercialAiContext(actor:Actor,conversationId:string,limit:number):Promise<CommercialAiContext>{
 const conversation=await assertWhatsAppConversation(actor,conversationId),recordId=conversation.record_id as string|null;
 const messages=await database().query<{direction:'inbound'|'outbound';message_type:string;text_body:string;caption:string;meta_timestamp:string}>(`SELECT direction,message_type,text_body,caption,meta_timestamp FROM (SELECT id,direction,message_type,text_body,caption,meta_timestamp FROM whatsapp_messages WHERE organization_id=$1 AND conversation_id=$2 ORDER BY meta_timestamp DESC,id DESC LIMIT $3) recent ORDER BY meta_timestamp,id`,[actor.organizationId,conversationId,limit]);
 let contact={name:String(conversation.record_name||conversation.profile_name||'Contato não identificado'),kind:String(conversation.record_kind||'unidentified'),source:'',tags:[] as string[],responsible:''};
 const commercial={stage:'',opportunity:'',proposal:null as CommercialAiContext['commercial']['proposal'],openTasks:[] as CommercialAiContext['commercial']['openTasks']};
 let solar:CommercialAiContext['solar']=null;
 if(recordId){
  const record=(await database().query<{kind:string;name:string;source:string;stage:string;average_consumption:string;property_type:string;roof_type:string;owner_name:string;tags:string[]}>(`SELECT r.kind,r.name,r.source,r.stage,COALESCE(r.average_consumption::text,'') average_consumption,r.property_type,r.roof_type,u.name owner_name,COALESCE(array_agg(DISTINCT t.name) FILTER(WHERE t.id IS NOT NULL),'{}') tags FROM crm_records r JOIN users u ON u.id=r.owner_id LEFT JOIN crm_record_tags rt ON rt.organization_id=r.organization_id AND rt.record_id=r.id LEFT JOIN crm_tags t ON t.organization_id=rt.organization_id AND t.id=rt.tag_id WHERE r.organization_id=$1 AND r.id=$2 GROUP BY r.id,u.name`,[actor.organizationId,recordId])).rows[0];
  if(record)contact={name:record.name,kind:record.kind,source:record.source,tags:record.tags,responsible:record.owner_name};
  const opParams=commercialScopeParams(actor);opParams.push(recordId);
  const opportunity=(await database().query<{id:string;title:string;stage:string}>(`SELECT o.id,o.title,o.stage FROM crm_opportunities o WHERE ${commercialScope(actor,'o')} AND (o.lead_id=$${opParams.length} OR o.customer_id=$${opParams.length} OR o.company_id=$${opParams.length}) ORDER BY (o.status='open') DESC,o.updated_at DESC LIMIT 1`,opParams)).rows[0];
  commercial.stage=opportunity?.stage||record?.stage||'';commercial.opportunity=opportunity?.title||'';
  const tasks=await database().query<{title:string;due_date:string;status:string}>('SELECT title,due_date::text,status FROM crm_tasks WHERE organization_id=$1 AND status IN ($3,$4) AND (record_id=$2 OR opportunity_id=$5::uuid) ORDER BY due_date LIMIT 10',[actor.organizationId,recordId,'pending','in_progress',opportunity?.id??null]);
  commercial.openTasks=tasks.rows.map(task=>({title:task.title,dueDate:task.due_date,status:task.status}));
  if(opportunity){const proposal=(await database().query<{name:string;budget_value:string;valid_until:string;status:string}>('SELECT name,budget_value::text,valid_until::text,status FROM crm_documents WHERE organization_id=$1 AND opportunity_id=$2 ORDER BY created_at DESC LIMIT 1',[actor.organizationId,opportunity.id])).rows[0];if(proposal)commercial.proposal={name:proposal.name,value:proposal.budget_value,validUntil:proposal.valid_until,status:proposal.status};}
  if(record?.kind==='customer'){
   const sizing=(await database().query<{system_power_kwp:string;module_count:number;estimated_monthly_generation_kwh:string}>('SELECT system_power_kwp::text,module_count,estimated_monthly_generation_kwh::text FROM solar_sizings WHERE organization_id=$1 AND customer_id=$2 ORDER BY created_at DESC LIMIT 1',[actor.organizationId,recordId])).rows[0];
   solar={averageConsumptionKwh:record.average_consumption,propertyType:record.property_type,roofType:record.roof_type,sizing:sizing?{systemPowerKwp:sizing.system_power_kwp,moduleCount:Number(sizing.module_count),estimatedMonthlyGenerationKwh:sizing.estimated_monthly_generation_kwh}:null};
  }
 }
 return {contact,conversation:{messages:messages.rows.map(row=>({direction:row.direction==='inbound'?'customer':'team',at:row.meta_timestamp,content:messageContent(row)})),messageCount:messages.rowCount??messages.rows.length},commercial,solar};
}

async function reserveUsage(actor:Actor,conversationId:string|null,requestId:string,action:string,setting:Setting){
 return transaction(async db=>{await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${actor.organizationId}:${actor.userId}:ai`]);
  const count=Number((await db.query<{total:number}>("SELECT count(*)::int total FROM ai_usage_events WHERE organization_id=$1 AND user_id=$2 AND created_at>now()-interval '1 hour'",[actor.organizationId,actor.userId])).rows[0].total);
  if(count>=setting.max_requests_per_hour)throw new AccessError(429,'Limite temporário do assistente atingido. Tente novamente mais tarde.');
  try{return (await db.query<{id:string}>('INSERT INTO ai_usage_events(organization_id,user_id,conversation_id,request_id,action,provider,model) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',[actor.organizationId,actor.userId,conversationId,requestId,action,setting.provider,setting.model])).rows[0].id;}catch(error){if((error as {code?:string}).code==='23505')throw new AccessError(409,'Esta solicitação já está sendo processada.');throw error;}
 });
}
function outputForAction(output:CommercialAiOutput,action:CommercialAiAction):CommercialAiOutput{
 const selected:Partial<CommercialAiOutput>=action==='summarize'?{summary:output.summary,intent:output.intent,objections:output.objections}
  :action==='missing_information'?{missingInformation:output.missingInformation}
  :action==='next_action'?{nextAction:output.nextAction,suggestedQuestion:output.suggestedQuestion}
  :action==='suggest_reply'?{suggestedReply:output.suggestedReply}
  :action==='follow_up'?{followUp:output.followUp}
  :{closingSupport:output.closingSupport};
 return {summary:'',intent:'',objections:[],missingInformation:[],nextAction:'',suggestedQuestion:'',suggestedReply:'',followUp:'',closingSupport:'',...selected};
}
function amountInCents(raw:string){
 const value=raw.replace(/[^\d.,]/g,'').replace(/[.,]$/,'');
 const lastComma=value.lastIndexOf(','),lastDot=value.lastIndexOf('.');
 const decimal=lastComma>=0?lastComma:lastDot>=0&&value.length-lastDot-1!==3?lastDot:-1;
 const whole=(decimal<0?value:value.slice(0,decimal)).replace(/[.,]/g,'');
 const fraction=decimal<0?'':value.slice(decimal+1).replace(/[.,]/g,'');
 return Number(whole)*100+Number((fraction+'00').slice(0,2));
}
function priceMentions(text:string){
 const mentions:{amount:number;start:number}[]=[];
 const pattern=/(?:R\$\s*|\b(?:valor|preço|custa|custaria|projeto por)\b\D{0,20})(\d[\d.,]*)/gi;
 for(const match of text.matchAll(pattern))mentions.push({amount:amountInCents(match[1]),start:match.index});
 return mentions;
}
function energyMentions(text:string){
 const mentions:{fact:string;start:number}[]=[];
 const pattern=/(\d[\d.,]*)\s*(kwh|kwp|placas?|painel|painéis|módulos?)/gi;
 for(const match of text.matchAll(pattern)){
  const unit=match[2].toLocaleLowerCase('pt-BR');
  const kind=unit==='kwh'||unit==='kwp'?unit:'modules';
  mentions.push({fact:`${kind}:${amountInCents(match[1])}`,start:match.index});
 }
 return mentions;
}
function assertGrounded(output:CommercialAiOutput,context:CommercialAiContext){
 const text=Object.values(output).flat().join(' ');
 const knownPrices=new Set(context.conversation.messages.filter(message=>message.direction==='team').flatMap(message=>priceMentions(message.content).map(mention=>mention.amount)));
 if(context.commercial.proposal)knownPrices.add(amountInCents(context.commercial.proposal.value));
 for(const mention of priceMentions(text)){
  const near=text.slice(Math.max(0,mention.start-100),mention.start+100);
  if(!knownPrices.has(mention.amount)||!context.commercial.proposal&&!/mencion|inform|citad|convers|mensagem/i.test(near))throw new AiProviderError('ungrounded_output');
 }
 const knownEnergy=new Set(context.conversation.messages.flatMap(message=>energyMentions(message.content).map(mention=>mention.fact)));
 const structuredEnergy=new Set<string>();
 if(context.solar){
  if(context.solar.averageConsumptionKwh)structuredEnergy.add(`kwh:${amountInCents(context.solar.averageConsumptionKwh)}`);
  if(context.solar.sizing){structuredEnergy.add(`kwp:${amountInCents(context.solar.sizing.systemPowerKwp)}`);structuredEnergy.add(`modules:${amountInCents(String(context.solar.sizing.moduleCount))}`);structuredEnergy.add(`kwh:${amountInCents(context.solar.sizing.estimatedMonthlyGenerationKwh)}`);}
 }
 for(const mention of energyMentions(text)){
  const near=text.slice(Math.max(0,mention.start-100),mention.start+100);
  if(!knownEnergy.has(mention.fact)&&!structuredEnergy.has(mention.fact)||!structuredEnergy.has(mention.fact)&&!/cliente|equipe|convers|inform|mencion|citad|históric|estim/i.test(near))throw new AiProviderError('ungrounded_output');
 }
 if(/(?:garantia|prazo)\s+(?:(?:é|foi|será)\s+)?(?:de\s+)?\d/i.test(text)||/economia\D{0,20}(?:R\$|\d+\s*%)/i.test(text))throw new AiProviderError('ungrounded_output');
}
function assertRewriteGrounded(suggestion:string,draft:string){
 if(!suggestion.trim())throw new AiProviderError('invalid_schema');
 const numbers=new Set(draft.match(/\d[\d.,]*/g)??[]);
 if((suggestion.match(/\d[\d.,]*/g)??[]).some(value=>!numbers.has(value)))throw new AiProviderError('ungrounded_output');
 for(const term of ['desconto','garantia','economia','parcelamento','gratuito'])if(suggestion.toLocaleLowerCase('pt-BR').includes(term)&&!draft.toLocaleLowerCase('pt-BR').includes(term))throw new AiProviderError('ungrounded_output');
}
const emptyContext:CommercialAiContext={contact:{name:'',kind:'unidentified',source:'',tags:[],responsible:''},conversation:{messages:[],messageCount:0},commercial:{stage:'',opportunity:'',proposal:null,openTasks:[]},solar:null};
export async function runCommercialAi(actor:Actor,input:unknown,provider?:CommercialAiProvider){
 requirePermission(actor,'ai_assistant.use');const data=commercialAiRequest.parse(input);const setting=(await database().query<Setting>('SELECT enabled,provider,model,context_message_limit,max_requests_per_hour,version,updated_at FROM ai_assistant_settings WHERE organization_id=$1',[actor.organizationId])).rows[0];
 if(!setting?.enabled)throw new AccessError(503,'Assistente de IA ainda não configurado.');
 if(data.conversation_id)await assertWhatsAppConversation(actor,data.conversation_id);const eventId=await reserveUsage(actor,data.conversation_id??null,data.request_id,data.action,setting),started=Date.now();
 try{const context=data.conversation_id?await buildCommercialAiContext(actor,data.conversation_id,setting.context_message_limit):emptyContext,generator=provider??configuredAiProvider(setting.provider,setting.model);
  const generationInput={action:data.action,context,signal:AbortSignal.timeout(commercialAiProviderTimeoutMs),...(data.action==='rewrite_message'?{draft:data.draft,previousSuggestion:data.previous_suggestion}: {})};
  let result=await generator.generate(generationInput),output=data.action==='rewrite_message'?result.output:outputForAction(result.output,data.action);
  try{if(data.action==='rewrite_message')assertRewriteGrounded(output.suggestedReply,data.draft);else assertGrounded(output,context);}
  catch(error){if(!(error instanceof AiProviderError)||error.code!=='ungrounded_output'||data.action==='rewrite_message')throw error;
   result=await generator.generate({...generationInput,safetyRetry:true});output=outputForAction(result.output,data.action);assertGrounded(output,context);
  }
  await database().query("UPDATE ai_usage_events SET status='succeeded',duration_ms=$3,input_tokens=$4,output_tokens=$5,provider=$6,model=$7,finished_at=now() WHERE organization_id=$1 AND id=$2",[actor.organizationId,eventId,Date.now()-started,result.inputTokens??null,result.outputTokens??null,result.provider,result.model]);return output;
 }catch(error){const code=error instanceof AiProviderError?error.code:error instanceof DOMException&&error.name==='TimeoutError'?'timeout':'provider_failure';await database().query("UPDATE ai_usage_events SET status='failed',duration_ms=$3,error_code=$4,finished_at=now() WHERE organization_id=$1 AND id=$2",[actor.organizationId,eventId,Date.now()-started,code]);if(error instanceof AccessError)throw error;if(code==='free_tier_exhausted')throw new AccessError(429,'Limite gratuito do Gemini atingido. Aguarde a renovação da cota ou tente novamente mais tarde.');if(code==='rate_limited')throw new AccessError(429,'O assistente está temporariamente ocupado. Tente novamente.');if(code==='provider_model_not_found')throw new AccessError(503,'O modelo de IA configurado não está disponível. Verifique a configuração do Assistente Comercial.');if(code==='provider_bad_request')throw new AccessError(503,'Não foi possível processar a solicitação com o provedor de IA.');throw new AccessError(503,'Não foi possível gerar a sugestão agora. Tente novamente.');}
}
