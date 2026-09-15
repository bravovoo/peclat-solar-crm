import {pageActor} from '@/server/session';
import {crmAccess} from '@/modules/crm/repository';
import {FollowUp} from '@/components/commercial/follow-up';
export default async function Page(){crmAccess(await pageActor());return <><div className="page-heading"><div><span className="eyebrow blue">OPERAÇÃO COMERCIAL</span><h1>Follow-up comercial</h1><p>Saiba quem precisa de atenção hoje.</p></div></div><FollowUp/></>;}