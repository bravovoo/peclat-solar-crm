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
export const installationStatusSchema=z.object({status,version:z.coerce.number().int().positive(),scheduled_on:optionalDate,started_on:optionalDate,completed_on:optionalDate}).strict();
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
 notes:string;created_by:string;created_by_name:string;created_at:string;updated_at:string;version:number
};
export type InstallationDetail={installation:Installation;items:Array<{id:string;description:string;category:string;source_name:string;quantity:number}>;history:Array<{id:string;action:string;detail:string;actor_name:string;created_at:string;snapshot:unknown}>};
export type InstallationOptions={contracts:Array<{id:string;contract_number:string;title:string;client_name:string;installation_address:string}>;owners:Array<{id:string;name:string}>};
