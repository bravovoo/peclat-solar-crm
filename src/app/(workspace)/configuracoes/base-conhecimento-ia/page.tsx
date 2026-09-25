import {pageActor} from '@/server/session';
import {knowledgeOverview} from '@/modules/ai/knowledge';
import {KnowledgeWorkspace} from '@/components/ai/knowledge-workspace';
export default async function KnowledgePage(){const actor=await pageActor();if(!actor.permissions.includes('ai_knowledge.manage'))return <div className="card"><h1>Acesso restrito</h1><p>Somente administradores podem gerenciar a base de conhecimento.</p></div>;return <KnowledgeWorkspace initial={await knowledgeOverview(actor)}/>;}
