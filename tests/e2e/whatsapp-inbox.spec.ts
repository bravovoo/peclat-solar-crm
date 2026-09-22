import {test,expect,request as playwrightRequest,type Page} from '@playwright/test';
import {createHmac} from 'node:crypto';

const password='Peclat teste seguro 2026';

async function login(page:Page){
 await page.goto('/login');
 await page.getByLabel('E-mail profissional').fill('whatsapp@e2e.local');
 await page.getByLabel('Senha',{exact:true}).fill(password);
 await page.getByRole('button',{name:'Entrar na plataforma'}).click();
 await expect(page).toHaveURL(new RegExp('/$'));
}

async function receiveText(page:Page,id:string,text:string){
 const payload=JSON.stringify({object:'whatsapp_business_account',entry:[{id:'200000000001',changes:[{field:'messages',value:{metadata:{phone_number_id:'100000000001'},messages:[{from:'5531991112233',id,timestamp:String(Math.floor(Date.now()/1000)),type:'text',text:{body:text}}]}}]}]});
 const signature='sha256='+createHmac('sha256','e2e-fake-app-secret').update(payload).digest('hex');
 return page.request.post('/api/whatsapp/webhook',{data:payload,headers:{'content-type':'application/json','x-hub-signature-256':signature}});
}

async function scrollMetrics(page:Page,testId:string){
 return page.getByTestId(testId).evaluate(element=>({clientHeight:element.clientHeight,scrollHeight:element.scrollHeight,scrollTop:element.scrollTop,distance:element.scrollHeight-element.scrollTop-element.clientHeight}));
}

