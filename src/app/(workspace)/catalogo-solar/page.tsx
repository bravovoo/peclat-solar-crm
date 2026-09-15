import { CatalogWorkspace } from '@/components/solar-catalog/catalog-workspace';
import { pageActor } from '@/server/session';
export default async function SolarCatalogPage(){const actor=await pageActor();const commercial=actor.permissions.includes('crm.all')||actor.permissions.includes('crm.own');if(!commercial)return <div className="card"><h1>Acesso restrito</h1><p>Seu perfil não tem acesso ao catálogo solar.</p></div>;return <CatalogWorkspace canManage={actor.permissions.includes('solar.catalog.manage')}/>;}
