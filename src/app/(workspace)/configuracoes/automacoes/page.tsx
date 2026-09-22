import {AutomationWorkspace} from '@/components/automations/automation-workspace';
import {automationOptions,automationSettings,listAutomationRules,listAutomationRuns} from '@/modules/automations/repository';
import {pageActor} from '@/server/session';
export default async function AutomationsPage(){const actor=await pageActor();if(!actor.permissions.includes('automations.read'))return <div className="card"><h1>Acesso restrito</h1><p>Seu perfil não pode visualizar automações comerciais.</p></div>;return <AutomationWorkspace initial={{rules:await listAutomationRules(actor),settings:await automationSettings(actor),options:await automationOptions(actor),runs:(await listAutomationRuns(actor)).items}} canManage={actor.permissions.includes('automations.manage')} admin={actor.role==='admin'}/>;}
