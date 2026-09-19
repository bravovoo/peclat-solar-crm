import {NextResponse} from 'next/server';
import {apiActor} from '@/server/session';
import {failure,readMutation} from '@/server/http';
import {AccessError} from '@/modules/auth/policy';
import {goalOptions,performanceDashboard,saveGoal} from '@/modules/commercial-goals/repository';

type Context={params:Promise<{segments?:string[]}>};
async function handle(request:Request,context:Context){try{
 const actor=await apiActor(),path=(await context.params).segments??[],respond=(value:unknown,status=200)=>NextResponse.json(value,{status,headers:{'Cache-Control':'no-store'}});
 if(request.method==='GET'&&path.length===0){const url=new URL(request.url);return respond(await performanceDashboard(actor,Object.fromEntries(url.searchParams)));}
 if(request.method==='GET'&&path.length===1&&path[0]==='options')return respond(await goalOptions(actor));
 if(request.method==='POST'&&path.length===0)return respond({id:await saveGoal(actor,await readMutation(request))},201);
 if(request.method==='PUT'&&path.length===1)return respond({id:await saveGoal(actor,await readMutation(request),path[0])});
 throw new AccessError(404,'Recurso não encontrado.');
}catch(error){return failure(error);}}
export const GET=handle;export const POST=handle;export const PUT=handle;
