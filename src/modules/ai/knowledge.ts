import {z} from 'zod';
import {database,transaction} from '@/server/db';
import {AccessError,requirePermission,type Actor} from '@/modules/auth/policy';
import {assertWhatsAppConversation} from '@/modules/whatsapp/inbox';
import {knowledgeEntryInput,knowledgeGuidanceInput,knowledgeProposalInput,knowledgeQuestionInput,type CommercialAiContext} from './domain';

type Entry={id:string;category:string;question:string;answer:string;keywords:string[];status:string;version:number;proposed_by:string;reviewed_by:string|null;reviewed_at:string|null;updated_at:string};
type Guidance={tone:'profissional'|'acolhedor'|'direto';formality:'formal'|'equilibrada'|'informal';response_length:'curta'|'media'|'detalhada';emoji_policy:'nenhum'|'moderado';seller_introduction:string;commercial_rules:string;version:number;updated_at:string};
const defaultGuidance={tone:'profissional',formality:'equilibrada',response_length:'curta',emoji_policy:'moderado',seller_introduction:'',commercial_rules:'',version:null as number|null,updated_at:null as string|null};
const idInput=z.uuid();
const editInput=knowledgeEntryInput.extend({version:z.number().int().positive()}).strict();
const stateInput=z.object({version:z.number().int().positive(),status:z.enum(['active','inactive','rejected','deleted'])}).strict();

export async function knowledgeOverview(actor:Actor){
 requirePermission(actor,'ai_knowledge.manage');
 const [entries,guidance]=await Promise.all([
  database().query<Entry>("SELECT id,category,question,answer,keywords,status,version,proposed_by,reviewed_by,reviewed_at,updated_at FROM ai_knowledge_entries WHERE organization_id=$1 AND status<>'deleted' ORDER BY updated_at DESC LIMIT 500",[actor.organizationId]),
  database().query<Guidance>('SELECT tone,formality,response_length,emoji_policy,seller_introduction,commercial_rules,version,updated_at FROM ai_knowledge_guidance WHERE organization_id=$1',[actor.organizationId]),
 ]);
 return {entries:entries.rows,guidance:guidance.rows[0]??defaultGuidance};
}

export async function saveKnowledgeGuidance(actor:Actor,input:unknown){
 requirePermission(actor,'ai_knowledge.manage');const data=knowledgeGuidanceInput.parse(input);
 await transaction(async db=>{
  const current=(await db.query<{version:number}>('SELECT version FROM ai_knowledge_guidance WHERE organization_id=$1 FOR UPDATE',[actor.organizationId])).rows[0];
  if((current?.version??null)!==data.version)throw new AccessError(409,'Orientações alteradas por outra pessoa. Recarregue.');
  if(current)await db.query('UPDATE ai_knowledge_guidance SET tone=$2,formality=$3,response_length=$4,emoji_policy=$5,seller_introduction=$6,commercial_rules=$7,updated_by=$8,version=version+1,updated_at=now() WHERE organization_id=$1',[actor.organizationId,data.tone,data.formality,data.response_length,data.emoji_policy,data.seller_introduction,data.commercial_rules,actor.userId]);
  else await db.query('INSERT INTO ai_knowledge_guidance(organization_id,tone,formality,response_length,emoji_policy,seller_introduction,commercial_rules,updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',[actor.organizationId,data.tone,data.formality,data.response_length,data.emoji_policy,data.seller_introduction,data.commercial_rules,actor.userId]);
  await db.query('INSERT INTO audit_logs(organization_id,actor_id,action,detail) VALUES ($1,$2,$3,$4)',[actor.organizationId,actor.userId,'ai_knowledge.guidance_updated','Orientações comerciais atualizadas.']);
 });return knowledgeOverview(actor);
}

export async function proposeKnowledge(actor:Actor,input:unknown){
 requirePermission(actor,'ai_knowledge.propose');requirePermission(actor,'ai_assistant.use');const data=knowledgeProposalInput.parse(input);
 if(data.conversation_id)await assertWhatsAppConversation(actor,data.conversation_id);
 const row=await database().query<{id:string}>('INSERT INTO ai_knowledge_entries(organization_id,category,question,answer,keywords,proposed_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',[actor.organizationId,data.category,data.question,data.answer,data.keywords,actor.userId]);
 await database().query('INSERT INTO audit_logs(organization_id,actor_id,action,detail) VALUES ($1,$2,$3,$4)',[actor.organizationId,actor.userId,'ai_knowledge.proposed',`Proposta ${row.rows[0].id} criada para revisão.`]);
 return {id:row.rows[0].id,status:'draft'};
}

