import { NextResponse } from 'next/server';
import { apiActor } from '@/server/session';
import { failure } from '@/server/http';
import { teamMembers } from '@/modules/core/repository';
export async function GET() {
  try { return NextResponse.json({ members: await teamMembers(await apiActor()) }, { headers: {'Cache-Control':'no-store'} }); }
  catch (error) { return failure(error); }
}
