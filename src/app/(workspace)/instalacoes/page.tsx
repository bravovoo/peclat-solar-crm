import {InstallationList} from '@/components/installations/installation-list';
import {pageActor} from '@/server/session';

export default async function Page(){
 const actor=await pageActor();
 if(!actor.permissions.includes('installations.read'))return <div className="card"><h1>Acesso restrito</h1><p>Seu perfil não possui acesso a instalações.</p></div>;
 return <InstallationList canCreate={actor.permissions.includes('installations.create')}/>;
}
