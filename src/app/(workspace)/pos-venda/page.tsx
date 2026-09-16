import {PostSalesWorkspace} from '@/components/post-sales/workspace';
import {postSalesOptions} from '@/modules/post-sales/repository';
import {pageActor} from '@/server/session';
import {requirePermission} from '@/modules/auth/policy';

export default async function Page(){
 const actor=await pageActor();requirePermission(actor,'post_sales.read');
 return <PostSalesWorkspace options={await postSalesOptions(actor)} userId={actor.userId} canCreate={actor.permissions.includes('post_sales.create')} canManage={actor.permissions.includes('post_sales.manage')}/>;
}
