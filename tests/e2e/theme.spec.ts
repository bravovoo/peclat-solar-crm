import { expect, test, type Page } from '@playwright/test';

const password = 'Peclat teste seguro 2026';

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('E-mail profissional').fill('theme-admin@e2e.local');
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar na plataforma' }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 15000 });
}

test('alterna o tema sem perder o formulário e persiste a preferência local', async ({ page }) => {
  const errors: string[] = [];
  const unexpectedResponses: string[] = [];
  page.on('console', message => {
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) errors.push(message.text());
  });
  page.on('response', response => {
    const expectedExpiredMedia = response.status() === 404 && /\/api\/whatsapp\/conversations\/.+\/messages\/.+\/media$/.test(response.url());
    if (response.status() >= 400 && !expectedExpiredMedia) unexpectedResponses.push(`${response.status()} ${new URL(response.url()).pathname}`);
  });

  await login(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  const toggle = page.getByRole('button', { name: 'Ativar modo escuro' });
  await expect(toggle).toBeVisible();

  await page.goto('/leads/novo');
  const name = page.getByLabel('Nome *');
  await name.fill('Preferência visual preservada');
  await page.getByRole('button', { name: 'Ativar modo escuro' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('button', { name: 'Ativar modo claro' })).toHaveAttribute('aria-pressed', 'true');
  await expect(name).toHaveValue('Preferência visual preservada');
  expect(await page.evaluate(() => localStorage.getItem('peclat-crm-theme'))).toBe('dark');

  await page.goto('/clientes');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Buscar no CRM' }).click();
  await expect(page.getByRole('dialog', { name: 'Buscar no CRM' })).toBeVisible();
  await expect(page.locator('.crm-modal')).toHaveCSS('background-color', 'rgb(30, 41, 59)');
  await page.getByRole('button', { name: 'Fechar janela' }).click();

  await page.setViewportSize({ width: 1440, height: 900 });
  for (const path of ['/', '/pipeline', '/tarefas', '/catalogo-solar', '/contratos', '/instalacoes', '/whatsapp', '/configuracoes/automacoes']) {
    await page.goto(path);
    await expect(page.locator('main')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.goto('/whatsapp');
  const selectedConversation = page.locator('.whatsapp-conversation.selected');
  await expect(selectedConversation).toBeVisible();
  await expect(selectedConversation).toHaveCSS('background-color', 'rgb(23, 58, 52)');
  await expect(selectedConversation.locator('.whatsapp-conversation-main strong')).toHaveCSS('color', 'rgb(241, 245, 249)');
  await page.goto('/');
  await page.screenshot({ path: 'test-results/theme-dark-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole('button', { name: 'Ativar modo claro' })).toBeVisible();
  await page.screenshot({ path: 'test-results/theme-dark-mobile.png', fullPage: true });

  await page.goto('/login');
  await expect(page.locator('.auth-main')).toHaveCSS('background-color', 'rgb(30, 41, 59)');

  await page.goto('/');
  await page.getByRole('button', { name: 'Ativar modo claro' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await page.evaluate(() => localStorage.getItem('peclat-crm-theme'))).toBe('light');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(245, 247, 249)');
  expect(errors).toEqual([]);
  expect(unexpectedResponses).toEqual([]);
});

test('continua funcional com armazenamento local indisponível', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new Error('storage disabled for test'); };
    Storage.prototype.setItem = () => { throw new Error('storage disabled for test'); };
  });
  await login(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Ativar modo escuro' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('heading', { name: 'Sua operação, conectada.' })).toBeVisible();
});
