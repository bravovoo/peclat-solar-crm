'use client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, Eye, EyeOff, LoaderCircle } from 'lucide-react';
import { loginSchema, passwordSchema, recoverySchema } from '@/modules/auth/validation';
type Mode = 'login' | 'recover' | 'reset';
const resetFormSchema = z.object({ password: passwordSchema });
export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const schema = z.object({organization:z.string(),email:z.string(),password:z.string()}).superRefine((data,context)=>{
    const selected=mode === 'login' ? loginSchema : mode === 'recover' ? recoverySchema : resetFormSchema;
    const result=selected.safeParse(data);
    if(!result.success)for(const issue of result.error.issues)context.addIssue({code:'custom',path:issue.path,message:issue.message});
  });
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(schema), defaultValues: { organization: 'peclat-solar', email: '', password:'' } });
  async function submit(data: Record<string, unknown>) {
    setError('');
    if (mode === 'reset') data.token = window.location.hash.slice(1);
    try {
      const response = await fetch(`/api/auth/${mode}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      const result = await response.json();
      if (!response.ok) { setError(result.error ?? 'Não foi possível continuar.'); return; }
      if (mode === 'login') { router.replace('/'); router.refresh(); }
      else { setSuccess(true); if (mode === 'reset') window.history.replaceState(null, '', '/redefinir-senha'); }
    } catch { setError('Não foi possível conectar. Confira sua conexão e tente novamente.'); }
  }
  if (success) return <div className="success-box" role="status"><h2>{mode === 'reset' ? 'Senha atualizada' : 'Confira seu e-mail'}</h2><p>{mode === 'reset' ? 'Suas sessões anteriores foram encerradas. Entre com a nova senha.' : 'Se os dados corresponderem a uma conta ativa, enviaremos um link para redefinir sua senha.'}</p><Link className="button primary" href="/login">Voltar para o login <ArrowRight size={18}/></Link></div>;
  return <form className="auth-form" onSubmit={handleSubmit(submit)} aria-busy={isSubmitting} noValidate>
    {mode !== 'reset' && <><label htmlFor="organization">Organização</label><input id="organization" autoComplete="organization" autoCapitalize="none" spellCheck={false} {...register('organization')} aria-invalid={!!errors.organization} aria-describedby={errors.organization?'organization-error':'organization-help'}/>{errors.organization ? <small id="organization-error" className="field-error">{String(errors.organization.message)}</small> : <small id="organization-help" className="field-hint">Código de acesso da sua empresa.</small>}
    <label htmlFor="email">E-mail profissional</label><input id="email" type="email" inputMode="email" autoCapitalize="none" spellCheck={false} autoComplete="username" placeholder="voce@peclatsolar.com.br" {...register('email')} aria-invalid={!!errors.email} aria-describedby={errors.email?'email-error':undefined}/>{errors.email && <small id="email-error" className="field-error">{String(errors.email.message)}</small>}</>}
    {mode !== 'recover' && <><label htmlFor="password">{mode === 'reset' ? 'Nova senha' : 'Senha'}</label><div className="password-input"><input id="password" type={showPassword?'text':'password'} autoComplete={mode==='reset'?'new-password':'current-password'} {...register('password')} aria-invalid={!!errors.password} aria-describedby={errors.password?'password-error':mode==='reset'?'password-help':undefined}/><button type="button" aria-controls="password" aria-pressed={showPassword} aria-label={showPassword?'Ocultar senha':'Mostrar senha'} onClick={()=>setShowPassword(!showPassword)}>{showPassword?<EyeOff size={18}/>:<Eye size={18}/>}</button></div>{errors.password && <small id="password-error" className="field-error">{String(errors.password.message)}</small>}</>}
    {mode === 'login' && <Link className="forgot" href="/recuperar-senha">Esqueci minha senha</Link>}
    {mode === 'reset' && <p id="password-help" className="muted">Use uma senha exclusiva com 12 a 128 caracteres.</p>}
    {error && <p className="error-box" role="alert">{error}</p>}
    <button className="button primary" type="submit" disabled={isSubmitting}>{isSubmitting?<><LoaderCircle className="spin" size={18}/> Aguarde…</>:<>{mode==='login'?'Entrar na plataforma':mode==='recover'?'Enviar link de recuperação':'Salvar nova senha'}<ArrowRight size={18}/></>}</button>
    {mode !== 'login' && <Link className="forgot" href="/login">Voltar para o login</Link>}
  </form>;
}
