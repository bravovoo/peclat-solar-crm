import {z} from 'zod';

export const automationTriggers={
 'whatsapp.inbound_received':'Nova mensagem recebida no WhatsApp',
 'whatsapp.conversation_created':'Nova conversa no WhatsApp',
 'whatsapp.conversation_unassigned':'Conversa sem responsável',
 'whatsapp.lead_created':'Lead criado pela inbox',
 'lead.created':'Novo Lead',
 'lead.stage_changed':'Etapa do Lead alterada',
 'opportunity.stage_changed':'Etapa da oportunidade alterada',
 'task.overdue':'Tarefa vencida',
 'no_reply_for_duration':'Conversa sem resposta',
 'follow_up_due':'Follow-up pendente',
} as const;
export type AutomationTrigger=keyof typeof automationTriggers;

const uuid=z.uuid();
const safeText=(max:number)=>z.string().trim().max(max);
const businessDay=z.object({enabled:z.boolean(),start:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),end:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)}).strict().refine(value=>!value.enabled||value.start<value.end,'O fim do expediente deve ser posterior ao início.');
export const businessHoursSchema=z.object({
 '1':businessDay,'2':businessDay,'3':businessDay,'4':businessDay,'5':businessDay,'6':businessDay,'7':businessDay,
}).strict();
export type BusinessHours=z.infer<typeof businessHoursSchema>;

export const automationSettingsInput=z.object({
 whatsapp_outbound_enabled:z.boolean(),
 timezone:z.string().trim().min(3).max(80).refine(value=>{try{new Intl.DateTimeFormat('pt-BR',{timeZone:value}).format();return true;}catch{return false;}},'Fuso horário inválido.'),
 business_hours:businessHoursSchema,
 max_outbound_per_conversation_24h:z.number().int().min(1).max(20),
 max_outbound_per_rule_24h:z.number().int().min(1).max(1000),
 version:z.number().int().positive(),
}).strict();

const condition=z.discriminatedUnion('type',[
 z.object({type:z.literal('outside_business_hours')}).strict(),
 z.object({type:z.literal('inside_business_hours')}).strict(),
 z.object({type:z.literal('conversation_unassigned')}).strict(),
 z.object({type:z.literal('new_whatsapp_conversation')}).strict(),
 z.object({type:z.literal('record_kind'),value:z.enum(['lead','customer','company'])}).strict(),
 z.object({type:z.literal('stage_equals'),value:safeText(40).min(1)}).strict(),
 z.object({type:z.literal('elapsed_minutes'),value:z.number().int().min(1).max(525600)}).strict(),
]);
export const automationConditions=z.object({all:z.array(condition).max(10).default([])}).strict();

const ownerMode=z.enum(['event_owner','conversation_owner','fixed','round_robin']);
const actionBase=z.object({continue_on_error:z.boolean().default(false)});
const action=z.discriminatedUnion('type',[
 actionBase.extend({type:z.literal('create_task'),title:safeText(180).min(2),description:safeText(4000).default(''),delay_minutes:z.number().int().min(0).max(525600),owner_mode:ownerMode.default('event_owner'),owner_id:uuid.nullable().default(null),team_id:uuid.nullable().default(null)}).strict(),
 actionBase.extend({type:z.literal('assign_owner'),mode:z.enum(['fixed','round_robin']),owner_id:uuid.nullable().default(null),team_id:uuid.nullable().default(null)}).strict(),
 actionBase.extend({type:z.literal('add_tag'),tag_id:uuid}).strict(),
 actionBase.extend({type:z.literal('remove_tag'),tag_id:uuid}).strict(),
 actionBase.extend({type:z.literal('send_whatsapp_message'),text:safeText(4096).min(1)}).strict(),
 actionBase.extend({type:z.literal('send_whatsapp_template'),template_id:uuid,header:z.array(safeText(1024).min(1)).max(20).default([]),body:z.array(safeText(1024).min(1)).max(50).default([])}).strict(),
 actionBase.extend({type:z.literal('mark_for_follow_up'),title:safeText(180).min(2),delay_minutes:z.number().int().min(1).max(525600),owner_mode:ownerMode.default('event_owner'),owner_id:uuid.nullable().default(null),team_id:uuid.nullable().default(null)}).strict(),
]);
export const automationActions=z.array(action).min(1).max(10);
export type AutomationAction=z.infer<typeof action>;

