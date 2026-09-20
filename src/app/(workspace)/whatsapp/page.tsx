import {pageActor} from '@/server/session';
import {listWhatsAppConversations} from '@/modules/whatsapp/inbox';
import {WhatsAppInbox} from '@/components/whatsapp/whatsapp-inbox';
export default async function WhatsAppPage(){const actor=await pageActor();if(!actor.permissions.includes('whatsapp.use'))return <div className="card"><h1>Acesso restrito</h1><p>Seu perfil não tem acesso à caixa de entrada do WhatsApp.</p></div>;return <WhatsAppInbox initial={await listWhatsAppConversations(actor,{})}/>;}
