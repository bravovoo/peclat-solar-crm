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
