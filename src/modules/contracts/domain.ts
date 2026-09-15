import {z} from 'zod';
import {uuid} from '@/modules/crm/domain';

export const contractStatuses={draft:'Rascunho',sent:'Enviado',negotiation:'Em negociação',signed:'Assinado',active:'Ativo',completed:'Concluído',cancelled:'Cancelado'} as const;
export const paymentMethods={pix:'PIX',boleto:'Boleto',card:'Cartão',transfer:'Transferência',cash:'Dinheiro',financing:'Financiamento',other:'Outro'} as const;
export const contractItemCategories={manual:'Item manual',kit:'Kit solar',equipment:'Equipamento',service:'Serviço',installation:'Instalação',maintenance:'Manutenção',other:'Outro'} as const;
export type ContractStatus=keyof typeof contractStatuses;
export type PaymentMethod=keyof typeof paymentMethods;
export type ContractItemCategory=keyof typeof contractItemCategories;
const money=z.coerce.number().min(0).max(99999999999.99);
const optionalUuid=z.union([uuid,z.literal(''),z.null()]).optional().transform(value=>value||null);
const optionalDate=z.union([z.iso.date(),z.literal(''),z.null()]).optional().transform(value=>value||null);
const text=(max:number)=>z.string().trim().max(max).default('');

export const contractItemSchema=z.object({
 description:z.string().trim().min(2,'Informe a descrição do item.').max(500),category:z.enum(Object.keys(contractItemCategories) as [ContractItemCategory,...ContractItemCategory[]]),
 equipment_id:optionalUuid,kit_id:optionalUuid,quantity:z.coerce.number().positive().max(1000000),unit_value:money,discount_value:money.default(0)
}).strict().superRefine((item,ctx)=>{
 if(item.category==='equipment'&&!item.equipment_id)ctx.addIssue({code:'custom',message:'Selecione o equipamento.',path:['equipment_id']});
 if(item.category==='kit'&&!item.kit_id)ctx.addIssue({code:'custom',message:'Selecione o kit.',path:['kit_id']});
 if(item.equipment_id&&item.kit_id)ctx.addIssue({code:'custom',message:'Vincule somente um item de catálogo.'});
});
export const contractSchema=z.object({
 client_id:uuid,opportunity_id:optionalUuid,responsible_user_id:optionalUuid,title:z.string().trim().min(2,'Informe o título.').max(180),
 items:z.array(contractItemSchema).min(1,'Adicione ao menos um item.').max(500),commercial_discount_value:money.default(0),down_payment_value:money.default(0),
 payment_method:z.enum(Object.keys(paymentMethods) as [PaymentMethod,...PaymentMethod[]]),installments_count:z.coerce.number().int().min(0).max(120),first_due_date:optionalDate,
 start_date:optionalDate,end_date:optionalDate,conditions:text(10000),notes:text(4000),version:z.coerce.number().int().positive().optional()
}).strict().superRefine((data,ctx)=>{
 if(data.end_date&&data.start_date&&data.end_date<data.start_date)ctx.addIssue({code:'custom',message:'A data final deve ser posterior à inicial.',path:['end_date']});
 const calculated=calculateContract(data.items,data.commercial_discount_value,data.down_payment_value);
 if(calculated.netValue<0)ctx.addIssue({code:'custom',message:'O desconto total não pode superar o valor bruto.',path:['commercial_discount_value']});
 if(calculated.balanceValue<0)ctx.addIssue({code:'custom',message:'A entrada não pode superar o valor líquido.',path:['down_payment_value']});
 if(calculated.balanceValue>0&&(!data.installments_count||!data.first_due_date))ctx.addIssue({code:'custom',message:'Informe parcelas e primeiro vencimento para o saldo.',path:['installments_count']});
 if(calculated.balanceValue===0&&(data.installments_count!==0||data.first_due_date))ctx.addIssue({code:'custom',message:'Saldo quitado não deve gerar parcelas.',path:['installments_count']});
});
export const contractStatusSchema=z.object({status:z.enum(Object.keys(contractStatuses) as [ContractStatus,...ContractStatus[]]),version:z.coerce.number().int().positive()}).strict();
export const contractFiltersSchema=z.object({q:z.string().trim().max(120).default(''),status:z.union([z.enum(Object.keys(contractStatuses) as [ContractStatus,...ContractStatus[]]),z.literal('all')]).default('all'),owner:optionalUuid,client_id:optionalUuid,opportunity_id:optionalUuid,from:optionalDate,to:optionalDate,page:z.coerce.number().int().min(1).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(30)}).strict();
export const contractAlertFiltersSchema=z.object({owner:optionalUuid,client_id:optionalUuid,status:z.enum(['all','pending','partially_paid','overdue']).default('all'),from:optionalDate,to:optionalDate}).strict();
export const paymentSchema=z.object({installment_id:uuid,amount:z.coerce.number().positive().max(99999999999.99),paid_at:z.iso.datetime({offset:true}),payment_method:z.enum(Object.keys(paymentMethods) as [PaymentMethod,...PaymentMethod[]]),transaction_reference:text(250),notes:text(2000)}).strict();
export const paymentUpdateSchema=paymentSchema.omit({installment_id:true}).extend({version:z.coerce.number().int().positive()}).strict();

