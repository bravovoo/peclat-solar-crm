import { pageActor } from '@/server/session';
import { sectionKind } from '@/modules/crm/pages';
import { crmOptions } from '@/modules/crm/repository';
import { RecordForm } from '@/components/crm/record-form';
export default async function Page({params}:{params:Promise<{section:string}>}){const kind=sectionKind((await params).section);const actor=await pageActor();if(!actor.permissions.some(p=>p==='crm.all'||p==='crm.own'))return <div className="card"><h1>Acesso restrito</h1></div>;return <><div className="page-heading"><div><span className="eyebrow blue">UM NOVO RELACIONAMENTO</span><h1>{kind==='lead'?'Novo lead':kind==='customer'?'Novo cliente':'Nova empresa'}</h1></div></div><section className="card"><RecordForm kind={kind} options={await crmOptions(actor)} userId={actor.userId}/></section></>;}
