import { z } from 'zod';
export const emailSchema = z.string().trim().toLowerCase().email('Informe um e-mail válido.').max(254);
export const organizationSchema = z.string().trim().toLowerCase().regex(/^[a-z0-9-]{2,64}$/, 'Informe o código da organização.');
export const passwordSchema = z.string().min(12, 'Use pelo menos 12 caracteres.').max(128, 'Use até 128 caracteres.');
export const loginSchema = z.object({ organization: organizationSchema, email: emailSchema, password: z.string().min(1, 'Informe sua senha.').max(128) });
export const recoverySchema = loginSchema.omit({ password: true });
export const resetSchema = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/), password: passwordSchema });
