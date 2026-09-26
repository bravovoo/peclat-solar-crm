import type {BusinessHours} from '@/modules/automations/domain';


export const recoveryTimezone='America/Sao_Paulo';
export function recoveryHours(hours:Record<string,unknown>):BusinessHours {
 return Object.fromEntries(['1','2','3','4','5','6','7'].map(day=>[day,{enabled:Boolean((hours[day] as {enabled?:boolean}|undefined)?.enabled),start:'10:00',end:'14:00'}])) as BusinessHours;
}
const clock=new Intl.DateTimeFormat('en-US',{timeZone:recoveryTimezone,weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
export function recoveryIsOpen(hours:Record<string,unknown>,now=new Date()) {
 const parts=clock.formatToParts(now),day=({Mon:'1',Tue:'2',Wed:'3',Thu:'4',Fri:'5',Sat:'6',Sun:'7'} as Record<string,string>)[parts.find(p=>p.type==='weekday')!.value];
 const hour=Number(parts.find(p=>p.type==='hour')!.value);
 return Boolean((hours[day] as {enabled?:boolean}|undefined)?.enabled&&hour>=10&&hour<14);
}
export function nextRecoveryWindow(date:Date,hours:Record<string,unknown>):Date {
 if(recoveryIsOpen(hours,date))return date;
 // Walk UTC hours but decide each window exclusively in the configured IANA zone.
 // Bounded to a week; keeps DST/offset handling in Intl rather than hard-coded UTC hours.
 const start=Math.ceil(date.getTime()/3600000)*3600000;
 for(let hour=0;hour<=7*24;hour++){
  const candidate=new Date(start+hour*3600000);
  if(recoveryIsOpen(hours,candidate))return candidate;
 }
 throw new Error('lead_recovery_no_business_day');
}
export function recoveryEligibleAt(anchor:string|Date,days:number) {return new Date(new Date(anchor).getTime()+days*86400000);}
export function recoveryDueAt(anchor:string|Date,days:number,hours:Record<string,unknown>) {return nextRecoveryWindow(recoveryEligibleAt(anchor,days),hours);}
