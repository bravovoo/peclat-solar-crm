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
 await page.getByRole('textbox',{name:'Equipe',exact:true}).fill('Equipe Campo A');
 await page.getByLabel('Data prevista').fill('2026-10-20');
 await page.getByRole('button',{name:'Criar instalação'}).click();
 await expect(page.getByRole('heading',{name:'Instalação de Cliente Instalação E2E'})).toBeVisible();
 await expect(page.getByText('Módulos e inversor vendidos')).toBeVisible();
 await page.getByRole('button',{name:'Histórico'}).click();
 await expect(page.getByText('Instalação criada',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Resumo'}).click();
 const installationUrl=page.url();

 await page.getByRole('link',{name:'Editar instalação'}).click();
 await page.getByRole('textbox',{name:'Equipe',exact:true}).fill('Equipe Campo B');
 await page.getByRole('button',{name:'Salvar alterações'}).click();
 await expect(page.getByText('Equipe Campo B')).toBeVisible();
 await page.getByLabel('Novo status da instalação').selectOption('scheduled');
 await page.getByLabel('Data da mudança de status').fill('2026-10-22');
 await page.getByRole('button',{name:'Atualizar status'}).click();
 await expect(page.getByText('Agendada',{exact:true}).first()).toBeVisible();
 await page.getByRole('button',{name:'Histórico'}).click();
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

test('checklist, arquivos, pendência, conclusão e entrega funcionam no navegador',async({page,request})=>{
 test.setTimeout(120000);
 await login(page);
 const headers={Origin:'http://localhost:3100'};
 const customerResponse=await page.request.post('/api/customers',{headers,data:{name:'Cliente Execução E2E',person_type:'PF',address:'Rua Solar',number:'456',city:'Contagem',state:'MG'}});
 expect(customerResponse.ok()).toBeTruthy();const customer=await customerResponse.json();
 const contractResponse=await page.request.post('/api/contracts',{headers,data:{client_id:customer.id,title:'Execução E2E',items:[{description:'Kit solar',category:'manual',quantity:1,unit_value:5000,discount_value:0}],down_payment_value:5000,payment_method:'pix',installments_count:0}});
 expect(contractResponse.ok()).toBeTruthy();const contract=await contractResponse.json();
 const signed=await page.request.post(`/api/contracts/${contract.id}/status`,{headers,data:{status:'signed',version:contract.version}});expect(signed.ok()).toBeTruthy();
 await page.goto(`/instalacoes/nova?contract_id=${contract.id}`);
 await page.getByLabel('Endereço da instalação').fill('Rua Solar, 456, Contagem - MG');
 await page.getByRole('button',{name:'Criar instalação'}).click();
 await expect(page.getByRole('heading',{name:'Instalação de Cliente Execução E2E'})).toBeVisible();
 const installationUrl=page.url();
 await page.getByRole('button',{name:'Checklist'}).click();
 await expect(page.getByText('0 de 16 concluídos')).toBeVisible();
 const item=page.locator('.installation-checklist form').first();
 await item.getByRole('checkbox').check();
 await item.getByLabel('Observação').fill('Conferido no local');
 await item.getByRole('button',{name:'Salvar item'}).click();
 await expect(page.getByText('1 de 16 concluídos')).toBeVisible();
 await page.getByRole('button',{name:'Fotos'}).click();
 await page.getByLabel('Nome',{exact:true}).fill('Telhado antes');
 await page.getByLabel('Legenda ou descrição').fill('Vista inicial');
 await page.locator('input[type=file]').setInputFiles({name:'telhado.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p7sAAAAASUVORK5CYII=','base64')});
 await page.getByRole('button',{name:'Adicionar foto'}).click();
 await expect(page.getByText('Telhado antes')).toBeVisible();
 await page.getByRole('button',{name:'Ampliar Telhado antes'}).click();
 await expect(page.getByRole('dialog')).toBeVisible();
 await page.getByRole('button',{name:'Fechar janela'}).click();
 await page.getByRole('button',{name:'Documentos'}).click();
 await page.getByLabel('Nome',{exact:true}).fill('Relatório de campo');
 await page.locator('input[type=file]').setInputFiles({name:'campo.txt',mimeType:'text/plain',buffer:Buffer.from('Relatório da instalação')});
 await page.getByRole('button',{name:'Adicionar documento'}).click();
 await expect(page.getByText('Relatório de campo')).toBeVisible();
 const documentLink=page.getByRole('link',{name:'Baixar'}).first();
 const documentResponse=await page.request.get(await documentLink.getAttribute('href')||'');
 expect(documentResponse.ok()).toBeTruthy();expect((await documentResponse.body()).toString()).toBe('Relatório da instalação');
 const anonymous=await request.get(await documentLink.getAttribute('href')||'');expect(anonymous.status()).toBe(401);
 await page.getByRole('button',{name:'Pendências'}).click();
 await page.getByRole('button',{name:'Nova pendência'}).click();
 await page.getByLabel('Título').fill('Conferir quadro elétrico');
 await page.getByRole('button',{name:'Salvar pendência'}).click();
 await expect(page.getByText('Conferir quadro elétrico')).toBeVisible();
 await page.getByRole('button',{name:'Resumo'}).click();
 await page.getByLabel('Novo status da instalação').selectOption('scheduled');
 await page.getByLabel('Data da mudança de status').fill('2026-10-20');
 await page.getByRole('button',{name:'Atualizar status'}).click();
 await page.getByLabel('Novo status da instalação').selectOption('in_progress');
 await page.getByLabel('Data da mudança de status').fill('2026-10-20');
 await page.getByRole('button',{name:'Atualizar status'}).click();
 await page.getByLabel('Novo status da instalação').selectOption('completed');
 await page.getByLabel('Data da mudança de status').fill('2026-10-20');
 await page.getByLabel('Observações finais').fill('Sistema entregue com conferência elétrica pendente.');
 await page.getByLabel('Confirmo a conclusão com pendências abertas.').check();
 await page.getByRole('button',{name:'Atualizar status'}).click();
 await expect(page.getByText('Com pendências registradas.')).toBeVisible();
 await page.getByRole('button',{name:'Pendências'}).click();
 await page.getByRole('button',{name:'Editar'}).click();
 await page.getByLabel('Status').selectOption('resolved');
 await page.getByLabel('Observação da resolução').fill('Quadro revisado e aprovado.');
 await page.getByRole('button',{name:'Salvar pendência'}).click();
 await expect(page.getByText('Quadro revisado e aprovado.')).toBeVisible();
 await page.getByRole('button',{name:'Entrega'}).click();
 await page.getByLabel('Data e hora da entrega').fill('2026-10-20T15:30');
 await page.getByLabel('Quem recebeu').fill('Cliente final');
 await page.getByLabel('Confirmo que a entrega foi realizada e recebida.').check();
 await page.getByRole('button',{name:'Registrar entrega'}).click();
 await expect(page.getByText(/Entregue em .* Cliente final/)).toBeVisible();
 await page.getByRole('button',{name:'Histórico'}).click();
 await expect(page.getByText('Entrega registrada',{exact:true})).toBeVisible();
 for(const viewport of [{width:390,height:844},{width:1440,height:900}]){
  await page.setViewportSize(viewport);await page.goto(installationUrl);
  for(const tab of ['Resumo','Checklist','Fotos','Documentos','Pendências']){
   await page.getByRole('button',{name:tab,exact:true}).click();
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
  }
 }
});
