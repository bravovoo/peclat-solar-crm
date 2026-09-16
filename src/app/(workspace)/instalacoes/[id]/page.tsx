import {InstallationDetail} from '@/components/installations/installation-detail';
import {getInstallationDetail} from '@/modules/installations/repository';
import {pageActor} from '@/server/session';

export default async function Page({params}:{params:Promise<{id:string}>}){
 const actor=await pageActor(),{id}=await params,detail=await getInstallationDetail(actor,id);
 return <InstallationDetail initial={detail} canEdit={actor.permissions.includes('installations.edit')} canManage={actor.permissions.includes('installations.manage')}/>;
}
