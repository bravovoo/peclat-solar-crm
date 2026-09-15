import { notFound } from 'next/navigation';
import { pageActor } from '@/server/session';
import { sectionKind } from '@/modules/crm/pages';
import { crmOptions,getRecord } from '@/modules/crm/repository';
import { RecordForm } from '@/components/crm/record-form';
import { AccessError } from '@/modules/auth/policy';
import { uuid } from '@/modules/crm/domain';
export default async function Page({params}:{params:Promise<{section:string;id:string}>}){const {section,id}=await params;const kind=sectionKind(section);if(!uuid.safeParse(id).success)notFound();const actor=await pageActor();let record;try{record=await getRecord(actor,id);}catch(e){if(e instanceof AccessError&&(e.status===403||e.status===404))notFound();throw e;}if(record.kind!==kind)notFound();return <><div className="page-heading"><div><span className="eyebrow blue">ATUALIZAR CADASTRO</span><h1>{record.name}</h1></div></div><section className="card"><RecordForm kind={kind} record={record} options={await crmOptions(actor)} userId={actor.userId}/></section></>;}
