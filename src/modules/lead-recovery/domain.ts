import {z} from 'zod';
import {businessHoursSchema} from '@/modules/automations/domain';

export const recoveryStatuses={scheduled:'Agendada',paused:'Pausada',responded:'Cliente respondeu',completed:'Concluída',cancelled:'Cancelada',error:'Erro'} as const;
export const recoveryClassifications={not_contacted:'Não contatado',awaiting_reply:'Aguardando resposta'} as const;
export const recoveryConsentStatuses={unknown:'Não informado',opted_in:'Autorizado',opted_out:'Descadastrado'} as const;

const leadStage=z.enum(['new','contact','qualified','awaiting_bill','bill_received','analysis','sizing','budget','proposal','negotiation','documentation','contract','payment','won','lost']);
const parameter=z.string().trim().min(1).max(1024).refine(value=>!value.includes('{{')||/^([^{}]|\{\{(lead_first_name|lead_name|seller_name|organization_name)\}\})+$/.test(value),'Use somente as variáveis {{lead_first_name}}, {{lead_name}}, {{seller_name}} ou {{organization_name}}.');
const recoveryStep=z.object({position:z.number().int().min(1).max(4),delay_days:z.number().int().min(1).max(365),template_id:z.uuid(),header_parameters:z.array(parameter).max(20).default([]),body_parameters:z.array(parameter).max(50).default([])}).strict();

export const recoverySettingsInput=z.object({
 enabled:z.boolean(),
 include_uncontacted:z.literal(false),
 timezone:z.literal('America/Sao_Paulo'),
 business_hours:businessHoursSchema.refine(hours=>Object.values(hours).some(day=>day.enabled),'Selecione pelo menos um dia.').refine(hours=>Object.values(hours).every(day=>day.start==='08:00'&&day.end==='20:00'),'Use a janela das 08h às 20h.'),
 lead_stages:z.array(leadStage).min(1).max(18),
 seller_ids:z.array(z.uuid()).max(200),
 default_owner_id:z.uuid(),
 steps:z.array(recoveryStep).min(1).max(4).superRefine((steps,ctx)=>{
  const positions=steps.map(step=>step.position);
  if(new Set(positions).size!==positions.length)ctx.addIssue({code:'custom',message:'As posições das tentativas não podem se repetir.'});
  const sorted=[...steps].sort((a,b)=>a.position-b.position);
  sorted.forEach((step,index)=>{if(index>0&&step.delay_days<=sorted[index-1].delay_days)ctx.addIssue({code:'custom',message:'Os dias absolutos devem ser crescentes.'});if(step.position!==index+1)ctx.addIssue({code:'custom',message:'As tentativas devem ser sequenciais.',path:[index,'position']});});
 }),
 version:z.number().int().positive(),
}).strict();

export const recoveryConsentInput=z.object({
 whatsapp_consent_status:z.literal('opted_out'),
 version:z.number().int().positive().nullable(),
}).strict();

export const recoveryFilters=z.object({
 q:z.string().trim().max(120).default(''),
 status:z.enum(['all','eligible','scheduled','paused','responded','completed','cancelled','error','excluded']).default('all'),
 owner_id:z.union([z.uuid(),z.literal('')]).default(''),
 stage:z.union([leadStage,z.literal('')]).default(''),
 inactivity_days:z.coerce.number().int().min(0).max(3650).default(0),
 page:z.coerce.number().int().min(1).max(100000).default(1),
 page_size:z.coerce.number().int().min(1).max(100).default(30),
}).strict();

export const recoveryOperationInput=z.discriminatedUnion('action',[
 z.object({action:z.literal('pause'),version:z.number().int().positive()}).strict(),
 z.object({action:z.literal('resume'),version:z.number().int().positive()}).strict(),
 z.object({action:z.literal('cancel'),version:z.number().int().positive()}).strict(),
 z.object({action:z.literal('reschedule'),version:z.number().int().positive(),scheduled_for:z.iso.datetime({offset:true})}).strict(),
]);

export type RecoverySettingsInput=z.infer<typeof recoverySettingsInput>;
export type RecoveryFilters=z.infer<typeof recoveryFilters>;
