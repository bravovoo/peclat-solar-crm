import { NextResponse } from 'next/server';
import { apiActor } from '@/server/session';
import { failure } from '@/server/http';
export async function GET() {
  try { return NextResponse.json(await apiActor(), { headers: {'Cache-Control':'no-store'} }); }
  catch (error) { return failure(error); }
}
