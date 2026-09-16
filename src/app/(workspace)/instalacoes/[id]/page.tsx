import {InstallationDetail} from '@/components/installations/installation-detail';
import {getInstallationDetail,installationOptions} from '@/modules/installations/repository';
import {pageActor} from '@/server/session';

export default async function Page({params}:{params:Promise<{id:string}>}){
 const actor=await pageActor(),{id}=await params,canEdit=actor.permissions.includes('installations.edit');
 const [detail,options]=await Promise.all([getInstallationDetail(actor,id),canEdit?installationOptions(actor):Promise.resolve({owners:[],contracts:[]})]);
 return <InstallationDetail initial={detail} canEdit={canEdit} canManage={actor.permissions.includes('installations.manage')} canReadPostSales={actor.permissions.includes('post_sales.read')} owners={options.owners}/>;
}