export async function editKnowledge(actor:Actor,id:string,input:unknown){
 requirePermission(actor,'ai_knowledge.manage');idInput.parse(id);const data=editInput.parse(input);
 return transaction(async db=>{
  const row=(await db.query<Entry>("UPDATE ai_knowledge_entries SET category=$4,question=$5,answer=$6,keywords=$7,status='draft',reviewed_by=NULL,reviewed_at=NULL,version=version+1,updated_at=now() WHERE organization_id=$1 AND id=$2 AND version=$3 AND status<>'deleted' RETURNING id",[actor.organizationId,id,data.version,data.category,data.question,data.answer,data.keywords])).rows[0];
  if(!row)throw new AccessError(409,'Item alterado ou indisponível. Recarregue.');
  await db.query('INSERT INTO audit_logs(organization_id,actor_id,action,detail) VALUES ($1,$2,$3,$4)',[actor.organizationId,actor.userId,'ai_knowledge.edited',`Item ${id} editado e enviado para revisão.`]);return {id,status:'draft'};
 });
}

export async function changeKnowledgeStatus(actor:Actor,id:string,input:unknown){
 requirePermission(actor,'ai_knowledge.manage');idInput.parse(id);const data=stateInput.parse(input);
 return transaction(async db=>{
  const row=(await db.query<{id:string}>("UPDATE ai_knowledge_entries SET status=$4,reviewed_by=$5,reviewed_at=now(),version=version+1,updated_at=now() WHERE organization_id=$1 AND id=$2 AND version=$3 AND status<>'deleted' RETURNING id",[actor.organizationId,id,data.version,data.status,actor.userId])).rows[0];
  if(!row)throw new AccessError(409,'Item alterado ou indisponível. Recarregue.');
  await db.query('INSERT INTO audit_logs(organization_id,actor_id,action,detail) VALUES ($1,$2,$3,$4)',[actor.organizationId,actor.userId,'ai_knowledge.status_changed',`Item ${id}: ${data.status}.`]);return {id,status:data.status};
 });
}

const ignored=new Set(['como','para','qual','quais','sobre','pode','posso','voce','voces','uma','isso','essa','esse','tem','com','dos','das','que','por','seu','sua','mais']);
function searchTerms(text:string){return [...new Set((text.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g,'').match(/[a-z0-9]{3,}/g)??[]).filter(term=>!ignored.has(term)))].slice(0,12);}
export async function relevantKnowledge(actor:Actor,question:string):Promise<CommercialAiContext['knowledge']>{
 const guidance=(await database().query<Guidance>('SELECT tone,formality,response_length,emoji_policy,seller_introduction,commercial_rules,version,updated_at FROM ai_knowledge_guidance WHERE organization_id=$1',[actor.organizationId])).rows[0];
 const terms=searchTerms(knowledgeQuestionInput.parse({question}).question);
 const entries=terms.length?(await database().query<{id:string;category:string;question:string;answer:string}>(`SELECT id,category,question,answer FROM ai_knowledge_entries
  WHERE organization_id=$1 AND status='active' AND (to_tsvector('portuguese',question||' '||category) @@ to_tsquery('portuguese',$2) OR keywords && $3::text[])
  ORDER BY (CASE WHEN keywords && $3::text[] THEN 0.5 ELSE 0 END)+ts_rank(to_tsvector('portuguese',question||' '||category),to_tsquery('portuguese',$2)) DESC,updated_at DESC LIMIT 4`,[actor.organizationId,terms.join(' | '),terms])).rows:[];
 return {guidance:guidance?{tone:guidance.tone,formality:guidance.formality,responseLength:guidance.response_length,emojiPolicy:guidance.emoji_policy,sellerIntroduction:guidance.seller_introduction,commercialRules:guidance.commercial_rules}:null,entries};
}
