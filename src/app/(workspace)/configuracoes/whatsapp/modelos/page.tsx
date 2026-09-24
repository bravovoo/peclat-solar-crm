import {WhatsAppTemplateManager} from '@/components/whatsapp/template-manager';
import {templateManagerOverview} from '@/modules/whatsapp/template-manager';
import {pageActor} from '@/server/session';
export default async function WhatsAppTemplateManagerPage(){const actor=await pageActor();if(actor.role!=='admin'||!actor.permissions.includes('whatsapp.templates.manage'))return <div className="card"><h1>Acesso restrito</h1><p>Somente administradores podem gerenciar modelos oficiais.</p></div>;return <WhatsAppTemplateManager initial={await templateManagerOverview(actor)}/>;}
