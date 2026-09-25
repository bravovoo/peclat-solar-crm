import {WhatsAppFlowManager} from '@/components/whatsapp/flow-manager';
import {flowManagerOverview} from '@/modules/whatsapp/flow-manager';
import {pageActor} from '@/server/session';
export default async function WhatsAppFlowsPage(){const actor=await pageActor();if(actor.role!=='admin'||!actor.permissions.includes('whatsapp.flows.manage'))return <div className="card"><h1>Acesso restrito</h1><p>Somente administradores podem gerenciar WhatsApp Flows.</p></div>;return <WhatsAppFlowManager initial={await flowManagerOverview(actor)}/>;}
