import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { login, logout, requestRecovery, resetPassword } from '@/modules/auth/service';
import { smtpProvider } from '@/integrations/mail';
import { SESSION_COOKIE } from '@/server/session';
import { appUrl, failure, readMutation } from '@/server/http';
export async function POST(request: Request, context: { params: Promise<{action: string}> }) {
  try {
    const data = await readMutation(request);
    const { action } = await context.params;
    const jar = await cookies();
    if (action === 'login') {
      const token = await login(data);
      // Rotacionar a sessão anterior ao autenticar novamente.
      await logout(jar.get(SESSION_COOKIE)?.value);
      jar.set(SESSION_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV==='production', sameSite: 'lax', path: '/', maxAge: 8*3600 });
    } else if (action === 'logout') {
      await logout(jar.get(SESSION_COOKIE)?.value);
      jar.delete(SESSION_COOKIE);
    } else if (action === 'recover') {
      await requestRecovery(data, smtpProvider(), appUrl());
    } else if (action === 'reset') {
      await resetPassword(data);
      jar.delete(SESSION_COOKIE);
    } else return NextResponse.json({ error: 'Não encontrado.' }, { status: 404 });
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch(error) { return failure(error); }
}
