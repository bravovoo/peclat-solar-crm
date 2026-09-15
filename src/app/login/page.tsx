import { AuthLayout } from '@/components/auth-layout';
import { AuthForm } from '@/components/auth-form';
export default function LoginPage() {
  return <AuthLayout><span className="eyebrow blue">SEU ESPAÇO DE TRABALHO</span><h1>Bem-vindo de volta.</h1><p className="auth-description">Entre para acompanhar a jornada dos seus clientes.</p><AuthForm mode="login"/></AuthLayout>;
}