test('inbox mantém layout estável, rolagem inteligente, envio e vínculo responsivos',async({page})=>{
 test.setTimeout(180000);
 expect((await page.request.get('/api/whatsapp/conversations')).status()).toBe(401);
 expect((await receiveText(page,'wamid.e2e.reconnect','Evento E2E autenticado')).status()).toBe(200);

 await page.setViewportSize({width:1440,height:900});
 await login(page);
 await page.getByRole('link',{name:'WhatsApp',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Caixa de entrada'})).toBeVisible();
 await expect(page.getByText('ATENDIMENTO ATIVO')).toBeVisible();
 await expect(page.getByText('Preciso acompanhar meu projeto',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:/Marcar como lida/})).toBeVisible();
 await expect(page.getByText(/Janela aberta até/)).toBeVisible();
 await expect(page.getByTestId('contact-info')).toBeVisible();
 const audio=page.getByTestId('message-history').locator('audio');await expect(audio).toHaveCount(1);
 const audioUrl=await audio.getAttribute('src');expect(audioUrl).toMatch(/\/api\/whatsapp\/conversations\/[^/]+\/messages\/[^/]+\/media/);
 expect((await page.request.get(audioUrl!)).status()).toBe(200);
 const anonymous=await playwrightRequest.newContext({baseURL:'http://localhost:3100'});expect((await anonymous.get(audioUrl!)).status()).toBe(401);await anonymous.dispose();
 const partial=await page.request.get(audioUrl!,{headers:{range:'bytes=0-2'}});expect(partial.status()).toBe(206);expect(partial.headers()['content-range']).toBe('bytes 0-2/8');
 await expect(page.getByRole('link',{name:'fatura.pdf'})).toHaveCount(1);
 const pdfUrl=await page.getByRole('link',{name:'fatura.pdf'}).getAttribute('href');const pdf=await page.request.get(pdfUrl!);expect(pdf.status()).toBe(200);expect(pdf.headers()['content-disposition']).toContain('attachment');
 await expect(page.getByRole('img',{name:'Painel instalado'})).toHaveCount(1);
 await expect(page.getByRole('link',{name:'Ampliar imagem'})).toHaveCount(1);
 const conversationId=audioUrl!.split('/')[4],detailResponse=await page.request.get(`/api/whatsapp/conversations/${conversationId}`),detailJson=await detailResponse.json() as {messages:{id:string;media_id:string}[]};
 const expired=detailJson.messages.find(message=>message.media_id==='e2e-expired');expect(expired).toBeTruthy();
 expect((await page.request.get(`/api/whatsapp/conversations/${conversationId}/messages/${expired!.id}/media`)).status()).toBe(404);
 const expiredBubble=page.locator(`[data-message-id="${expired!.id}"]`);await expiredBubble.scrollIntoViewIfNeeded();await expect(expiredBubble.getByText('Mídia não está mais disponível.')).toBeVisible();
 await page.getByTestId('message-history').evaluate(element=>element.scrollTo({top:element.scrollHeight}));

 const layout=page.getByTestId('whatsapp-layout');
 const history=page.getByTestId('message-history');
 await expect(page.getByTestId('conversation-header')).toBeVisible();
 await expect(page.getByTestId('message-composer')).toBeVisible();
 const layoutBox=await layout.boundingBox();
 expect(layoutBox?.height).toBeGreaterThan(650);
 expect(layoutBox?.y).toBeLessThan(180);
 await expect.poll(async()=>(await scrollMetrics(page,'message-history')).distance).toBeLessThanOrEqual(4);
 const initialHistory=await scrollMetrics(page,'message-history');
 expect(initialHistory.scrollHeight).toBeGreaterThan(initialHistory.clientHeight);
 const initialList=await scrollMetrics(page,'conversation-list');
 expect(initialList.scrollHeight).toBeGreaterThan(initialList.clientHeight);
 await page.screenshot({path:'test-results/whatsapp-inbox-active-1440.png',fullPage:false});
 await page.setViewportSize({width:390,height:844});
 await expect(page.getByTestId('conversation-list')).toBeVisible();
 await page.getByRole('button',{name:/Cliente Inbox E2E/}).click();
 await expect(page.getByTestId('message-composer')).toBeVisible();
 await expect(page.getByTestId('message-history').locator('audio')).toHaveCount(1);
 await expect(page.getByRole('link',{name:'fatura.pdf'})).toHaveCount(1);
 await page.getByLabel('Anexar imagem ou PDF').setInputFiles({name:'painel.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL1GQAAAABJRU5ErkJggg==','base64')});
 await expect(page.getByRole('img',{name:'Prévia do anexo'})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
 await page.getByRole('button',{name:'Remover anexo'}).click();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
 await page.getByRole('button',{name:'Informações do contato'}).click();
 await expect(page.getByTestId('contact-info')).toBeVisible();
 await page.getByRole('button',{name:'Fechar informações'}).first().click();
 await expect(page.getByTestId('contact-info')).toBeHidden();
 await page.screenshot({path:'test-results/whatsapp-inbox-active-390.png',fullPage:false});
 await page.setViewportSize({width:1440,height:900});

 await history.evaluate(element=>element.scrollTo({top:0}));
 await expect.poll(async()=>(await scrollMetrics(page,'message-history')).scrollTop).toBeLessThan(20);
 const newInbound='Nova mensagem sem interromper a leitura';
 expect((await receiveText(page,`wamid.e2e.scroll.${Date.now()}`,newInbound)).status()).toBe(200);
 await expect(page.getByRole('button',{name:'Novas mensagens ↓'})).toBeVisible({timeout:20000});
 expect((await scrollMetrics(page,'message-history')).scrollTop).toBeLessThan(20);
 await page.getByRole('button',{name:'Novas mensagens ↓'}).click();
 await expect.poll(async()=>(await scrollMetrics(page,'message-history')).distance).toBeLessThanOrEqual(4);
 await expect(page.getByText(newInbound,{exact:true})).toBeVisible();

 await page.getByLabel('Mensagem de WhatsApp').fill('Resposta outbound E2E');
 await page.getByRole('button',{name:'Enviar',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('Mensagem enviada');
 await expect(history.getByText('Resposta outbound E2E',{exact:true})).toBeVisible();
 await expect(page.getByText('Enviada',{exact:true})).toBeVisible();
 await page.getByLabel('Anexar imagem ou PDF').setInputFiles({name:'painel.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL1GQAAAABJRU5ErkJggg==','base64')});
 await expect(page.getByRole('img',{name:'Prévia do anexo'})).toBeVisible();
 await page.getByLabel('Legenda do anexo').fill('Painel enviado no teste');
 await page.getByRole('button',{name:'Enviar anexo'}).click();
 await expect(page.getByRole('status')).toContainText('Anexo enviado');
 await expect(history.getByText('Painel enviado no teste')).toBeVisible();
 await page.getByLabel('Anexar imagem ou PDF').setInputFiles({name:'remover.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\n%%EOF')});
 await page.getByRole('button',{name:'Remover anexo'}).click();await expect(page.getByText('remover.pdf')).toHaveCount(0);
 await page.getByLabel('Anexar imagem ou PDF').setInputFiles({name:'orcamento.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\n%%EOF')});
 await page.getByRole('button',{name:'Enviar anexo'}).click();
 await expect(page.getByRole('status')).toContainText('Anexo enviado');
 await expect(history.getByRole('link',{name:'orcamento.pdf'})).toBeVisible();
 await expect.poll(async()=>(await scrollMetrics(page,'message-history')).distance).toBeLessThanOrEqual(4);
 await page.getByRole('button',{name:/Marcar como lida/}).click();
 await expect(page.getByRole('status')).toContainText('marcada como lida');

 await page.getByLabel('Filtrar vínculo').selectOption('unlinked');
 await page.getByRole('button',{name:'Aplicar filtros'}).click();
 await expect(page.getByText('Novo contato',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:/Novo contato/}).click();
 await expect(page.getByText(/Janela de atendimento encerrada/)).toBeVisible();
 const shortHistory=await scrollMetrics(page,'message-history');
 expect(shortHistory.scrollHeight-shortHistory.clientHeight).toBeLessThanOrEqual(4);
 await page.getByRole('button',{name:'Criar Lead',exact:true}).click();
 const leadDialog=page.getByRole('dialog',{name:'Criar Lead pelo WhatsApp'});
 await expect(leadDialog.getByLabel('Nome *')).toHaveValue('Novo contato');
 await expect(leadDialog.getByLabel('Telefone da conversa')).toHaveValue('+5531982223344');
 await expect(leadDialog.getByLabel('Telefone da conversa')).not.toBeEditable();
 await expect(leadDialog.getByLabel('Origem')).toHaveValue('WhatsApp');
 await leadDialog.getByLabel('Nome *').fill('Lead Inbox E2E');
 await leadDialog.getByLabel('Residencial E2E').check();
 await leadDialog.getByLabel('Observação').fill('Criado manualmente pela inbox.');
 await leadDialog.getByRole('button',{name:'Criar Lead',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('Lead criado e conversa vinculada');
 await expect(page.getByRole('link',{name:'Ver Lead'})).toBeVisible();
 await expect(page.getByRole('button',{name:'Criar Lead',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:/Sincronizar modelos/}).click();
 await expect(page.getByRole('status')).toContainText('Modelos aprovados');
 await page.getByLabel('Selecionar modelo aprovado').selectOption({label:'retomar_atendimento · pt_BR'});
 await page.getByLabel('Parâmetro da mensagem 1').fill('João');
 await page.getByRole('button',{name:'Enviar modelo'}).click();
 await expect(page.getByRole('status')).toContainText('Modelo enviado');
 await expect(history.getByText('Olá João, podemos continuar seu atendimento?',{exact:true})).toBeVisible();
 await page.reload();
 await page.getByLabel('Buscar conversas').fill('5531982223344');
 await page.getByRole('button',{name:'Aplicar filtros'}).click();
 await page.getByRole('button',{name:/Lead Inbox E2E/}).click();
 await expect(page.getByRole('link',{name:'Ver Lead'})).toBeVisible();

 await page.getByLabel('Buscar conversas').fill('5531983334455');
 await page.getByLabel('Filtrar vínculo').selectOption('unlinked');
 await page.getByRole('button',{name:'Aplicar filtros'}).click();
 await page.getByRole('button',{name:/Cadastro duplicado/}).click();
 await page.getByRole('button',{name:'Criar Lead',exact:true}).click();
 const duplicateDialog=page.getByRole('dialog',{name:'Criar Lead pelo WhatsApp'});
 await duplicateDialog.getByRole('button',{name:'Criar Lead',exact:true}).click();
 await expect(duplicateDialog.getByRole('alert')).toContainText('já pertence a um cadastro existente');
 await duplicateDialog.getByRole('button',{name:/Vincular a Cliente duplicidade E2E/}).click();
 await expect(page.getByRole('status')).toContainText('vinculada ao CRM');
 await expect(page.getByRole('link',{name:'Ver Cliente'})).toBeVisible();

 for(const size of [{width:390,height:844},{width:1024,height:768},{width:1440,height:900},{width:1920,height:1080}]){
  await page.setViewportSize(size);
  await page.waitForTimeout(600);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  if(size.width===390){
   await page.getByRole('button',{name:'Voltar para conversas'}).click();
   await expect(page.getByTestId('conversation-list')).toBeVisible();
   await page.getByRole('button',{name:/Cliente duplicidade E2E/}).click();
   await page.getByRole('button',{name:'Informações do contato'}).click();
   await expect(page.getByTestId('contact-info')).toBeVisible();
   await page.getByRole('button',{name:'Fechar informações'}).first().click();
   await expect(page.getByTestId('contact-info')).toBeHidden();
  }
  await expect(page.getByTestId('conversation-header')).toBeVisible();
  await expect(page.getByTestId('message-composer')).toBeVisible();
  if(size.width>390){const headerBox=await page.getByTestId('conversation-header').boundingBox(),composerBox=await page.getByTestId('message-composer').boundingBox();expect(headerBox?.y).toBeLessThan(210);expect((composerBox?.y??0)+(composerBox?.height??0)).toBeLessThanOrEqual(size.height+2);}
  if(size.width===1024){await expect(page.getByTestId('conversation-list')).toBeVisible();await expect(page.getByTestId('contact-info')).toBeHidden();await page.getByRole('button',{name:'Informações do contato'}).click();await expect(page.getByTestId('contact-info')).toBeVisible();await page.getByRole('button',{name:'Fechar informações'}).first().click();await expect(page.getByTestId('contact-info')).toBeHidden();}
  if(size.width>=1440)await expect(page.getByTestId('contact-info')).toBeVisible();
  await page.screenshot({path:`test-results/whatsapp-inbox-${size.width}.png`,fullPage:false});
 }

 await page.getByLabel('Buscar conversas').fill('5531982223344');
 await page.getByLabel('Filtrar vínculo').selectOption('all');
 await page.getByRole('button',{name:'Aplicar filtros'}).click();
 await page.getByRole('button',{name:/Lead Inbox E2E/}).click();
 await page.getByRole('link',{name:'Ver Lead'}).click();
 await expect(page.getByRole('heading',{name:'Lead Inbox E2E'})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Conversas no WhatsApp'})).toBeVisible();
 await expect(page.locator('.crm-tag').filter({hasText:/^WhatsApp$/})).toBeVisible();
 await expect(page.locator('.crm-tag').filter({hasText:/^Residencial E2E$/})).toBeVisible();
 await expect(page.getByText(/Olá João, podemos continuar seu atendimento/)).toBeVisible();
});
