import {test,expect} from '@playwright/test';

test('admin organiza equipe comercial e vendedor vê apenas seu perfil no celular',async({page,browser})=>{
  await page.setViewportSize({width:1440,height:900});
  await page.goto('/login');
  await page.getByLabel('E-mail profissional').fill('admin@e2e.local');
  await page.getByLabel('Senha',{exact:true}).fill('Peclat teste seguro 2026');
  await page.getByRole('button',{name:'Entrar na plataforma'}).click();
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole('link',{name:'Equipe comercial'}).click();
  await expect(page.getByRole('heading',{name:'Equipe comercial'})).toBeVisible();
  await page.getByRole('button',{name:'Criar equipe'}).click();
  const dialog=page.getByRole('dialog',{name:'Criar equipe'});
  await dialog.getByLabel('Nome da equipe').fill('Equipe Florianópolis');
  await dialog.getByLabel('Descrição (opcional)').fill('Vendas regionais');
  await dialog.getByLabel('Gerente comercial').selectOption({label:'Gerente comercial de teste'});
  await dialog.getByRole('button',{name:'Salvar equipe'}).click();
  await expect(page.getByRole('heading',{name:'Equipe Florianópolis'})).toBeVisible();
  await page.getByLabel('Adicionar vendedor à Equipe Florianópolis').selectOption({label:'Vendedor de teste'});
  await expect(page.getByText('Vendedor adicionado.')).toBeVisible();
  await expect(page.getByRole('heading',{name:'Vendedor de teste'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();

  const seller=await browser.newPage({viewport:{width:390,height:844}});
  try{
    await seller.goto('/login');
    await seller.getByLabel('E-mail profissional').fill('seller@e2e.local');
    await seller.getByLabel('Senha',{exact:true}).fill('Peclat teste seguro 2026');
    await seller.getByRole('button',{name:'Entrar na plataforma'}).click();
    await expect(seller).toHaveURL(/\/$/);
    await seller.goto('/equipe');
    await expect(seller.getByRole('heading',{name:'Meu perfil comercial'})).toBeVisible();
    await expect(seller.getByRole('heading',{name:'Equipe Florianópolis'})).toBeVisible();
    await expect(seller.getByRole('button',{name:'Criar equipe'})).toHaveCount(0);
    expect(await seller.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  }finally{await seller.close();}
});
