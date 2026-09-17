import { pageActor } from '@/server/session';
import { commercialTeamOverview } from '@/modules/commercial-teams/repository';
import { CommercialTeamWorkspace } from '@/components/commercial-teams/workspace';

export default async function TeamPage() {
  const actor=await pageActor();
  if (!actor.permissions.includes('commercial_team.read')) return <div className="card"><h1>Acesso restrito</h1><p>Seu perfil não tem acesso à equipe comercial.</p></div>;
  return <CommercialTeamWorkspace initial={await commercialTeamOverview(actor)} />;
}
