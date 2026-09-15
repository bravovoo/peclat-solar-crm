import { pageActor } from '@/server/session';
import { sectionKind } from '@/modules/crm/pages';
import { crmOptions } from '@/modules/crm/repository';
import { RecordList } from '@/components/crm/record-list';
export default async function Page({params}:{params:Promise<{section:string}>}){const kind=sectionKind((await params).section);const actor=await pageActor();if(!actor.permissions.some(p=>p==='crm.all'||p==='crm.own'))return <div className="card"><h1>Acesso restrito</h1><p>Seu perfil não tem acesso aos cadastros comerciais.</p></div>;return <RecordList kind={kind} options={await crmOptions(actor)}/>;}
