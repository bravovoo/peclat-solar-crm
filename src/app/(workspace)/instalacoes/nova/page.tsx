import {InstallationForm} from '@/components/installations/installation-form';
import {installationOptions} from '@/modules/installations/repository';
import {pageActor} from '@/server/session';
import {AccessError,requirePermission} from '@/modules/auth/policy';

export default async function Page({searchParams}:{searchParams:Promise<{contract_id?:string}>}){
 const actor=await pageActor();requirePermission(actor,'installations.create');
 const {contract_id}=await searchParams,options=await installationOptions(actor);
 if(contract_id&&!options.contracts.some(contract=>contract.id===contract_id))throw new AccessError(404,'Contrato indisponível para instalação.');
 return <><div className="page-heading"><div><span className="eyebrow green">EXECUÇÃO SOLAR</span><h1>Nova instalação</h1><p>Inicie a execução de um contrato fechado.</p></div></div><section className="card"><InstallationForm options={options} contractId={contract_id} userId={actor.userId} canReassign={actor.permissions.includes('installations.manage')}/></section></>;
}
