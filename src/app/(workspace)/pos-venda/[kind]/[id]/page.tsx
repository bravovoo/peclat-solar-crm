import {notFound} from 'next/navigation';
import {PostSalesDetail} from '@/components/post-sales/detail';
import {getMaintenance,getTicket,getWarranty,postSalesOptions} from '@/modules/post-sales/repository';
import {AccessError,requirePermission} from '@/modules/auth/policy';
import {pageActor} from '@/server/session';

export default async function Page({params}:{params:Promise<{kind:string;id:string}>}){
 const actor=await pageActor();requirePermission(actor,'post_sales.read');const {kind,id}=await params;
 if(!['chamados','garantias','manutencoes'].includes(kind))notFound();
 const [item,options]=await Promise.all([kind==='chamados'?getTicket(actor,id):kind==='garantias'?getWarranty(actor,id):getMaintenance(actor,id),postSalesOptions(actor)]).catch(error=>{
  if(error instanceof AccessError&&(error.status===403||error.status===404))notFound();
  throw error;
 });
 return <PostSalesDetail kind={kind as 'chamados'|'garantias'|'manutencoes'} initial={item} options={options} userId={actor.userId} canEdit={actor.permissions.includes('post_sales.edit')} canManage={actor.permissions.includes('post_sales.manage')} canUseTasks={actor.permissions.includes('crm.all')||actor.permissions.includes('crm.own')} canNavigateCommercial={actor.permissions.includes('crm.all')||actor.permissions.includes('crm.own')} canNavigateContracts={actor.permissions.includes('contracts.all')||actor.permissions.includes('contracts.own')} canNavigateInstallations={actor.permissions.includes('installations.read')}/>;
}
