import {test,expect,type Page} from '@playwright/test';
const password='Peclat teste seguro 2026';
async function login(page:Page,email:string){await page.goto('/login');await page.getByLabel('E-mail profissional').fill(email);await page.getByLabel('Senha',{exact:true}).fill(password);await page.getByRole('button',{name:'Entrar na plataforma'}).click();await expect(page).toHaveURL(/\/$/);}

test('admin aprova respostas e testa sem envio em desktop e mobile',async({page})=>{
 test.setTimeout(120000);await page.setViewportSize({width:1440,height:900});await login(page,'knowledge@e2e.local');
 await page.goto('/configuracoes/base-conhecimento-ia');await expect(page.getByRole('heading',{name:'Base de Conhecimento da IA'})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
 await page.getByLabel('Pergunta frequente').fill('A Peclat realiza visita técnica ao local?');
 await page.getByLabel('Categoria',{exact:true}).fill('Visitas');
 await page.getByLabel('Resposta oficial proposta').fill('A equipe pode avaliar a possibilidade de uma visita técnica ao local.');
 await page.getByLabel('Palavras-chave opcionais, separadas por vírgula').fill('vistoria, avaliação');
 await page.getByRole('button',{name:'Salvar para revisão'}).click();
 const entry=page.locator('.knowledge-entry').filter({hasText:'A Peclat realiza visita técnica ao local?'});
 await expect(entry.getByText('Aguardando revisão')).toBeVisible();await entry.getByRole('button',{name:'Aprovar e ativar'}).click();await expect(entry.getByText('Ativa',{exact:true})).toBeVisible();
 await page.getByLabel('Pergunta de teste').fill('Vocês fazem vistoria no local?');await page.getByRole('button',{name:'Gerar prévia'}).click();
 await expect(page.getByText('Informações utilizadas')).toBeVisible();await expect(page.getByText('Visitas: A Peclat realiza visita técnica ao local?')).toBeVisible();
 await entry.getByRole('button',{name:'Editar'}).click();await page.getByLabel('Resposta oficial proposta').fill('A equipe confirma a disponibilidade da visita antes do agendamento.');await page.getByRole('button',{name:'Salvar para revisão'}).click();await expect(entry.getByText('Aguardando revisão')).toBeVisible();
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
 expect((await page.request.get('/api/ai/knowledge')).status()).toBe(200);
 await page.setViewportSize({width:1440,height:900});await page.goto('/whatsapp');
 const assistant=page.getByTestId('commercial-ai-assistant');await expect(assistant).toBeVisible();
 await assistant.getByRole('button',{name:'Sugerir resposta',exact:true}).click();
 await expect(assistant.getByRole('button',{name:'Salvar na base de conhecimento'})).toBeVisible();
 await assistant.getByRole('button',{name:'Salvar na base de conhecimento'}).click();
 await assistant.getByLabel('Pergunta',{exact:true}).fill('Como posso acompanhar meu projeto solar?');
 await assistant.getByLabel('Resposta revisada').fill('A equipe confirma as próximas etapas do projeto com o cliente.');
 await assistant.getByRole('button',{name:'Enviar para aprovação'}).click();
 await expect(page.getByText('Resposta proposta para revisão administrativa. Ainda não integra a base oficial.')).toBeVisible();
 await page.goto('/configuracoes/base-conhecimento-ia');
 const proposal=page.locator('.knowledge-entry').filter({hasText:'Como posso acompanhar meu projeto solar?'});
 await expect(proposal.getByText('Aguardando revisão')).toBeVisible();
 await page.route('**/api/ai/commercial-assistant',async route=>{if(route.request().method()==='POST')await new Promise(resolve=>setTimeout(resolve,900));await route.continue();});
 await page.goto('/whatsapp');await page.getByTestId('commercial-ai-assistant').getByRole('button',{name:'Resumir'}).click();
 await page.getByRole('button',{name:/Novo contato/}).click();
 await expect(page.getByTestId('conversation-header')).toContainText('Novo contato');
 await page.waitForTimeout(1200);await expect(page.getByTestId('commercial-ai-assistant').getByText('Sugestão do assistente')).toHaveCount(0);
});
