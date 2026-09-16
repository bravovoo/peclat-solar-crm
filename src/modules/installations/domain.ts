import {z} from 'zod';
import {uuid} from '@/modules/crm/domain';

export const installationStatuses={
 awaiting_schedule:'Aguardando agendamento',scheduled:'Agendada',awaiting_equipment:'Aguardando equipamento',
 in_progress:'Em execução',pending_issue:'Pendência',completed:'Concluída',cancelled:'Cancelada'
} as const;
export type InstallationStatus=keyof typeof installationStatuses;
export const installationTransitions:Record<InstallationStatus,InstallationStatus[]>={
 awaiting_schedule:['scheduled','awaiting_equipment','cancelled'],
 scheduled:['awaiting_equipment','in_progress','pending_issue','cancelled'],
 awaiting_equipment:['scheduled','in_progress','pending_issue','cancelled'],
 in_progress:['pending_issue','completed','cancelled'],
 pending_issue:['awaiting_equipment','in_progress','completed','cancelled'],
 completed:[],cancelled:[]
};
const status=z.enum(Object.keys(installationStatuses) as [InstallationStatus,...InstallationStatus[]]);
const optionalDate=z.union([z.iso.date(),z.literal(''),z.null()]).optional().transform(value=>value||null);
const optionalUuid=z.union([uuid,z.literal(''),z.null()]).optional().transform(value=>value||null);
const text=(max:number)=>z.string().trim().max(max).default('');

export const installationSchema=z.object({
 contract_id:uuid,responsible_user_id:optionalUuid,team_name:text(180),
 installation_address:z.string().trim().min(5,'Informe o endereço da instalação.').max(500),
 planned_on:optionalDate,scheduled_on:optionalDate,started_on:optionalDate,completed_on:optionalDate,
 notes:text(4000),version:z.coerce.number().int().positive().optional()
}).strict().superRefine((value,ctx)=>{
 if(value.completed_on&&value.started_on&&value.completed_on<value.started_on)
  ctx.addIssue({code:'custom',path:['completed_on'],message:'A conclusão não pode anteceder o início.'});
});
export const installationStatusSchema=z.object({status,version:z.coerce.number().int().positive(),scheduled_on:optionalDate,started_on:optionalDate,completed_on:optionalDate,final_notes:text(4000),confirm_open_issues:z.boolean().default(false)}).strict();
export const installationFiltersSchema=z.object({
 q:z.string().trim().max(120).default(''),status:z.union([status,z.literal('all')]).default('all'),
 owner:optionalUuid,client_id:optionalUuid,contract_id:optionalUuid,
 page:z.coerce.number().int().min(1).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(30)
}).strict();

export type Installation={
 id:string;organization_id:string;contract_id:string;installation_number:string;contract_number:string;contract_title:string;
 client_id:string;client_name:string;opportunity_id:string|null;opportunity_title:string|null;
 responsible_user_id:string;responsible_name:string;team_name:string;installation_address:string;
 status:InstallationStatus;planned_on:string|null;scheduled_on:string|null;started_on:string|null;completed_on:string|null;
 notes:string;created_by:string;created_by_name:string;created_at:string;updated_at:string;version:number;checklist_completed:number;checklist_total:number;open_issues_count:number
};
export const defaultChecklist=[
 ['equipment_checked','Equipamentos conferidos'],['modules_delivered','Módulos entregues'],['inverter_checked','Inversor ou microinversor conferido'],
 ['structure_checked','Estrutura conferida'],['site_released','Local de instalação liberado'],['roof_checked','Estrutura e telhado verificados'],
 ['modules_installed','Módulos instalados'],['inverter_installed','Inversor instalado'],['wiring_done','Cabeamento executado'],
 ['protections_installed','Proteções instaladas'],['grounding_checked','Aterramento verificado'],['labels_added','Identificação e etiquetas'],
 ['area_cleaned','Área limpa'],['final_test','Teste final realizado'],['photos_registered','Fotos registradas'],['client_oriented','Cliente orientado']
] as const;
export const checklistUpdateSchema=z.object({checked:z.boolean(),notes:text(2000),version:z.coerce.number().int().positive()}).strict();
export const fileMetadataSchema=z.object({installation_id:uuid,kind:z.enum(['photo','document']),name:z.string().trim().min(2).max(180),description:text(2000),category:z.string().trim().min(2).max(80)}).strict();
export const issueStatuses={open:'Aberta',in_progress:'Em andamento',resolved:'Resolvida',cancelled:'Cancelada'} as const;
export const issuePriorities={low:'Baixa',medium:'Média',high:'Alta',critical:'Crítica'} as const;
export const issueSchema=z.object({installation_id:uuid,title:z.string().trim().min(2).max(180),description:text(4000),status:z.enum(['open','in_progress','resolved','cancelled']).default('open'),priority:z.enum(['low','medium','high','critical']).default('medium'),responsible_user_id:uuid,due_on:optionalDate,resolution_notes:text(2000),version:z.coerce.number().int().positive().optional()}).strict();
export const deliverySchema=z.object({delivered_at:z.iso.datetime({offset:true}),delivered_by:uuid,recipient_name:z.string().trim().min(2).max(180),notes:text(2000),confirmed:z.boolean(),version:z.coerce.number().int().positive().optional()}).strict();
export type ChecklistItem={id:string;code:string;label:string;position:number;checked:boolean;checked_by:string|null;checked_by_name:string|null;checked_at:string|null;notes:string;version:number};
export type InstallationFile={id:string;kind:'photo'|'document';name:string;description:string;category:string;original_filename:string;mime_type:string;file_size:number;created_by_name:string;created_at:string;version:number};
export type InstallationIssue={id:string;installation_id:string;title:string;description:string;status:keyof typeof issueStatuses;priority:keyof typeof issuePriorities;responsible_user_id:string;responsible_name:string;due_on:string|null;resolved_at:string|null;resolution_notes:string;created_by_name:string;created_at:string;version:number};
export type InstallationCompletion={completed_at:string;completed_by_name:string;final_notes:string;checklist_snapshot:unknown;issues_snapshot:unknown;had_open_issues:boolean};
export type InstallationDelivery={id:string;delivered_at:string;delivered_by:string;delivered_by_name:string;recipient_name:string;notes:string;confirmed:boolean;version:number};
export type InstallationDetail={installation:Installation;items:Array<{id:string;description:string;category:string;source_name:string;quantity:number}>;history:Array<{id:string;action:string;detail:string;actor_name:string;created_at:string;snapshot:unknown}>;checklist:ChecklistItem[];files:InstallationFile[];issues:InstallationIssue[];completion:InstallationCompletion|null;delivery:InstallationDelivery|null};
export type InstallationOptions={contracts:Array<{id:string;contract_number:string;title:string;client_name:string;installation_address:string}>;owners:Array<{id:string;name:string}>};
