import { z } from 'zod';
import { uuid } from '@/modules/crm/domain';

const text=(max:number)=>z.string().trim().max(max).default('');
const optionalNumber=(max:number)=>z.union([z.number().min(0).max(max),z.null()]).optional().default(null);
const month=z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/,'Informe o mês no formato AAAA-MM.');
const validDate=(value:string)=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const parsed=new Date(value+'T00:00:00Z');return !Number.isNaN(parsed.valueOf())&&parsed.toISOString().slice(0,10)===value;};
const date=z.string().refine(value=>!value||validDate(value),'Data inválida.').default('');

export const supplyTypes={single_phase:'Monofásica',two_phase:'Bifásica',three_phase:'Trifásica',unknown:'Não informada'} as const;
export const tariffFlags={green:'Verde',yellow:'Amarela',red_level_1:'Vermelha patamar 1',red_level_2:'Vermelha patamar 2',not_informed:'Não informada'} as const;

export const sizingSchema=z.object({
 consumer_unit_id:uuid,
 solar_irradiation_daily:z.number().min(1,'A irradiação deve ser de pelo menos 1 kWh/m²/dia.').max(8,'A irradiação deve ser de no máximo 8 kWh/m²/dia.'),
 performance_ratio_percent:z.number().min(50,'O desempenho deve ser de pelo menos 50%.').max(100,'O desempenho não pode superar 100%.'),
 module_power_w:z.number().int().min(100,'A potência do módulo deve ser de pelo menos 100 W.').max(1000,'A potência do módulo deve ser de no máximo 1.000 W.'),
 safety_margin_percent:z.number().min(0,'A margem não pode ser negativa.').max(50,'A margem de segurança deve ser de no máximo 50%.'),
 notes:text(2000)
}).strict();

export const unitSchema=z.object({
 customer_id:uuid,label:z.string().trim().min(2,'Informe um nome para a unidade.').max(120),
 consumer_unit_number:text(80),installation_number:text(80),utility:text(120),holder_name:text(180),
 tariff_group:text(40),supply_type:z.enum(['single_phase','two_phase','three_phase','unknown']).default('unknown'),
 voltage:optionalNumber(1000000),service_address:text(500),version:z.number().int().positive().optional()
}).strict();

export const consumptionSchema=z.object({
 consumer_unit_id:uuid,reference_month:month,consumption_kwh:z.number().min(0,'O consumo não pode ser negativo.').max(100000000),
 injected_energy_kwh:optionalNumber(100000000),peak_demand_kw:optionalNumber(1000000),
 days_billed:z.union([z.number().int().min(1).max(62),z.null()]).optional().default(null),
 source:z.enum(['manual','bill']).default('manual'),notes:text(2000),version:z.number().int().positive().optional()
}).strict();

export const billSchema=z.object({
 consumer_unit_id:uuid,reference_month:month,invoice_number:text(100),issue_date:date,due_date:date,
 total_amount:z.number().min(0,'O valor da fatura não pode ser negativo.').max(1000000000),
 tariff_flag:z.enum(['green','yellow','red_level_1','red_level_2','not_informed']).default('not_informed'),
 previous_reading:optionalNumber(100000000),current_reading:optionalNumber(100000000),notes:text(2000),version:z.number().int().positive().optional()
}).strict().refine(data=>!data.issue_date||!data.due_date||data.due_date>=data.issue_date,{message:'O vencimento não pode ser anterior à emissão.',path:['due_date']})
 .refine(data=>data.previous_reading===null||data.current_reading===null||data.current_reading>=data.previous_reading,{message:'A leitura atual não pode ser menor que a anterior.',path:['current_reading']});

export type EnergyUnit=z.infer<typeof unitSchema>&{id:string;version:number;status:'active'|'archived';is_demo:boolean;created_at:string;updated_at:string;months_count:number;average_kwh:number|null;last_month:string};
export type MonthlyConsumption=z.infer<typeof consumptionSchema>&{id:string;version:number;created_at:string;updated_at:string};
export type EnergyBill=z.infer<typeof billSchema>&{id:string;version:number;created_at:string;updated_at:string};
export type SolarSizing=z.infer<typeof sizingSchema>&{id:string;customer_id:string;actor_id:string;actor_name:string;calculation_version:'v1';consumption_months:number;consumption_period_start:string;consumption_period_end:string;average_consumption_kwh:number;required_generation_kwh:number;required_power_kwp:number;module_count:number;system_power_kwp:number;estimated_monthly_generation_kwh:number;created_at:string};
