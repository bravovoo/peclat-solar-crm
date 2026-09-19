import { z } from 'zod';
export const kinds=['lead','customer','company'] as const;
export type Kind=typeof kinds[number];
export const paths:Record<Kind,string>={lead:'leads',customer:'clientes',company:'empresas'};
export const labels:Record<Kind,string>={lead:'Leads',customer:'Clientes',company:'Empresas'};
export const stages={new:'Novo lead',contact:'Primeiro contato',qualified:'Qualificação',awaiting_bill:'Aguardando conta',bill_received:'Conta recebida',analysis:'Análise',sizing:'Dimensionamento',budget:'Orçamento',proposal:'Proposta enviada',negotiation:'Negociação',documentation:'Documentação',contract:'Contrato',payment:'Pagamento',won:'Venda ganha',lost:'Venda perdida'};
export const sources=['WhatsApp','Instagram','Facebook','Google','Google Ads','Meta Ads','Indicação','Site','Formulário','Ligação','Prospecção','Parceiro','Importação','Manual','Outro'];
export const priorities={low:'Baixa',normal:'Normal',high:'Alta',urgent:'Urgente'};
export const temperatures={cold:'Frio',warm:'Morno',hot:'Quente'};
export const statuses={active:'Ativo',archived:'Arquivado',converted:'Convertido'};
export const digits=(value:string)=>value.replace(/\D/g,'');
export function normalizePhone(value:string){const d=digits(value);return d.length===10||d.length===11?'55'+d:d;}
export function validDocument(value:string){
 if(!value)return true;if(!/^(?:\d{11}|[A-Z0-9]{12}\d{2})$/.test(value)||/^(\d)\1+$/.test(value))return false;
 const check=(base:string,weights:number[])=>{const remainder=[...base].reduce((sum,n,i)=>sum+(n.charCodeAt(0)-48)*weights[i],0)%11;return remainder<2?0:11-remainder;};
 if(value.length===11)return check(value.slice(0,9),[10,9,8,7,6,5,4,3,2])===Number(value[9])&&check(value.slice(0,10),[11,10,9,8,7,6,5,4,3,2])===Number(value[10]);
 return check(value.slice(0,12),[5,4,3,2,9,8,7,6,5,4,3,2])===Number(value[12])&&check(value.slice(0,13),[6,5,4,3,2,9,8,7,6,5,4,3,2])===Number(value[13]);
}
const text=(max=180)=>z.string().trim().max(max).default('');
const phone=text(30).transform(normalizePhone).refine(v=>!v||/^\d{10,15}$/.test(v),'Telefone inválido. Use DDD e número.');
const email=text(254).transform(v=>v.toLowerCase()).refine(v=>!v||z.email().safeParse(v).success,'E-mail inválido.');
export const uuid=z.uuid();
export const recordSchema=z.object({
 name:z.string().trim().min(2,'Informe um nome com pelo menos 2 caracteres.').max(180),
 person_type:z.enum(['PF','PJ']).default('PF'),document:text(24).transform(v=>v.toUpperCase().replace(/[.\/\-\s]/g,'')).refine(validDocument,'CPF/CNPJ inválido.'),
 phone,whatsapp:phone,email,postal_code:text(10).transform(digits).refine(v=>!v||v.length===8,'CEP inválido.'),
 address:text(),number:text(20),complement:text(120),neighborhood:text(100),city:text(100),state:text(2).transform(v=>v.toUpperCase()).refine(v=>!v||['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'].includes(v),'UF inválida.'),
 owner_id:uuid.nullable().optional(),source:z.string().trim().min(1).max(60).default('Manual'),campaign:text(120),
 priority:z.enum(['low','normal','high','urgent']).default('normal'),temperature:z.enum(['cold','warm','hot']).default('warm'),
 stage:z.enum(Object.keys(stages) as [keyof typeof stages,...(keyof typeof stages)[]]).default('new'),
 potential_value:z.coerce.number().min(0).max(99999999999.99).default(0),
 expected_close:z.union([z.iso.date(),z.literal('')]).default(''),observations:text(4000),
 average_consumption:z.preprocess(v=>v===''?null:v,z.coerce.number().min(0).max(9999999999.99).nullable()).default(null),
 utility:text(100),property_type:text(80),roof_type:text(80),consumer_units:z.coerce.number().int().min(1).max(10000).default(1),
 battery_interest:z.boolean().default(false),financing_interest:z.boolean().default(false),trade_name:text(),state_registration:text(30),
 website:text(300).refine(v=>!v||(/^https?:\/\//.test(v)&&z.url().safeParse(v).success),'Informe um site com https://.'),
 tag_ids:z.array(uuid).max(30).default([]),allow_duplicate:z.boolean().default(false),version:z.number().int().positive().optional(),
}).strict().superRefine((v,ctx)=>{if(v.document&&v.document.length!==(v.person_type==='PF'?11:14))ctx.addIssue({code:'custom',path:['document'],message:'Documento incompatível com PF/PJ.'});});
export type RecordInput=z.input<typeof recordSchema>;
export type RecordData=z.output<typeof recordSchema>;
export type Tag={id:string;name:string;color:string};
export type CommercialRecord=Omit<RecordData,'tag_ids'|'allow_duplicate'|'owner_id'|'version'> & {id:string;kind:Kind;owner_id:string|null;owner_name:string|null;status:keyof typeof statuses;is_demo:boolean;version:number;original_lead_id:string|null;converted_customer_id?:string|null;created_at:string;updated_at:string;tags:Tag[]};
export const filterSchema=z.object({q:z.string().trim().max(120).default(''),page:z.coerce.number().int().min(1).max(100000).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(20),sort:z.enum(['newest','oldest','name','value']).default('newest'),owner:uuid.optional(),team:uuid.optional(),view:z.enum(['mine','team','all','unassigned']).optional(),source:text(60),stage:text(40),temperature:text(10),priority:text(10),city:text(100),state:text(2),person_type:text(2),tag:uuid.optional(),from:z.iso.date().optional(),to:z.iso.date().optional(),status:z.enum(['active','archived','converted','all']).default('active')}).superRefine((v,c)=>{if(v.from&&v.to&&v.from>v.to)c.addIssue({code:'custom',message:'Período inválido.'});});
export const contactSchema=z.object({record_id:uuid,name:z.string().trim().min(2).max(180),job_title:text(100),phone,whatsapp:phone,email,is_primary:z.boolean().default(false),observations:text(2000)}).strict();
export const noteSchema=z.object({record_id:uuid,body:z.string().trim().min(1).max(4000)}).strict();
export const taskSchema=z.object({record_id:uuid,title:z.string().trim().min(2).max(180),due_at:z.iso.datetime({offset:true})}).strict();
export const tagSchema=z.object({name:z.string().trim().min(1).max(40),color:z.string().regex(/^#[a-fA-F0-9]{6}$/).default('#195ca0')}).strict();
export function csvCell(value:unknown){let s=String(value??'');if(/^[\s]*[=+@\-]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}
