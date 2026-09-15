import { AuthLayout } from '@/components/auth-layout';
import { AuthForm } from '@/components/auth-form';
export default function RecoveryPage() {
  return <AuthLayout><span className="eyebrow blue">RECUPERAR ACESSO</span><h1>Vamos ajudar você.</h1><p className="auth-description">Informe sua organização e e-mail para receber um link de recuperação.</p><AuthForm mode="recover"/></AuthLayout>;
}
