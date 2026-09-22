import {test,expect,type Page} from '@playwright/test';

const password='Peclat teste seguro 2026';
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
 await page.getByRole('button',{name:'Salvar regra'}).click();
 await expect(page.getByRole('status')).toContainText('Automação criada desativada');
 const card=page.locator('.automation-rule').filter({hasText:'Atendimento E2E'});
 await expect(card.getByText('Desativada')).toBeVisible();
 await card.getByRole('button',{name:'Editar'}).click();
 await page.getByRole('button',{name:'Simular'}).click();
 await expect(page.getByText(/Nenhuma ação externa foi realizada/)).toBeVisible();
 await page.getByRole('button',{name:'Salvar regra'}).click();
 await card.getByRole('button',{name:'Ativar'}).click();
 await expect(card.getByText('Ativa',{exact:true})).toBeVisible();
 await card.getByRole('button',{name:'Desativar'}).click();
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
