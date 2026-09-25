import {z} from 'zod';

export const flowCategories=['SIGN_UP','SIGN_IN','APPOINTMENT_BOOKING','LEAD_GENERATION','CONTACT_US','CUSTOMER_SUPPORT','SURVEY','OTHER'] as const;
export const flowStatuses=['DRAFT','PUBLISHED','DEPRECATED','BLOCKED','THROTTLED','UNKNOWN'] as const;
export const flowTargets=['name','city','state','property_type','average_bill','has_bill','property_owned','commercial_interest','technical_visit','preferred_contact_period','observations'] as const;
const technical=z.string().trim().min(3).max(200).regex(/^[a-z0-9_]+$/,'Use somente letras minúsculas, números e sublinhado.');
export const flowCreateInput=z.object({technical_name:technical,display_name:z.string().trim().min(3).max(180),category:z.enum(flowCategories).default('LEAD_GENERATION')}).strict();
export const flowUpdateInput=flowCreateInput.extend({version:z.number().int().positive()}).strict();
export const flowMutationInput=z.object({version:z.number().int().positive(),confirmation:z.literal(true)}).strict();
export const flowSendInput=z.object({client_request_id:z.uuid(),flow_id:z.uuid()}).strict();
export const flowMappingInput=z.object({version:z.number().int().positive(),mappings:z.array(z.object({flow_field:z.string().trim().regex(/^[a-z][a-z0-9_]{0,79}$/),crm_field:z.enum(flowTargets),label:z.string().trim().min(1).max(100),enabled:z.boolean()}).strict()).min(1).max(30)}).strict().superRefine((value,ctx)=>{
 const fields=value.mappings.map(item=>item.flow_field),targets=value.mappings.map(item=>item.crm_field);
 if(new Set(fields).size!==fields.length)ctx.addIssue({code:'custom',message:'Existem campos de origem duplicados.'});
 if(new Set(targets).size!==targets.length)ctx.addIssue({code:'custom',message:'Existem destinos do CRM duplicados.'});
});

export type NormalizedFlowSubmission={name:string;city:string;state:string;property_type:string;average_bill:number|null;has_bill:string;property_owned:string;commercial_interest:string;technical_visit:string;preferred_contact_period:string;observations:string};
export const emptyNormalizedFlow=():NormalizedFlowSubmission=>({name:'',city:'',state:'',property_type:'',average_bill:null,has_bill:'',property_owned:'',commercial_interest:'',technical_visit:'',preferred_contact_period:'',observations:''});
