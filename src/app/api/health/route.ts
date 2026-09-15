import { database } from '@/server/db';
import { NextResponse } from 'next/server';
export async function GET() {
  try { await database().query('SELECT 1'); return NextResponse.json({status:'ok'}, {headers:{'Cache-Control':'no-store'}}); }
  catch { return NextResponse.json({status:'unavailable'}, {status:503}); }
}
