import {test,expect,type Page} from '@playwright/test';

const password='Peclat teste seguro 2026';
async function login(page:Page){
 await page.goto('/login');
 await page.getByLabel('E-mail profissional').fill('contracts@e2e.local');
 await page.getByLabel('Senha',{exact:true}).fill(password);
 await page.getByRole('button',{name:'Entrar na plataforma'}).click();
 await expect(page.getByRole('heading',{name:'Sua operação, conectada.'})).toBeVisible();
}

test('instalação percorre contrato, edição, status, histórico e telas responsivas',async({page})=>{
 await login(page);
 const headers={Origin:'http://localhost:3100'};
 const customerResponse=await page.request.post('/api/customers',{headers,data:{name:'Cliente Instalação E2E',person_type:'PF',address:'Rua Solar',number:'123',city:'Contagem',state:'MG'}});
 expect(customerResponse.ok()).toBeTruthy();const customer=await customerResponse.json();
 const contractResponse=await page.request.post('/api/contracts',{headers,data:{client_id:customer.id,title:'Projeto para instalar E2E',items:[{description:'Módulos e inversor vendidos',category:'manual',quantity:4,unit_value:1000,discount_value:0}],down_payment_value:4000,payment_method:'pix',installments_count:0}});
 expect(contractResponse.ok()).toBeTruthy();const contract=await contractResponse.json();
 const signed=await page.request.post(`/api/contracts/${contract.id}/status`,{headers,data:{status:'signed',version:contract.version}});expect(signed.ok()).toBeTruthy();

 await page.goto(`/contratos/${contract.id}`);
 await expect(page.getByRole('heading',{name:'Instalações'})).toBeVisible();
 await page.getByRole('link',{name:'Criar instalação'}).click();
 await expect(page.getByRole('heading',{name:'Nova instalação'})).toBeVisible();
 await page.getByLabel('Endereço da instalação').fill('Rua Solar, 123, Contagem - MG');
 await page.getByLabel('Equipe').fill('Equipe Campo A');
 await page.getByLabel('Data prevista').fill('2026-10-20');
 await page.getByRole('button',{name:'Criar instalação'}).click();
 await expect(page.getByRole('heading',{name:'Instalação de Cliente Instalação E2E'})).toBeVisible();
 await expect(page.getByText('Módulos e inversor vendidos')).toBeVisible();
 await expect(page.getByText('Instalação criada',{exact:true})).toBeVisible();
 const installationUrl=page.url();

 await page.getByRole('link',{name:'Editar instalação'}).click();
 await page.getByLabel('Equipe').fill('Equipe Campo B');
 await page.getByRole('button',{name:'Salvar alterações'}).click();
 await expect(page.getByText('Equipe Campo B')).toBeVisible();
 await page.getByLabel('Novo status da instalação').selectOption('scheduled');
 await page.getByLabel('Data da mudança de status').fill('2026-10-22');
 await page.getByRole('button',{name:'Atualizar status'}).click();
 await expect(page.getByText('Agendada',{exact:true}).first()).toBeVisible();
 await expect(page.getByText('Status alterado',{exact:true})).toBeVisible();

 await page.goto('/instalacoes');
 await page.getByLabel('Pesquisar instalações').fill('Cliente Instalação E2E');
 await expect(page.locator('.installation-row')).toHaveCount(1);
 await page.getByLabel('Filtrar status da instalação').selectOption('scheduled');
 await expect(page.locator('.installation-row')).toHaveCount(1);
 await page.getByLabel('Filtrar status da instalação').selectOption('completed');
 await expect(page.locator('.installation-row')).toHaveCount(0);
 await page.goto(`/clientes/${customer.id}?tab=installations`);
 await expect(page.getByRole('button',{name:'Instalações'})).toHaveAttribute('aria-pressed','true');
 await expect(page.getByRole('link',{name:/INST-PECLAT-/})).toBeVisible();

 for(const viewport of [{width:390,height:844},{width:1440,height:900}]){
  await page.setViewportSize(viewport);await page.goto(installationUrl);
  await expect(page.getByRole('heading',{name:'Instalação de Cliente Instalação E2E'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
 }
});
