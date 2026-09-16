import {InstallationForm} from '@/components/installations/installation-form';
import {getInstallationDetail,installationOptions} from '@/modules/installations/repository';
import {requirePermission} from '@/modules/auth/policy';
import {pageActor} from '@/server/session';

export default async function Page({params}:{params:Promise<{id:string}>}){
 const actor=await pageActor();requirePermission(actor,'installations.edit');
 const {id}=await params,[detail,options]=await Promise.all([getInstallationDetail(actor,id),installationOptions(actor)]);
 return <><div className="page-heading"><div><span className="eyebrow green">{detail.installation.installation_number}</span><h1>Editar instalação</h1></div></div><section className="card"><InstallationForm options={options} initial={detail.installation} userId={actor.userId} canReassign={actor.permissions.includes('installations.manage')}/></section></>;
}
