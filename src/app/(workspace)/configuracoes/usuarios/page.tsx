import {UserWorkspace} from '@/components/users/user-workspace';
import {userAdministration} from '@/modules/users/repository';
import {pageActor} from '@/server/session';

export default async function UsersPage(){
 const actor=await pageActor();
 if(!actor.permissions.includes('users.read'))return <div className="card"><h1>Acesso restrito</h1><p>Somente administradores podem visualizar usuários e acessos.</p></div>;
 return <UserWorkspace initial={await userAdministration(actor)}/>;
}
