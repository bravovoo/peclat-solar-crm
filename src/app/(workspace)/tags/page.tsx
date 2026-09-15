import { pageActor } from '@/server/session';
import { crmOptions } from '@/modules/crm/repository';
import { TagManager } from '@/components/crm/tag-manager';
export default async function Page(){const actor=await pageActor();if(!actor.permissions.includes('crm.tags.manage'))return <section className="card"><h1>Acesso restrito</h1><p>A configuração de tags é exclusiva do administrador.</p></section>;return <TagManager initial={(await crmOptions(actor)).tags}/>;}
