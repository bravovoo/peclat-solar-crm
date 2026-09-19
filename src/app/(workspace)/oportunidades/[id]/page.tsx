import {pageActor} from '@/server/session';
import {crmAccess,crmOptions} from '@/modules/crm/repository';
import {getOpportunity} from '@/modules/commercial/repository';
import {OpportunityDetail} from '@/components/commercial/opportunity-detail';
import {notFound} from 'next/navigation';
import {AccessError} from '@/modules/auth/policy';
import {whatsappActionAvailability} from '@/modules/whatsapp/repository';
export default async function Page({params}:{params:Promise<{id:string}>}){const actor=await pageActor();crmAccess(actor);const {id}=await params;let opportunity;try{opportunity=await getOpportunity(actor,id);}catch(e){if(e instanceof AccessError&&e.status===404)notFound();throw e;}const [options,whatsapp]=await Promise.all([crmOptions(actor),whatsappActionAvailability(actor,opportunity.whatsapp_number)]);return <OpportunityDetail initial={opportunity} owners={options.owners} userId={actor.userId} whatsappAvailable={whatsapp.available}/>;}
