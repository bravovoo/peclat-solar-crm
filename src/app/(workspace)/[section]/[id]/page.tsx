import { notFound } from 'next/navigation';
import { pageActor } from '@/server/session';
import { sectionKind } from '@/modules/crm/pages';
import { getRecord } from '@/modules/crm/repository';
import { RecordDetail } from '@/components/crm/record-detail';
import { AccessError } from '@/modules/auth/policy';
import { uuid } from '@/modules/crm/domain';
import { whatsappActionAvailability } from '@/modules/whatsapp/repository';
import { whatsappConversationsForRecord } from '@/modules/whatsapp/inbox';
export default async function Page({params}:{params:Promise<{section:string;id:string}>}){const {section,id}=await params;const kind=sectionKind(section);if(!uuid.safeParse(id).success)notFound();const actor=await pageActor();let record;try{record=await getRecord(actor,id);}catch(e){if(e instanceof AccessError&&(e.status===403||e.status===404))notFound();throw e;}if(record.kind!==kind)notFound();const canUseWhatsApp=actor.permissions.includes('whatsapp.use');const [whatsapp,whatsappConversations]=await Promise.all([whatsappActionAvailability(actor,record.whatsapp||record.phone),canUseWhatsApp?whatsappConversationsForRecord(actor,id):Promise.resolve([])]);return <RecordDetail key={record.id} initial={record} actor={actor} whatsappAvailable={whatsapp.available} whatsappConversations={whatsappConversations}/>;}
