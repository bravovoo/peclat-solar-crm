import {z} from 'zod';
import {uuid} from '@/modules/crm/domain';

export const documentStatuses={draft:'Rascunho',sent:'Enviado',accepted:'Aceito',refused:'Recusado'} as const;
export type DocumentStatus=keyof typeof documentStatuses;
export const documentStatusSchema=z.enum(Object.keys(documentStatuses) as [DocumentStatus,...DocumentStatus[]]);
const text=(max:number)=>z.string().trim().max(max).default('');
export const documentCreateSchema=z.object({customer_id:uuid,opportunity_id:uuid,name:z.string().trim().min(2).max(180),budget_value:z.coerce.number().min(0).max(99999999999.99),valid_until:z.iso.date(),notes:text(4000)}).strict();
export const documentUpdateSchema=z.object({name:z.string().trim().min(2).max(180),budget_value:z.coerce.number().min(0).max(99999999999.99),valid_until:z.iso.date(),notes:text(4000),version:z.coerce.number().int().positive()}).strict();
export const documentListSchema=z.object({customer_id:uuid.optional(),opportunity_id:uuid.optional()}).strict().superRefine((value,context)=>{if(Number(!!value.customer_id)+Number(!!value.opportunity_id)!==1)context.addIssue({code:'custom',message:'Informe um cliente ou uma oportunidade.'});});
export const documentEmailSchema=z.object({recipient:z.string().trim().toLowerCase().email('Informe um e-mail válido.').max(254),subject:z.string().trim().min(1,'Informe o assunto.').max(180).refine(value=>!/[\r\n]/.test(value),'Assunto inválido.'),message:z.string().trim().min(1,'Informe a mensagem.').max(10000)}).strict();
export type CrmDocument={id:string;customer_id:string;opportunity_id:string;customer_name:string;customer_email:string;opportunity_title:string;name:string;budget_value:number;valid_until:string;notes:string;status:DocumentStatus;original_filename:string;file_size:number;content_sha256:string;version:number;created_by:string;created_by_name:string;created_at:string;updated_at:string};
export type DocumentHistory={id:string;action:'created'|'updated'|'status_changed';snapshot:CrmDocument;actor_name:string;created_at:string};
export type DocumentEmail={id:string;document_id:string;customer_id:string;opportunity_id:string;recipient:string;subject:string;message:string;document_name:string;original_filename:string;provider_message_id:string;actor_name:string;sent_at:string};
