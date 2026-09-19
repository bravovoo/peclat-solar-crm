import {pageActor} from '@/server/session';
import {performanceDashboard,goalOptions} from '@/modules/commercial-goals/repository';
import {CommercialPerformance} from '@/components/commercial-goals/workspace';

function month(){const today=new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'}),start=today.slice(0,8)+'01',date=new Date(`${start}T12:00:00Z`);date.setUTCMonth(date.getUTCMonth()+1);date.setUTCDate(0);return {from:start,to:date.toISOString().slice(0,10)};}
export default async function PerformancePage(){const actor=await pageActor();if(!actor.permissions.includes('commercial_goals.read'))return <div className="card"><h1>Acesso restrito</h1><p>Seu perfil não tem acesso ao desempenho comercial.</p></div>;const dates=month();return <CommercialPerformance initial={await performanceDashboard(actor,dates)} options={await goalOptions(actor)}/>;}
