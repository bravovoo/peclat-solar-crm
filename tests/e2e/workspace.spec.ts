import { test, expect } from '@playwright/test';
const password='Peclat teste seguro 2026';
test('login, navegação, sessão protegida e logout em produção',async({page,context})=>{
  await page.goto('/');await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('E-mail profissional').fill('admin@e2e.local');await page.getByLabel('Senha',{exact:true}).fill('errada');
  await page.getByRole('button',{name:'Entrar na plataforma'}).click();await expect(page.getByRole('alert').filter({hasText:'inválidos'})).toBeVisible();
  await page.getByLabel('Senha',{exact:true}).fill(password);await page.getByRole('button',{name:'Entrar na plataforma'}).click();
  await expect(page.getByRole('heading',{name:'Sua operação, conectada.'})).toBeVisible();
  const session=(await context.cookies()).find(c=>c.name==='peclat_session');expect(session?.httpOnly).toBe(true);expect(session?.secure).toBe(true);expect(session?.sameSite).toBe('Lax');
  await page.screenshot({path:'test-results/dashboard-desktop.png',fullPage:true});
  await page.getByRole('link',{name:'Equipe',exact:true}).click();await expect(page.getByRole('cell',{name:'admin@e2e.local'})).toBeVisible();
  await page.getByRole('link',{name:'Configurações',exact:true}).click();await expect(page.getByText('NÃO CONECTADO')).toBeVisible();
  await page.getByRole('button',{name:'Sair da conta'}).click();await expect(page).toHaveURL(/\/login$/);
  expect((await context.request.get('/api/me')).status()).toBe(401);
});
test('API rejeita CSRF, JSON inválido, excesso de tamanho e acesso anônimo',async({request})=>{
  expect((await request.get('/api/team')).status()).toBe(401);
  expect((await request.post('/api/auth/login',{headers:{origin:'https://attacker.example'},data:{}})).status()).toBe(403);
  expect((await request.post('/api/auth/login',{headers:{origin:'http://localhost:3100','Content-Type':'application/json'},data:'{broken'})).status()).toBe(400);
  expect((await request.post('/api/auth/login',{headers:{origin:'http://localhost:3100','Content-Type':'application/json'},data:'x'.repeat(17000)})).status()).toBe(413);
});
test('vendedor não acessa dados da equipe nem configurações',async({page,context})=>{
  await page.goto('/login');await page.getByLabel('E-mail profissional').fill('seller@e2e.local');await page.getByLabel('Senha',{exact:true}).fill(password);await page.getByRole('button',{name:'Entrar na plataforma'}).click();
  await expect(page.getByRole('heading',{name:'Sua operação, conectada.'})).toBeVisible();
  await expect(page.getByRole('link',{name:'Equipe',exact:true})).toHaveCount(0);expect((await context.request.get('/api/team')).status()).toBe(403);
  await page.goto('/configuracoes');await expect(page.getByRole('heading',{name:'Acesso restrito'})).toBeVisible();
});
test('layout mobile sem overflow e menu funcional',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/login');
  await page.screenshot({path:'test-results/login-mobile.png',fullPage:true});
  await page.getByLabel('E-mail profissional').fill('admin@e2e.local');await page.getByLabel('Senha',{exact:true}).fill(password);await page.getByRole('button',{name:'Entrar na plataforma'}).click();
  await expect(page.getByRole('heading',{name:'Sua operação, conectada.'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/dashboard-mobile.png',fullPage:true});
  await page.getByRole('button',{name:'Abrir menu'}).click();
  await expect(page.getByRole('dialog',{name:'Menu principal'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Fechar menu',exact:true})).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('.future-navigation summary')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button',{name:'Fechar menu',exact:true})).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button',{name:'Abrir menu'})).toBeFocused();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button',{name:'Abrir menu'}).click();await page.getByRole('link',{name:'Equipe',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Pessoas que fazem acontecer.'})).toBeVisible();await expect(page.getByRole('button',{name:'Abrir menu'})).toHaveAttribute('aria-expanded','false');
});
test('formulário associa erros aos campos e mantém senha visível sob controle',async({page})=>{
  await page.goto('/login');
  await page.getByRole('button',{name:'Entrar na plataforma'}).click();
  const email=page.getByLabel('E-mail profissional');
  await expect(email).toBeFocused();
  await expect(email).toHaveAttribute('aria-invalid','true');
  await expect(email).toHaveAccessibleDescription('Informe um e-mail válido.');
  await page.getByLabel('Senha',{exact:true}).fill('Texto de teste');
  await page.getByRole('button',{name:'Mostrar senha'}).click();
  await expect(page.getByLabel('Senha',{exact:true})).toHaveAttribute('type','text');
  await expect(page.getByRole('button',{name:'Ocultar senha'})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'Ocultar senha'}).click();
  await expect(page.getByLabel('Senha',{exact:true})).toHaveAttribute('type','password');
});
test('login e painel se adaptam de 320px até tablet sem rolagem horizontal',async({page})=>{
  for(const width of [320,768]){
    await page.setViewportSize({width,height:900});await page.goto('/login');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect(await page.getByLabel('E-mail profissional').evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
    const button=await page.getByRole('button',{name:'Entrar na plataforma'}).boundingBox();expect(button!.height).toBeGreaterThanOrEqual(44);
  }
  await page.getByLabel('E-mail profissional').fill('admin@e2e.local');await page.getByLabel('Senha',{exact:true}).fill(password);await page.getByRole('button',{name:'Entrar na plataforma'}).click();
  await expect(page.getByRole('heading',{name:'Sua operação, conectada.'})).toBeVisible();
  for(const width of [320,768,1440]){
    await page.setViewportSize({width,height:900});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  await expect(page.getByRole('link',{name:'Equipe',exact:true})).toBeInViewport();
  await expect(page.getByRole('link',{name:'Configurações',exact:true})).toBeInViewport();
  await expect(page.getByText('Propostas',{exact:true})).not.toBeVisible();
  await page.locator('.future-navigation summary').click();await expect(page.getByText('Leads',{exact:true})).toBeVisible();
});
test('recuperação e link inválido exibem estados corretos',async({page})=>{
  await page.goto('/recuperar-senha');await page.getByLabel('E-mail profissional').fill('inexistente@e2e.local');await page.getByRole('button',{name:'Enviar link de recuperação'}).click();
  await expect(page.getByRole('heading',{name:'Confira seu e-mail'})).toBeVisible();
  await page.goto('/redefinir-senha#'+'a'.repeat(64));await page.getByLabel('Nova senha',{exact:true}).fill(password);await page.getByRole('button',{name:'Salvar nova senha'}).click();await expect(page.getByRole('alert').filter({hasText:'inválido ou expirado'})).toBeVisible();
});
