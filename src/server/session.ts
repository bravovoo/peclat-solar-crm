import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { sessionActor } from '../modules/auth/service';
import { AccessError } from '../modules/auth/policy';
export const SESSION_COOKIE = 'peclat_session';
export async function currentActor() { return sessionActor((await cookies()).get(SESSION_COOKIE)?.value); }
export async function pageActor() { const actor=await currentActor(); if (!actor) redirect('/login'); return actor; }
export async function apiActor() { const actor=await currentActor(); if (!actor) throw new AccessError(401, 'Entre na sua conta para continuar.'); return actor; }
