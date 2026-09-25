import Link from 'next/link';
import {Activity,ArrowRight,MessageCircle,Sparkles,Users,Workflow} from 'lucide-react';
import {pageActor} from '@/server/session';
import {whatsappAdminConfiguration} from '@/modules/whatsapp/repository';
import {whatsappStatuses} from '@/modules/whatsapp/domain';

export default async function SettingsPage(){
 const actor=await pageActor();
 if(!actor.permissions.includes('settings.read'))return <div className="card"><h1>Acesso restrito</h1><p>Seu perfil não tem permissão para visualizar as configurações.</p></div>;
 const whatsapp=actor.role==='admin'?await whatsappAdminConfiguration(actor):null;
 return <><div className="page-heading"><div><span className="eyebrow blue">ORGANIZAÇÃO</span><h1>Seu ambiente de trabalho.</h1><p>Informações da organização e disponibilidade das integrações.</p></div></div>
  {actor.permissions.includes('users.read')&&<Link className="card settings-users-link" href="/configuracoes/usuarios"><span><Users size={22}/></span><div><h2>Usuários e acessos</h2><p>Cadastre membros, defina funções, ative ou suspenda acessos.</p></div><ArrowRight size={19}/></Link>}
  <div className="settings-grid">
   <section className="card"><h2>Organização</h2><dl><dt>Nome</dt><dd>{actor.organizationName}</dd><dt>Código de acesso</dt><dd>{actor.organizationSlug}</dd><dt>Seu perfil</dt><dd>{actor.roleName}</dd><dt>Fuso de exibição</dt><dd>Brasília · America/Sao_Paulo</dd></dl></section>
   {whatsapp&&<Link className="card settings-integration-link" href="/configuracoes/whatsapp"><div className="integration-heading"><MessageCircle size={22}/><div><h2>WhatsApp Business</h2><span className="badge">{whatsappStatuses[whatsapp.status]}</span></div></div><p className="muted">Configure somente os identificadores seguros da conta Meta. Tokens permanecem no ambiente protegido do servidor.</p><span className="text-link">Abrir configuração <ArrowRight size={17}/></span></Link>}
   {actor.permissions.includes('automations.read')&&<Link className="card settings-integration-link" href="/configuracoes/automacoes"><div className="integration-heading"><Workflow size={22}/><div><h2>Automações comerciais</h2><span className="badge">Seguras por padrão</span></div></div><p className="muted">Configure regras, horário comercial, distribuição e acompanhe cada execução.</p><span className="text-link">Abrir automações <ArrowRight size={17}/></span></Link>}
   {actor.permissions.includes('ai_assistant.manage')&&<Link className="card settings-integration-link" href="/configuracoes/assistente-ia"><div className="integration-heading"><Sparkles size={22}/><div><h2>Assistente Comercial com IA</h2><span className="badge">Revisão humana</span></div></div><p className="muted">Ative sugestões sob demanda, defina limites e mantenha o envio sob controle do vendedor.</p><span className="text-link">Abrir configuração <ArrowRight size={17}/></span></Link>}
   {actor.permissions.includes('ai_knowledge.manage')&&<Link className="card settings-integration-link" href="/configuracoes/base-conhecimento-ia"><div className="integration-heading"><Sparkles size={22}/><div><h2>Base de Conhecimento da IA</h2><span className="badge">Aprovação administrativa</span></div></div><p className="muted">Cadastre respostas oficiais, revise sugestões e teste perguntas sem enviar mensagens.</p><span className="text-link">Abrir base <ArrowRight size={17}/></span></Link>}
   {actor.permissions.includes('operations.read')&&<Link className="card settings-integration-link" href="/configuracoes/monitoramento"><div className="integration-heading"><Activity size={22}/><div><h2>Monitoramento operacional</h2><span className="badge">Verificação a cada 5 minutos</span></div></div><p className="muted">Acompanhe integrações, filas persistentes e incidentes sem expor dados ou credenciais.</p><span className="text-link">Abrir monitoramento <ArrowRight size={17}/></span></Link>}
   <section className="card"><h2>Recuperação de senha</h2><p className="muted">{process.env.SMTP_HOST?'Transporte de e-mail configurado. A entrega depende da disponibilidade do servidor.':'Transporte de e-mail ainda não configurado.'}</p></section>
  </div>
 </>;
}
