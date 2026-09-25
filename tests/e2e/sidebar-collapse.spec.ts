import {test,expect,type Page} from '@playwright/test';

const password='Peclat teste seguro 2026';

async function login(page:Page){
 await page.goto('/login');
 await page.getByLabel('E-mail profissional').fill('admin@e2e.local');
 await page.getByLabel('Senha',{exact:true}).fill(password);
 await page.getByRole('button',{name:'Entrar na plataforma'}).click();
 await expect(page).toHaveURL(/\/$/,{timeout:15000});
}

test('menu desktop recolhe toda a largura, persiste e preserva o drawer mobile',async({page})=>{
 test.setTimeout(90000);
 await page.setViewportSize({width:1440,height:900});
 await login(page);
 await page.evaluate(()=>localStorage.removeItem('peclat-crm-sidebar'));
 await page.reload();

 const sidebar=page.locator('#workspace-menu');
 const main=page.locator('.main-shell');
 const collapse=page.getByRole('button',{name:'Recolher menu'});
 await expect(sidebar).toBeVisible();
 await expect(collapse).toHaveAttribute('aria-expanded','true');
 expect(await main.evaluate(element=>parseFloat(getComputedStyle(element).marginLeft))).toBeGreaterThan(200);

 await collapse.focus();
 await page.keyboard.press('Enter');
 const expand=page.getByRole('button',{name:'Expandir menu'});
 await expect(expand).toBeFocused();
 await expect(expand).toHaveAttribute('aria-expanded','false');
 await expect(sidebar).toBeHidden();
 await expect.poll(()=>main.evaluate(element=>parseFloat(getComputedStyle(element).marginLeft))).toBe(0);
 expect(await page.evaluate(()=>localStorage.getItem('peclat-crm-sidebar'))).toBe('collapsed');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
 await page.screenshot({path:'test-results/sidebar-collapsed-dashboard-1440.png',fullPage:true});
 await page.getByRole('button',{name:'Ativar modo escuro'}).click();
 await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
 await expect(page.getByRole('button',{name:'Expandir menu'})).toBeVisible();
 await page.screenshot({path:'test-results/sidebar-collapsed-dark-1440.png',fullPage:false});
 await page.getByRole('button',{name:'Ativar modo claro'}).click();

 for(const size of [{width:1366,height:768},{width:1600,height:900},{width:1920,height:1080}]){
  await page.setViewportSize(size);
  const box=await main.boundingBox();
  expect(box?.x).toBeLessThanOrEqual(1);
  expect(box?.width).toBeGreaterThanOrEqual(size.width-1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
 }
 await page.setViewportSize({width:1440,height:900});

 await page.goto('/leads');
 await expect(page.getByRole('button',{name:'Expandir menu'})).toBeVisible();
 await expect(sidebar).toBeHidden();
 await page.reload();
 await expect(page.getByRole('button',{name:'Expandir menu'})).toBeVisible();
 await expect(sidebar).toBeHidden();

 await page.goto('/whatsapp');
 await expect(page.getByTestId('whatsapp-layout')).toBeVisible();
 const collapsedLayout=await page.getByTestId('whatsapp-layout').boundingBox();
 const collapsedConversation=await page.getByTestId('message-history').boundingBox();
 const collapsedAssistant=await page.getByTestId('contact-info').boundingBox();
 await page.getByRole('button',{name:'Expandir menu'}).click();
 await expect(page.getByRole('button',{name:'Recolher menu'})).toBeVisible();
 await expect.poll(()=>main.evaluate(element=>parseFloat(getComputedStyle(element).marginLeft))).toBeGreaterThan(200);
 const openLayout=await page.getByTestId('whatsapp-layout').boundingBox();
 const openConversation=await page.getByTestId('message-history').boundingBox();
 const openAssistant=await page.getByTestId('contact-info').boundingBox();
 expect((collapsedLayout?.width??0)-(openLayout?.width??0)).toBeGreaterThan(200);
 expect(collapsedConversation?.width).toBeGreaterThan(openConversation?.width??0);
 expect(collapsedAssistant?.width).toBeGreaterThan(openAssistant?.width??0);
 expect(await page.evaluate(()=>localStorage.getItem('peclat-crm-sidebar'))).toBeNull();

 await page.getByRole('button',{name:'Recolher menu'}).click();
 await page.setViewportSize({width:390,height:844});
 await page.reload();
 await expect(page.getByRole('button',{name:'Expandir menu'})).toBeHidden();
 const mobileMenu=page.getByRole('button',{name:'Abrir menu'});
 await expect(mobileMenu).toBeVisible();
 await mobileMenu.click();
 await expect(page.getByRole('dialog',{name:'Menu principal'})).toBeVisible();
 await page.getByRole('button',{name:'Fechar menu',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
 await page.screenshot({path:'test-results/sidebar-preference-mobile-390.png',fullPage:false});
});
