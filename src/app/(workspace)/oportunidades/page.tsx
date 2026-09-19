import {pageActor} from '@/server/session';
import {crmAccess,crmOptions} from '@/modules/crm/repository';
import {OpportunityBoard} from '@/components/commercial/opportunity-board';
export default async function Page({searchParams}:{searchParams:Promise<{stage?:string}>}){const actor=await pageActor();crmAccess(actor);const options=await crmOptions(actor);const q=await searchParams;return <><div className="page-heading"><div><span className="eyebrow blue">OPERAÇÃO COMERCIAL</span><h1>Oportunidades</h1><p>Projetos e relacionamentos em evolução.</p></div></div><OpportunityBoard owners={options.owners} teams={options.teams} scope={options.scope} mode="list" initialStage={q.stage}/></>;}
