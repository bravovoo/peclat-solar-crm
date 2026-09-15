import nodemailer from 'nodemailer';
export interface MailProvider { sendRecovery(to: string, url: string): Promise<void>; }
export interface DocumentMailProvider {sendDocument(input:{to:string;subject:string;message:string;filename:string;content:Uint8Array}):Promise<{messageId:string}>;}
export class MailConfigurationError extends Error{constructor(){super('SMTP não configurado');this.name='MailConfigurationError';}}
export function smtpProvider(): MailProvider&DocumentMailProvider {
  const host = process.env.SMTP_HOST;
  if (!host) throw new MailConfigurationError();
  const transport = nodemailer.createTransport({
    host, port: Number(process.env.SMTP_PORT ?? 1025), secure: process.env.SMTP_SECURE === 'true',
    connectionTimeout: 5000, socketTimeout: 10000,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
  });
  return { async sendRecovery(to, url) {
    await transport.sendMail({ from: process.env.MAIL_FROM ?? 'Peclat Solar <crm@peclat.local>', to,
      subject: 'Redefinir sua senha • Peclat Solar',
      text: `Para redefinir sua senha, abra este link em até 30 minutos:\n${url}\n\nSe não solicitou, ignore esta mensagem.` });
  },async sendDocument(input){const result=await transport.sendMail({from:process.env.MAIL_FROM??'Peclat Solar <crm@peclat.local>',to:input.to,subject:input.subject,text:input.message,attachments:[{filename:input.filename,content:Buffer.from(input.content),contentType:'application/pdf'}]});return {messageId:String(result.messageId??'')};} } as MailProvider&DocumentMailProvider;
}
