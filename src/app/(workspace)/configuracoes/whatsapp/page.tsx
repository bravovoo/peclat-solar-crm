import {WhatsAppSettings} from '@/components/whatsapp/whatsapp-settings';
import {whatsappAdminConfiguration} from '@/modules/whatsapp/repository';
import {pageActor} from '@/server/session';
export default async function WhatsAppSettingsPage(){const actor=await pageActor();if(actor.role!=='admin'||!actor.permissions.includes('settings.read'))return <div className="card"><h1>Acesso restrito</h1><p>Somente administradores podem configurar o WhatsApp Business.</p></div>;return <WhatsAppSettings initial={await whatsappAdminConfiguration(actor)}/>;}
