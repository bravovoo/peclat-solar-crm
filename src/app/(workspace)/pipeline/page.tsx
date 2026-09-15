import {pageActor} from '@/server/session';
import {crmAccess,crmOptions} from '@/modules/crm/repository';
import {OpportunityBoard} from '@/components/commercial/opportunity-board';
export default async function Page(){const actor=await pageActor();crmAccess(actor);const options=await crmOptions(actor);return <><div className="page-heading"><div><span className="eyebrow blue">OPERAÇÃO COMERCIAL</span><h1>Pipeline comercial</h1><p>Do primeiro contato à próxima conquista.</p></div></div><OpportunityBoard owners={options.owners}/></>;}