const cents=(value:number)=>Math.round(value*100);
const cash=(value:number)=>value/100;
export function calculateContract(items:z.infer<typeof contractItemSchema>[],commercialDiscount:number,downPayment:number){
 const normalized=items.map((item,index)=>{const gross=Math.round(cents(item.unit_value)*Math.round(item.quantity*1000)/1000);const discount=cents(item.discount_value);if(discount>gross)throw new Error(`O desconto do item ${index+1} supera seu valor bruto.`);return {...item,gross_value:cash(gross),total_value:cash(gross-discount),display_order:index+1};});
 const total=normalized.reduce((sum,item)=>sum+cents(item.gross_value),0),itemDiscount=normalized.reduce((sum,item)=>sum+cents(item.discount_value),0),commercial=cents(commercialDiscount),discount=itemDiscount+commercial,net=total-discount,down=cents(downPayment);
 return {items:normalized,totalValue:cash(total),itemDiscountValue:cash(itemDiscount),commercialDiscountValue:cash(commercial),discountValue:cash(discount),netValue:cash(net),downPaymentValue:cash(down),balanceValue:cash(net-down)};
}

export type ContractItem=z.infer<typeof contractItemSchema>&{id:string;gross_value:number;total_value:number;display_order:number;source_name?:string};
export type ContractInstallment={id:string;installment_number:number;description:string;due_date:string;amount:number;amount_paid:number;remaining_amount:number;status:'pending'|'partially_paid'|'paid'|'overdue'|'cancelled';paid_at:string|null;payment_method:PaymentMethod|null;transaction_reference:string;notes:string;version:number};
export type ContractPayment={id:string;contract_id:string;installment_id:string;installment_number:number;amount:number;paid_at:string;payment_method:PaymentMethod;transaction_reference:string;notes:string;actor_name:string;version:number;created_at:string};
export type Contract={id:string;contract_number:string;client_id:string;client_name:string;client_email:string;opportunity_id:string|null;opportunity_title:string|null;responsible_user_id:string;responsible_name:string;title:string;status:ContractStatus;total_value:number;discount_value:number;item_discount_value:number;commercial_discount_value:number;net_value:number;down_payment_value:number;balance_value:number;payment_method:PaymentMethod;installments_count:number;first_due_date:string|null;start_date:string|null;end_date:string|null;signed_at:string|null;conditions:string;notes:string;is_demo:boolean;version:number;created_at:string;updated_at:string};
export type ContractDetail={contract:Contract;items:ContractItem[];installments:ContractInstallment[];payments:ContractPayment[];history:Array<{id:string;action:string;detail:string;snapshot:unknown;actor_name:string;created_at:string}>};
