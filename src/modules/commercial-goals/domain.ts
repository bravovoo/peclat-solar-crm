import {z} from 'zod';
import {uuid} from '@/modules/crm/domain';

export const goalMetrics={sales_value:'Valor vendido',contracts_closed:'Contratos fechados',opportunities_won:'Oportunidades ganhas',new_customers:'Novos clientes'} as const;
export const goalPeriods={monthly:'Mensal',quarterly:'Trimestral',annual:'Anual'} as const;
export type GoalMetric=keyof typeof goalMetrics;
export type GoalPeriod=keyof typeof goalPeriods;

function validPeriod(value:{period:GoalPeriod;starts_on:string;ends_on:string}){
 const start=new Date(`${value.starts_on}T12:00:00Z`),end=new Date(`${value.ends_on}T12:00:00Z`);
 if(Number.isNaN(start.valueOf())||Number.isNaN(end.valueOf()))return false;
 const expected=new Date(start);
 if(value.period==='monthly'){if(start.getUTCDate()!==1)return false;expected.setUTCMonth(expected.getUTCMonth()+1);}
 if(value.period==='quarterly'){if(start.getUTCDate()!==1||start.getUTCMonth()%3!==0)return false;expected.setUTCMonth(expected.getUTCMonth()+3);}
 if(value.period==='annual'){if(start.getUTCDate()!==1||start.getUTCMonth()!==0)return false;expected.setUTCFullYear(expected.getUTCFullYear()+1);}
 expected.setUTCDate(expected.getUTCDate()-1);return expected.toISOString().slice(0,10)===value.ends_on;
}
export const goalInput=z.object({
 target_kind:z.enum(['seller','team']),seller_user_id:uuid.nullable().optional(),team_id:uuid.nullable().optional(),
 metric:z.enum(Object.keys(goalMetrics) as [GoalMetric,...GoalMetric[]]),period:z.enum(Object.keys(goalPeriods) as [GoalPeriod,...GoalPeriod[]]),
 starts_on:z.iso.date(),ends_on:z.iso.date(),target_value:z.coerce.number().positive().max(999999999999.99),version:z.coerce.number().int().positive().optional(),
}).strict().superRefine((value,ctx)=>{
 if((value.target_kind==='seller')!==Boolean(value.seller_user_id)||Boolean(value.seller_user_id)===Boolean(value.team_id))ctx.addIssue({code:'custom',message:'Selecione somente o vendedor ou a equipe da meta.'});
 if(!validPeriod(value))ctx.addIssue({code:'custom',message:'As datas não correspondem ao período selecionado.'});
 if(value.metric!=='sales_value'&&!Number.isInteger(value.target_value))ctx.addIssue({code:'custom',message:'Metas de quantidade devem usar um número inteiro.'});
});
export const dashboardFilters=z.object({from:z.iso.date(),to:z.iso.date(),team_id:uuid.optional(),seller_user_id:uuid.optional()}).strict().refine(value=>value.from<=value.to,'Período inválido.');
export type CommercialGoal={id:string;target_kind:'seller'|'team';seller_user_id:string|null;team_id:string|null;target_name:string;metric:GoalMetric;period:GoalPeriod;starts_on:string;ends_on:string;target_value:number;actual_value:number;progress:number;version:number;created_at:string;updated_at:string};
export type SellerPerformance={user_id:string;name:string;team_id:string|null;team_name:string|null;leads_received:number;leads_worked:number;customers:number;opportunities_open:number;opportunities_won:number;opportunities_lost:number;contracts:number;sales_value:number;average_ticket:number;tasks_open:number;tasks_completed:number;conversion_rate:number};
