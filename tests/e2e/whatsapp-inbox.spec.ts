import {test,expect,type Page} from '@playwright/test';
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
 test.setTimeout(120000);
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

 const layout=page.getByTestId('whatsapp-layout');
 const history=page.getByTestId('message-history');
 await expect(page.getByTestId('conversation-header')).toBeVisible();
 await expect(page.getByTestId('message-composer')).toBeVisible();
 const layoutBox=await layout.boundingBox();
 expect(layoutBox?.height).toBeLessThanOrEqual(760);
 const initialHistory=await scrollMetrics(page,'message-history');
 expect(initialHistory.scrollHeight).toBeGreaterThan(initialHistory.clientHeight);
 expect(initialHistory.distance).toBeLessThanOrEqual(4);
 const initialList=await scrollMetrics(page,'conversation-list');
 expect(initialList.scrollHeight).toBeGreaterThan(initialList.clientHeight);

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
 await expect(page.getByText('Resposta outbound E2E',{exact:true})).toBeVisible();
 await expect(page.getByText('Enviada',{exact:true})).toBeVisible();
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
 await page.getByRole('button',{name:/Sincronizar modelos/}).click();
 await expect(page.getByRole('status')).toContainText('Modelos aprovados');
 await page.getByLabel('Selecionar modelo aprovado').selectOption({label:'retomar_atendimento · pt_BR'});
 await page.getByLabel('Parâmetro da mensagem 1').fill('João');
 await page.getByRole('button',{name:'Enviar modelo'}).click();
 await expect(page.getByRole('status')).toContainText('Modelo enviado');
 await expect(page.getByText('Olá João, podemos continuar seu atendimento?',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Vincular ao CRM'}).click();
 const dialog=page.getByRole('dialog',{name:'Vincular conversa ao CRM'});
 await dialog.getByLabel('Buscar cadastro existente').fill('Cliente Inbox');
 await dialog.getByRole('button',{name:'Buscar'}).click();
 await dialog.getByRole('button',{name:/Cliente Inbox E2E/}).click();
 await expect(page.getByRole('status')).toContainText('vinculada ao CRM');
 await expect(page.getByRole('link',{name:'Abrir cadastro no CRM'})).toBeVisible();

 for(const size of [{width:390,height:844},{width:1440,height:900}]){
  await page.setViewportSize(size);
  await page.getByLabel('Detalhe da conversa').evaluate(element=>element.scrollIntoView({block:'start'}));
  await page.waitForTimeout(600);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  await expect(page.getByTestId('conversation-header')).toBeVisible();
  await expect(page.getByTestId('message-composer')).toBeVisible();
  if(size.width===1440){const headerBox=await page.getByTestId('conversation-header').boundingBox(),composerBox=await page.getByTestId('message-composer').boundingBox();expect(headerBox?.y).toBeGreaterThanOrEqual(0);expect((composerBox?.y??0)+(composerBox?.height??0)).toBeLessThanOrEqual(size.height+2);}
  await page.screenshot({path:`test-results/whatsapp-inbox-${size.width}.png`,fullPage:false});
 }

 await page.getByRole('link',{name:'Abrir cadastro no CRM'}).click();
 await expect(page.getByRole('heading',{name:'Cliente Inbox E2E'})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Conversas no WhatsApp'})).toBeVisible();
 await expect(page.getByText(/Olá João, podemos continuar seu atendimento/)).toBeVisible();
});
