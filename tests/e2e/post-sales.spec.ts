import {test,expect,type Page} from '@playwright/test';

const origin='http://localhost:3100';
const password='Peclat teste seguro 2026';

async function login(page:Page,email='contracts@e2e.local'){
 await page.goto('/login');
 await page.getByLabel('E-mail profissional').fill(email);
 await page.getByLabel('Senha',{exact:true}).fill(password);
 await page.getByRole('button',{name:'Entrar na plataforma'}).click();
 await expect(page.getByRole('heading',{name:'Sua operação, conectada.'})).toBeVisible();
}

test('pós-venda registra garantia, chamado, acionamento, manutenção, anexo e tarefa',async({page,playwright})=>{
 test.setTimeout(120000);
 await login(page);
 const headers={origin};
 const customerResponse=await page.request.post('/api/customers',{headers,data:{name:'Cliente Pós-venda E2E',person_type:'PF',address:'Rua Pós-venda',number:'64',city:'Contagem',state:'MG'}});
 expect(customerResponse.ok()).toBeTruthy();const customer=await customerResponse.json();
 const contractResponse=await page.request.post('/api/contracts',{headers,data:{client_id:customer.id,title:'Contrato Pós-venda E2E',items:[{description:'Módulo E2E garantido',category:'manual',quantity:2,unit_value:1500,discount_value:0}],down_payment_value:3000,payment_method:'pix',installments_count:0}});
 expect(contractResponse.ok()).toBeTruthy();let contract=await contractResponse.json();
 const signed=await page.request.post(`/api/contracts/${contract.id}/status`,{headers,data:{status:'signed',version:contract.version}});expect(signed.ok()).toBeTruthy();contract=await signed.json();
 const installationResponse=await page.request.post('/api/installations',{headers,data:{contract_id:contract.id,responsible_user_id:contract.responsible_user_id,installation_address:'Rua Pós-venda, 64, Contagem - MG',team_name:'Equipe Pós-venda',planned_on:'',scheduled_on:'',started_on:'',completed_on:'',notes:''}});
 expect(installationResponse.ok()).toBeTruthy();const installation=await installationResponse.json();
 const taskResponse=await page.request.post('/api/tasks',{headers,data:{record_id:customer.id,title:'Retornar cliente pós-venda E2E',description:'Confirmar substituição',priority:'normal',status:'pending',due_date:'2026-12-20',due_time:''}});
 expect(taskResponse.status()).toBe(201);const task=await taskResponse.json();

 await page.goto('/pos-venda');
 await expect(page.getByRole('heading',{name:'Pós-venda'})).toBeVisible();
 await page.getByRole('button',{name:'Nova garantia'}).click();
 const warrantyDialog=page.getByRole('dialog');
 await warrantyDialog.getByLabel('Instalação',{exact:true}).selectOption(installation.id);
 await warrantyDialog.getByLabel('Descrição').fill('Garantia do módulo E2E');
 await warrantyDialog.getByLabel('Fabricante').fill('Fabricante E2E');
 await warrantyDialog.getByLabel('Início da garantia').fill('2026-01-10');
 await warrantyDialog.getByRole('button',{name:'Criar garantia'}).click();
 await expect(page.getByRole('heading',{name:'Garantia do módulo E2E'})).toBeVisible();
 const warrantyUrl=page.url();

 await page.goto('/pos-venda');
 await page.getByRole('button',{name:'Novo chamado'}).click();
 const ticketDialog=page.getByRole('dialog');
 await ticketDialog.getByLabel('Cliente').selectOption(customer.id);
 await ticketDialog.getByLabel('Contrato').selectOption(contract.id);
 await ticketDialog.getByLabel('Instalação',{exact:true}).selectOption(installation.id);
 await ticketDialog.getByLabel('Garantia').selectOption({label:'Garantia do módulo E2E'});
 await ticketDialog.getByLabel('Título').fill('Falha de geração E2E');
 await ticketDialog.getByLabel('Descrição').fill('Cliente relatou interrupção de geração.');
 await ticketDialog.getByLabel('Prioridade').selectOption('high');
 await ticketDialog.getByRole('button',{name:'Abrir chamado'}).click();
 await expect(page.getByRole('heading',{name:'Falha de geração E2E'})).toBeVisible();
 const ticketUrl=page.url();
 const ticketId=ticketUrl.split('/').at(-1)!;

 await page.getByLabel('Nova atualização interna').fill('Equipe técnica acionada para vistoria.');
 await page.getByRole('button',{name:'Registrar atualização'}).click();
 await expect(page.getByText('Equipe técnica acionada para vistoria.',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Editar'}).click();
 const editTicket=page.getByRole('dialog');
 await editTicket.getByLabel('Status').selectOption('in_service');
 await editTicket.getByRole('button',{name:'Salvar chamado'}).click();
 await expect(page.getByText('Status alterado',{exact:true})).toBeVisible();

 await page.getByRole('button',{name:'Acionar'}).click();
 const claimDialog=page.getByRole('dialog');
 await claimDialog.getByLabel('Motivo do acionamento').fill('Módulo sem geração após a instalação.');
 await claimDialog.getByLabel('Fornecedor ou fabricante').fill('Fabricante E2E');
 await claimDialog.getByLabel('Protocolo').fill('E2E-001');
 await claimDialog.getByRole('button',{name:'Acionar garantia'}).click();
 await expect(page.getByText('E2E-001',{exact:true})).toBeVisible();

 const filePanel=page.locator('section').filter({has:page.getByRole('heading',{name:'Fotos e documentos'})});
 await filePanel.getByLabel('Nome').fill('Relatório técnico E2E');
 await filePanel.locator('input[type=file]').setInputFiles({name:'relatorio-e2e.txt',mimeType:'text/plain',buffer:Buffer.from('Relatório privado de pós-venda E2E')});
 await filePanel.getByRole('button',{name:'Adicionar arquivo'}).click();
 await expect(filePanel.getByText('Relatório técnico E2E',{exact:true})).toBeVisible();
 const downloadUrl=await filePanel.getByRole('link',{name:'Baixar'}).getAttribute('href');
 expect(downloadUrl).toBeTruthy();const download=await page.request.get(downloadUrl!);expect(download.ok()).toBeTruthy();expect((await download.body()).toString()).toBe('Relatório privado de pós-venda E2E');

 await page.getByLabel('Vincular tarefa existente').selectOption(task.id);
 await page.getByRole('button',{name:'Vincular'}).click();
 await expect(page.getByText('Retornar cliente pós-venda E2E',{exact:true})).toBeVisible();

 await page.goto('/pos-venda');
 await page.getByRole('button',{name:'Nova manutenção'}).click();
 const maintenanceDialog=page.getByRole('dialog');
 await maintenanceDialog.getByLabel('Instalação',{exact:true}).selectOption(installation.id);
 await maintenanceDialog.getByLabel('Chamado').selectOption(ticketId);
 await maintenanceDialog.getByLabel('Garantia').selectOption({label:'Garantia do módulo E2E'});
 await maintenanceDialog.getByLabel('Motivo').fill('Substituição de módulo E2E');
 await maintenanceDialog.getByLabel('Descrição').fill('Troca coberta pela garantia.');
 await maintenanceDialog.getByRole('button',{name:'Solicitar manutenção'}).click();
 await expect(page.getByRole('heading',{name:'Substituição de módulo E2E'})).toBeVisible();
 await page.getByLabel('Descrição do serviço').fill('Trocar módulo garantido');
 await page.getByLabel('Quantidade').fill('1');
 await page.getByRole('button',{name:'Adicionar item'}).click();
 await expect(page.getByText('Trocar módulo garantido',{exact:true})).toBeVisible();

 await page.goto(`/clientes/${customer.id}?tab=post-sales`);
 await expect(page.getByText('Garantia do módulo E2E',{exact:true})).toBeVisible();
 await expect(page.getByText(/POS-\d{4}-\d{6}/)).toBeVisible();
 await page.goto(`/contratos/${contract.id}`);
 await expect(page.getByRole('heading',{name:'Garantias, chamados e manutenção'})).toBeVisible();
 await page.goto(`/instalacoes/${installation.id}`);
 await expect(page.getByRole('heading',{name:'Garantias, chamados e manutenção'})).toBeVisible();

 for(const url of ['/pos-venda',ticketUrl,warrantyUrl,`/instalacoes/${installation.id}`]){
  for(const viewport of [{width:390,height:844},{width:1440,height:900}]){
   await page.setViewportSize(viewport);await page.goto(url);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
  }
 }

 const seller=await playwright.request.newContext({baseURL:origin});
 expect((await seller.post('/api/auth/login',{headers,data:{organization:'peclat-solar',email:'seller@e2e.local',password}})).ok()).toBeTruthy();
 expect((await seller.get(`/api/post-sales-tickets/${ticketId}`)).status()).toBe(404);
 expect((await seller.get(downloadUrl!)).status()).toBe(404);
 await seller.dispose();
});
