import {RecoveryWorkspace} from '@/components/lead-recovery/recovery-workspace';
import {pageActor} from '@/server/session';
import {recoveryDashboard,recoveryOptions,recoverySettings} from '@/modules/lead-recovery/repository';
export default async function LeadRecoveryPage(){const actor=await pageActor();if(!actor.permissions.includes('lead_recovery.read'))return <div className="card"><h1>Acesso restrito</h1><p>Seu perfil não pode visualizar a recuperação de leads.</p></div>;return <RecoveryWorkspace initial={{dashboard:await recoveryDashboard(actor),configuration:{...(await recoverySettings(actor)),options:await recoveryOptions(actor)}}} canManage={actor.permissions.includes('lead_recovery.manage')} canOperate={actor.permissions.includes('lead_recovery.operate')}/>;}
