import {z} from 'zod';

export const whatsappStatuses={not_configured:'Não configurado',incomplete:'Configuração incompleta',connected:'Conectado',error:'Erro de configuração'} as const;
export type WhatsAppStatus=keyof typeof whatsappStatuses;

const safeText=(max:number)=>z.string().trim().max(max).default('');
export const whatsappConfigurationInput=z.object({
 account_name:safeText(180),
 phone_number_id:safeText(100).refine(value=>!value||/^\d+$/.test(value),'O Phone Number ID deve conter somente números.'),
 business_account_id:safeText(100).refine(value=>!value||/^\d+$/.test(value),'O Business Account ID deve conter somente números.'),
 display_phone_number:safeText(40),
 api_version:safeText(30).refine(value=>!value||/^v\d+(?:\.\d+)?$/.test(value),'Use uma versão no formato vNN.N.'),
 version:z.number().int().positive().nullable().default(null),
}).strict();

export type NormalizedWhatsAppNumber={original:string;digits:string;e164:string|null;valid:boolean};
export function normalizeWhatsAppNumber(value:string):NormalizedWhatsAppNumber{
 const original=value,trimmed=value.trim();let digits=trimmed.replace(/\D/g,'');
 if(trimmed.startsWith('00'))digits=digits.slice(2);
 else if(!trimmed.startsWith('+')&&(digits.length===10||digits.length===11))digits='55'+digits;
 let valid=/^[1-9]\d{7,14}$/.test(digits);
 if(valid&&digits.startsWith('55')){
  const national=digits.slice(2),area=Number(national.slice(0,2));
  valid=(national.length===10||national.length===11)&&area>=11&&area<=99&&national[2]!=='0';
 }
 return {original,digits,e164:valid?`+${digits}`:null,valid};
}
export const whatsappConversationFilters=z.object({q:z.string().trim().max(120).default(''),unread:z.enum(['all','unread']).default('all'),link:z.enum(['all','linked','unlinked']).default('all'),page:z.coerce.number().int().min(1).max(100000).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(30),before_timestamp:z.string().datetime({offset:true}).optional(),before_id:z.string().uuid().optional()}).refine(value=>Boolean(value.before_timestamp)===Boolean(value.before_id),{message:'Cursor de conversas inválido.'});
export const whatsappLinkInput=z.object({record_id:z.uuid().nullable(),version:z.number().int().positive()}).strict();
export const whatsappReadInput=z.object({version:z.number().int().positive()}).strict();
export const whatsappLeadInput=z.object({name:z.string().trim().min(2,'Informe um nome com pelo menos 2 caracteres.').max(180),email:safeText(254).transform(value=>value.toLowerCase()).refine(value=>!value||z.email().safeParse(value).success,'E-mail inválido.'),notes:safeText(4000),tag_ids:z.array(z.uuid()).max(30).default([])}).strict();
export const whatsappTextSendInput=z.object({client_request_id:z.uuid(),text:z.string().trim().min(1,'Digite uma mensagem.').max(4096,'A mensagem deve ter no máximo 4.096 caracteres.')}).strict();
export const whatsappMediaSendInput=z.object({client_request_id:z.uuid(),caption:z.string().trim().max(2000)}).strict();
export const whatsappTemplateSendInput=z.object({client_request_id:z.uuid(),template_id:z.uuid(),parameters:z.object({header:z.array(z.string().trim().min(1).max(1024)).max(20).default([]),body:z.array(z.string().trim().min(1).max(1024)).max(50).default([])}).strict()}).strict();

export type WhatsAppWindow={open:boolean;last_inbound_at:string|null;closes_at:string|null;server_now:string};
export function serviceWindow(lastInbound:Date|null,now=new Date()):WhatsAppWindow{
 const closes=lastInbound?new Date(lastInbound.getTime()+24*60*60*1000):null;
 return {open:Boolean(closes&&closes.getTime()>now.getTime()),last_inbound_at:lastInbound?.toISOString()??null,closes_at:closes?.toISOString()??null,server_now:now.toISOString()};
}
