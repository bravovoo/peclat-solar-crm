import {test,expect,type Page} from '@playwright/test';

const password='Peclat teste seguro 2026';
const origin='http://localhost:3100';
async function login(page:Page,email:string){
 await page.goto('/login');
 await page.getByLabel('E-mail profissional').fill(email);
 await page.getByLabel('Senha',{exact:true}).fill(password);
 await page.getByRole('button',{name:'Entrar na plataforma'}).click();
 await expect(page).toHaveURL(/\/$/);
}

test('admin cria, simula, ativa e desativa regra sem executar ação externa',async({page,browser})=>{
 test.setTimeout(90000);
 await page.setViewportSize({width:1440,height:900});
 await login(page,'automations@e2e.local');
 await page.goto('/configuracoes/automacoes');
 await expect(page.getByRole('heading',{name:'Automações comerciais'})).toBeVisible();
 await expect(page.getByText('Novas regras começam desativadas.')).toBeVisible();
 await page.getByLabel('Nome',{exact:true}).fill('Atendimento E2E');
 await page.getByLabel('Quando').selectOption('lead.created');
 await page.getByLabel('Título da tarefa').fill('Revisar novo Lead E2E');
 await expect(page.getByText(/Quando novo lead/)).toBeVisible();
 const createdResponse=page.waitForResponse(response=>response.url().endsWith('/api/automations')&&response.request().method()==='POST');
 await page.getByRole('button',{name:'Salvar regra'}).click();
 const created=await (await createdResponse).json() as {id:string;organization_id:string;created_by:string;updated_by:string;created_at:string;updated_at:string};
 await expect(page.getByRole('status')).toContainText('Automação criada desativada');
 const card=page.locator('.automation-rule').filter({hasText:'Atendimento E2E'});
 await expect(card.getByText('Desativada')).toBeVisible();
 await card.getByRole('button',{name:'Editar'}).click();
 await page.getByLabel('Nome',{exact:true}).fill('Atendimento E2E editado');
 await page.getByRole('button',{name:'Simular'}).click();
 await expect(page.getByText(/Nenhuma ação externa foi realizada/)).toBeVisible();
 const updateRequest=page.waitForRequest(request=>request.method()==='PUT'&&request.url().endsWith(`/api/automations/${created.id}`));
 await page.getByRole('button',{name:'Salvar regra'}).click();
 const updatePayload=(await updateRequest).postDataJSON() as Record<string,unknown>;
 await expect(card.getByRole('heading',{name:'Atendimento E2E editado'})).toBeVisible();
 const allowed=['name','description','active','trigger_type','conditions','actions','priority','cooldown_minutes','version'];
 expect(Object.keys(updatePayload).sort()).toEqual(allowed.sort());
 for(const [field,value] of Object.entries({id:'00000000-0000-4000-8000-000000000001',organization_id:'00000000-0000-4000-8000-000000000002',created_by:'00000000-0000-4000-8000-000000000003',updated_by:'00000000-0000-4000-8000-000000000004',created_at:'2000-01-01T00:00:00Z',updated_at:'2000-01-01T00:00:00Z'})){
  const response=await page.request.put(`/api/automations/${created.id}`,{headers:{origin},data:{...updatePayload,[field]:value}});
  expect(response.status(),`O campo ${field} não pode ser atribuído pelo cliente.`).toBe(400);
 }
 const preserved=await (await page.request.get(`/api/automations/${created.id}`)).json();
 expect(preserved).toMatchObject({name:'Atendimento E2E editado',organization_id:created.organization_id,created_by:created.created_by});
 await card.getByRole('button',{name:'Ativar'}).click();
 await expect(card.getByText('Ativa',{exact:true})).toBeVisible();
 await card.getByRole('button',{name:'Editar'}).click();
 await page.getByLabel('Descrição').fill('Regra editada depois da ativação');
 await page.getByRole('button',{name:'Salvar regra'}).click();
 await expect(card.getByText('Ativa',{exact:true})).toBeVisible();
 await card.getByRole('button',{name:'Editar'}).click();
 await page.getByLabel('Nome',{exact:true}).fill('Alteração cancelada');
 await page.getByRole('button',{name:'Cancelar'}).click();
 await page.reload();
 await expect(card.getByRole('heading',{name:'Atendimento E2E editado'})).toBeVisible();
 await card.getByRole('button',{name:'Editar'}).click();
 await expect(page.getByLabel('Nome',{exact:true})).toHaveValue('Atendimento E2E editado');
 await page.getByRole('button',{name:'Salvar regra'}).click();
 await card.getByRole('button',{name:'Desativar'}).click();
 await expect(card.getByText('Desativada')).toBeVisible();
 await page.reload();
 await expect(card.getByText('Desativada')).toBeVisible();
 await page.getByRole('button',{name:'Execuções'}).click();
 await expect(page.getByRole('heading',{name:'Execuções recentes'})).toBeVisible();
 await page.getByRole('button',{name:'Horário e segurança'}).click();
 await expect(page.getByText('Automação de WhatsApp')).toBeVisible();
 for(const size of [{width:390,height:844},{width:1440,height:900}]){
  await page.setViewportSize(size);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
 }
 const seller=await browser.newPage();
 try{
  await login(seller,'seller@e2e.local');
  await seller.goto('/configuracoes/automacoes');
  await expect(seller.getByRole('heading',{name:'Acesso restrito'})).toBeVisible();
  expect((await seller.request.get('/api/automations')).status()).toBe(403);
 }finally{await seller.close();}
});

test('inbox permite pausar e reativar automações por conversa',async({page})=>{
 test.setTimeout(60000);
 await login(page,'automations@e2e.local');
 await page.goto('/whatsapp');
 await expect(page.getByRole('heading',{name:'Caixa de entrada'})).toBeVisible();
 await page.getByRole('button',{name:'Pausar automações'}).click();
 await expect(page.getByText('Automações pausadas',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Reativar automações'}).click();
 await expect(page.getByText('Automações pausadas',{exact:true})).toHaveCount(0);
});
