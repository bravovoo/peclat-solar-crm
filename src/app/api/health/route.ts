import { database } from '@/server/db';
import { NextResponse } from 'next/server';
export async function GET() {
  try {
    const integration=await database().query<{configured:boolean}>("SELECT EXISTS(SELECT 1 FROM whatsapp_integrations WHERE status='connected') configured");
    const storageProvider=process.env.DOCUMENT_STORAGE_PROVIDER?.trim().toLowerCase();
    const storageConfigured=storageProvider==='supabase'?Boolean(process.env.SUPABASE_URL&&process.env.SUPABASE_STORAGE_BUCKET&&(process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY)):storageProvider==='local'&&process.env.NODE_ENV!=='production';
    const whatsappSecrets=Boolean(process.env.WHATSAPP_ACCESS_TOKEN&&process.env.WHATSAPP_VERIFY_TOKEN&&process.env.WHATSAPP_APP_SECRET);
    return NextResponse.json({status:'ok',checks:{application:{status:'ok'},database:{status:'ok'},storage:{configured:storageConfigured},whatsapp:{configured:whatsappSecrets&&integration.rows[0].configured},smtp:{configured:Boolean(process.env.SMTP_HOST)},ai:{configured:Boolean(process.env.GEMINI_API_KEY||process.env.OPENAI_API_KEY),providers:{gemini:Boolean(process.env.GEMINI_API_KEY),openai:Boolean(process.env.OPENAI_API_KEY)}}}}, {headers:{'Cache-Control':'no-store'}});
  }
  catch { return NextResponse.json({status:'unavailable'}, {status:503}); }
}
