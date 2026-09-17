import { NextResponse } from 'next/server';
import { apiActor } from '@/server/session';
import { failure, readMutation } from '@/server/http';
import { changeCommercialTeamMember, commercialTeamOverview, saveCommercialTeam } from '@/modules/commercial-teams/repository';
import { AccessError } from '@/modules/auth/policy';

type Context = {params: Promise<{segments?: string[]}>};
async function handle(request: Request, context: Context) {
  try {
    const actor = await apiActor();
    const path = (await context.params).segments ?? [];
    const respond = (value: unknown, status=200) => NextResponse.json(value,{status,headers:{'Cache-Control':'no-store'}});
    if (request.method === 'GET' && path.length === 0) return respond(await commercialTeamOverview(actor));
    if (request.method === 'POST' && path.length === 0) return respond({id:await saveCommercialTeam(actor,await readMutation(request))},201);
    if (request.method === 'PUT' && path.length === 1) return respond({id:await saveCommercialTeam(actor,await readMutation(request),path[0])});
    if (request.method === 'POST' && path.length === 2 && path[1] === 'members')
      return respond(await changeCommercialTeamMember(actor,path[0],await readMutation(request)));
    throw new AccessError(404,'Recurso não encontrado.');
  } catch (error) { return failure(error); }
}
export const GET=handle;
export const POST=handle;
export const PUT=handle;
