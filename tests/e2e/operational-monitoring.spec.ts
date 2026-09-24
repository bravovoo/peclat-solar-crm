import {expect,test} from '@playwright/test';

test('admin acompanha integrações e filas em desktop e mobile',async({page})=>{
 await page.goto('/login');
 await page.getByLabel('E-mail profissional').fill('monitoring@e2e.local');
 await page.getByLabel('Senha',{exact:true}).fill('Peclat teste seguro 2026');
 await page.getByRole('button',{name:'Entrar na plataforma'}).click();
 await expect(page).toHaveURL(/\/$/);
 await page.goto('/configuracoes');
 await page.getByRole('link',{name:/Monitoramento operacional/}).click();
 await expect(page.getByRole('heading',{name:'Monitoramento do CRM'})).toBeVisible();
 await expect(page.getByText('Nenhuma chave ou segredo é exibido.')).toBeVisible();
 await expect(page.getByText('Banco de dados')).toBeVisible();
 await expect(page.getByRole('heading',{name:'Alertas externos por e-mail'})).toBeVisible();
 await page.getByLabel('Ativar alertas por e-mail').check();
 await page.getByLabel('Destinatários dos alertas').fill('operacao@e2e.local');
 const saved=page.waitForResponse(item=>item.url().endsWith('/api/operations/monitoring')&&item.request().method()==='POST');
 await page.getByRole('button',{name:'Salvar alertas externos'}).click();
 expect((await saved).status()).toBe(200);
 await expect(page.getByText('Configuração salva.')).toBeVisible();
 const response=page.waitForResponse(item=>item.url().endsWith('/api/operations/monitoring')&&item.request().method()==='GET');
 await page.getByRole('button',{name:'Atualizar'}).click();
 expect((await response).status()).toBe(200);
 await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await expect(page.getByRole('heading',{name:'Alertas ativos'})).toBeVisible();
});