export const automationRuleInput=z.object({
 name:safeText(180).min(2),description:safeText(1000).default(''),active:z.boolean().default(false),
 trigger_type:z.enum(Object.keys(automationTriggers) as [AutomationTrigger,...AutomationTrigger[]]),
 conditions:automationConditions,actions:automationActions,priority:z.number().int().min(1).max(1000),
 cooldown_minutes:z.number().int().min(0).max(43200),version:z.number().int().positive().nullable().default(null),
}).strict().superRefine((value,context)=>{
  if(value.conditions.all.some(item=>item.type==='elapsed_minutes')&&!['no_reply_for_duration','follow_up_due'].includes(value.trigger_type))context.addIssue({code:'custom',message:'Tempo decorrido exige um gatilho agendado.',path:['conditions']});
  if(value.conditions.all.some(item=>item.type==='new_whatsapp_conversation')&&value.trigger_type!=='whatsapp.inbound_received')context.addIssue({code:'custom',message:'Conversa realmente nova exige o gatilho de nova mensagem recebida.',path:['conditions']});
  if(value.trigger_type==='no_reply_for_duration'&&!value.conditions.all.some(item=>item.type==='elapsed_minutes'))context.addIssue({code:'custom',message:'Informe quantos minutos sem resposta devem decorrer.',path:['conditions']});
  for(const [index,item] of value.actions.entries()){
   if((item.type==='assign_owner'||item.type==='create_task'||item.type==='mark_for_follow_up')&&'mode' in item&&item.mode==='fixed'&&!item.owner_id)context.addIssue({code:'custom',message:'Selecione o responsável fixo.',path:['actions',index,'owner_id']});
   if((item.type==='create_task'||item.type==='mark_for_follow_up')&&item.owner_mode==='fixed'&&!item.owner_id)context.addIssue({code:'custom',message:'Selecione o responsável fixo.',path:['actions',index,'owner_id']});
   if((item.type==='assign_owner'&&item.mode==='round_robin'||(item.type==='create_task'||item.type==='mark_for_follow_up')&&item.owner_mode==='round_robin')&&!item.team_id)context.addIssue({code:'custom',message:'Selecione a equipe do round-robin.',path:['actions',index,'team_id']});
  }
 });

export const automationConversationInput=z.object({automations_paused:z.boolean().optional(),automation_blocked:z.boolean().optional(),version:z.number().int().positive()}).strict().refine(value=>value.automations_paused!==undefined||value.automation_blocked!==undefined,'Nenhuma alteração informada.');
export const automationSimulationInput=z.object({trigger_type:z.enum(Object.keys(automationTriggers) as [AutomationTrigger,...AutomationTrigger[]]),outside_business_hours:z.boolean().default(false),conversation_unassigned:z.boolean().default(false),new_whatsapp_conversation:z.boolean().default(false),elapsed_minutes:z.number().int().min(0).max(525600).default(0),record_kind:z.enum(['lead','customer','company']).nullable().default(null),stage:z.string().trim().max(40).default('')}).strict();

export function isBusinessOpen(hours:BusinessHours,timeZone:string,now=new Date()){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone,weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);
 const weekday=parts.find(part=>part.type==='weekday')?.value;
 const day=({Mon:'1',Tue:'2',Wed:'3',Thu:'4',Fri:'5',Sat:'6',Sun:'7'} as const)[weekday as 'Mon'];
 const hour=parts.find(part=>part.type==='hour')?.value??'00',minute=parts.find(part=>part.type==='minute')?.value??'00';
 const current=`${hour}:${minute}`,config=hours[day];
 return Boolean(config?.enabled&&current>=config.start&&current<config.end);
}
