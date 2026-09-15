import { AuthLayout } from '@/components/auth-layout';
import { AuthForm } from '@/components/auth-form';
export default function ResetPage() {
  return <AuthLayout><span className="eyebrow blue">NOVO COMEÇO</span><h1>Crie sua nova senha.</h1><p className="auth-description">Depois de salvar, entre novamente na plataforma.</p><AuthForm mode="reset"/></AuthLayout>;
}
