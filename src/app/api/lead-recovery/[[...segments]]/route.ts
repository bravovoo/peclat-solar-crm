import {NextResponse} from 'next/server';
import {apiActor} from '@/server/session';
import {failure,readMutation} from '@/server/http';
import {AccessError} from '@/modules/auth/policy';
import {operateRecovery,recoveryDashboard,recoveryForRecord,recoveryOptions,recoverySettings,saveRecoveryConsent,saveRecoverySettings,simulateRecovery} from '@/modules/lead-recovery/repository';

type Context={params:Promise<{segments?:string[]}>};
const respond=(value:unknown,status=200)=>NextResponse.json(value,{status,headers:{'Cache-Control':'no-store'}});
async function handle(request:Request,context:Context){try{const actor=await apiActor(),url=new URL(request.url),segments=(await context.params).segments??[],[first,second,third]=segments;if(segments.length>3)throw new AccessError(404,'Recurso não encontrado.');
 if(request.method==='GET'&&!first)return respond(await recoveryDashboard(actor,Object.fromEntries(url.searchParams)));
 if(request.method==='GET'&&first==='settings'&&!second)return respond({...(await recoverySettings(actor)),options:await recoveryOptions(actor)});
 if(request.method==='GET'&&first==='records'&&second&&!third)return respond(await recoveryForRecord(actor,second));
 if(request.method==='POST'&&first==='simulate'&&!second)return respond(await simulateRecovery(actor));
 if(request.method==='PUT'&&first==='settings'&&!second)return respond(await saveRecoverySettings(actor,await readMutation(request)));
 if(request.method==='PUT'&&first==='records'&&second&&third==='consent')return respond(await saveRecoveryConsent(actor,second,await readMutation(request)));
 if(request.method==='POST'&&first==='enrollments'&&second&&!third)return respond(await operateRecovery(actor,second,await readMutation(request)));
 throw new AccessError(404,'Recurso não encontrado.');}catch(error){return failure(error);}}
export const GET=handle;export const POST=handle;export const PUT=handle;
