import { pageActor } from '@/server/session';
import { teamMembers } from '@/modules/core/repository';
export default async function TeamPage(){
  const actor=await pageActor();
  if(!actor.permissions.includes('team.read')) return <div className="card"><h1>Acesso restrito</h1><p>Seu perfil não tem permissão para visualizar a equipe.</p></div>;
  const members=await teamMembers(actor);
  return <><div className="page-heading"><div><span className="eyebrow blue">ORGANIZAÇÃO</span><h1>Pessoas que fazem acontecer.</h1><p>Equipe vinculada à {actor.organizationName}.</p></div></div><section className="card"><div className="card-heading"><h2>Equipe</h2><span className="badge">ATÉ 100 MEMBROS</span></div><div className="table-scroll"><table><thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Status</th></tr></thead><tbody>{members.map(member=><tr key={member.id}><td><strong>{member.name}</strong></td><td>{member.email}</td><td>{member.role}</td><td><span className="badge">{member.active?'Ativo':'Inativo'}</span></td></tr>)}</tbody></table></div><p className="muted table-note">Nesta fase, a equipe é somente para consulta. Cadastro e edição de acessos ainda não estão disponíveis.</p></section></>;
}
