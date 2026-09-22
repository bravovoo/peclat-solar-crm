import {AiAssistantSettings} from '@/components/ai/ai-assistant-settings';
import {aiAssistantSettings} from '@/modules/ai/assistant';
import {pageActor} from '@/server/session';
export default async function AiAssistantSettingsPage(){const actor=await pageActor();if(!actor.permissions.includes('ai_assistant.manage'))return <div className="card"><h1>Acesso restrito</h1><p>Somente administradores autorizados podem configurar o assistente.</p></div>;return <AiAssistantSettings initial={await aiAssistantSettings(actor)}/>;}
