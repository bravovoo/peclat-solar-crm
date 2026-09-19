import {test,expect,type APIRequestContext,type Page} from '@playwright/test';

const origin='http://localhost:3100';
const password='Peclat teste seguro 2026';
type Person={id:string;name:string;email:string};
type RecordData={id:string;name:string;version:number;owner_id:string|null};

async function login(page:Page,email:string){
  const response=await page.request.post('/api/auth/login',{headers:{origin},data:{organization:'peclat-solar',email:`${email}@e2e.local`,password}});
  expect(response.status()).toBe(200);
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Sua operação, conectada.'})).toBeVisible();
}
async function create<T>(request:APIRequestContext,path:string,data:Record<string,unknown>):Promise<T>{
  const response=await request.post(path,{headers:{origin},data});
  expect(response.ok(),`${path}: ${await response.text()}`).toBeTruthy();
  return response.json() as Promise<T>;
}
async function people(request:APIRequestContext){
  const response=await request.get('/api/commercial-teams');
  expect(response.status()).toBe(200);
  const body=await response.json() as {members:Person[]};
  return (email:string)=>{
    const person=body.members.find(item=>item.email===`${email}@e2e.local`);
    expect(person,`Conta de teste ${email}`).toBeDefined();
    return person!;
  };
}
async function team(request:APIRequestContext,name:string,manager:Person,sellers:Person[]){
  const saved=await create<{id:string}>(request,'/api/commercial-teams',{name,manager_user_id:manager.id});
  for(const seller of sellers)await create(request,`/api/commercial-teams/${saved.id}/members`,{user_id:seller.id,action:'add'});
  return saved.id;
}
async function fits(page:Page){
  for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
    await page.setViewportSize(viewport);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  }
}

test('carteiras, busca e pipeline respeitam admin, equipe do gerente e vendedor no navegador',async({page,browser})=>{
  test.setTimeout(120000);
  await login(page,'distribution-admin');
  const person=await people(page.request);
  const manager=person('scope-manager'),a=person('scope-a'),b=person('scope-b'),outside=person('scope-outside');
  await team(page.request,'Equipe carteiras E2E',manager,[a,b]);
  const records:Record<string,RecordData[]>={};
  for(const resource of ['leads','customers','companies']){
    records[resource]=[];
    for(const [suffix,owner] of [['A',a],['B',b],['Externo',outside]] as const){
      records[resource].push(await create<RecordData>(page.request,`/api/${resource}`,{name:`Carteira72 ${resource} ${suffix}`,owner_id:owner.id,person_type:resource==='companies'?'PJ':'PF'}));
    }
  }
  for(const [index,owner] of [a,b,outside].entries())await create(page.request,'/api/opportunities',{
    title:`Carteira72 oportunidade ${index}`,lead_id:records.leads[index].id,owner_id:owner.id,estimated_value:1000*(index+1),
  });
  const managerPage=await browser.newPage({viewport:{width:1440,height:900}});
  const sellerPage=await browser.newPage({viewport:{width:390,height:844}});
  try{
    await login(managerPage,'scope-manager');
    await login(sellerPage,'scope-a');
    for(const [viewer,scope,count] of [[page,'all',3],[managerPage,'team',2],[sellerPage,'mine',1]] as const){
      for(const [resource,path,label] of [['leads','leads','leads'],['customers','clientes','clientes'],['companies','empresas','empresas']] as const){
        await viewer.goto(`/${path}`);
        await expect(viewer.getByRole('combobox',{name:'Carteira',exact:true})).toHaveValue(scope);
        await viewer.getByRole('textbox',{name:`Pesquisar ${label}`}).fill('Carteira72');
        await expect(viewer.getByRole('link',{name:records[resource][0].name,exact:true})).toBeVisible();
        await expect(viewer.locator('tbody tr')).toHaveCount(count);
        for(const hidden of records[resource].slice(count))await expect(viewer.getByRole('link',{name:hidden.name,exact:true})).toHaveCount(0);
      }
      for(const path of ['/oportunidades','/pipeline']){
        await viewer.goto(path);
        await viewer.getByRole('textbox',{name:'Pesquisar oportunidades'}).fill('Carteira72');
        await expect(viewer.getByRole('link',{name:'Carteira72 oportunidade 0',exact:true})).toBeVisible();
        await expect(viewer.locator('.opportunity-card')).toHaveCount(count);
        await fits(viewer);
      }
      await viewer.getByRole('button',{name:'Buscar no CRM',exact:true}).click();
      await viewer.getByLabel('Nome, telefone, e-mail, documento ou empresa').fill('Carteira72 leads');
      await expect(viewer.getByRole('link',{name:'Carteira72 leads A Abrir →'})).toBeVisible();
      if(scope!=='all')await expect(viewer.getByRole('link',{name:'Carteira72 leads Externo Abrir →'})).toHaveCount(0);
      if(scope==='mine')await expect(viewer.getByRole('link',{name:'Carteira72 leads B Abrir →'})).toHaveCount(0);
      await viewer.keyboard.press('Escape');
    }
    await sellerPage.goto('/leads');
    await expect(sellerPage.getByRole('combobox',{name:'Carteira',exact:true}).locator('option')).toHaveText(['Meu']);
    await expect(sellerPage.getByRole('button',{name:'Atribuir responsável'})).toHaveCount(0);
    expect((await sellerPage.request.get(`/api/leads/${records.leads[1].id}`)).status()).toBe(404);
    expect((await managerPage.request.get(`/api/leads/${records.leads[2].id}`)).status()).toBe(404);
    await managerPage.goto('/leads');
    await expect(managerPage.getByRole('combobox',{name:'Carteira',exact:true}).locator('option')).toHaveText(['Meu','Minha equipe','Sem responsável']);
    await expect(managerPage.getByLabel('Vendedor para atribuição').locator('option')).not.toContainText([outside.name]);
    await fits(managerPage);
  }finally{await managerPage.close();await sellerPage.close();}
});

test('gerente atribui leads, distribui em round robin e transfere carteira com histórico',async({page,browser})=>{
  test.setTimeout(120000);
  await login(page,'distribution-admin');
  const person=await people(page.request);
  const manager=person('assignment-manager'),a=person('assignment-a'),b=person('assignment-b');
  const teamId=await team(page.request,'Equipe distribuição E2E',manager,[a,b]);
  const inactive=person('assignment-inactive'),outside=person('scope-outside');
  const managerPage=await browser.newPage({viewport:{width:1440,height:900}});
  try{
    await login(managerPage,'assignment-manager');
    await managerPage.goto('/equipe');
    const card=managerPage.locator('.commercial-team-card').filter({has:managerPage.getByRole('heading',{name:'Equipe distribuição E2E',exact:true})});
    await card.locator('.commercial-team-members > div').filter({hasText:b.name}).getByRole('button',{name:'Remover',exact:true}).click();
    await expect(managerPage.getByText('Vendedor removido.',{exact:true})).toBeVisible();
    await managerPage.getByLabel('Adicionar vendedor à Equipe distribuição E2E').selectOption({label:b.name});
    await expect(managerPage.getByText('Vendedor adicionado.',{exact:true})).toBeVisible();
    await card.getByRole('button',{name:'Ativar distribuição automática',exact:true}).click();
    await expect(card.getByRole('button',{name:'Desativar distribuição automática',exact:true})).toBeVisible();
    await fits(managerPage);

    // O primeiro lead passa pelo formulário real; os demais são apenas dados de preparação.
    await managerPage.goto('/leads/novo');
    await managerPage.getByLabel('Nome *',{exact:true}).fill('Distribuição72 manual');
    await managerPage.getByRole('combobox',{name:'Vendedor responsável',exact:true}).selectOption('');
    await managerPage.getByRole('button',{name:'Criar cadastro',exact:true}).click();
    await expect(managerPage.getByRole('heading',{name:'Distribuição72 manual',exact:true})).toBeVisible();
    const manualId=managerPage.url().split('/').pop()!;
    const bulk:RecordData[]=[],automatic:RecordData[]=[];
    for(let index=1;index<=2;index++)bulk.push(await create<RecordData>(page.request,'/api/leads',{name:`Distribuição72 lote ${index}`,owner_id:null}));
    for(let index=1;index<=3;index++)automatic.push(await create<RecordData>(page.request,'/api/leads',{name:`Distribuição72 automático ${index}`,owner_id:null}));
    await managerPage.goto('/leads');
    await managerPage.getByRole('combobox',{name:'Carteira',exact:true}).selectOption('unassigned');
    await managerPage.getByRole('textbox',{name:'Pesquisar leads'}).fill('Distribuição72');
    await expect(managerPage.locator('tbody tr')).toHaveCount(6);
    const sellerOptions=managerPage.getByLabel('Vendedor para atribuição').locator('option');
    await expect(sellerOptions).not.toContainText([inactive.name]);
    await expect(sellerOptions).not.toContainText([outside.name]);
    await managerPage.getByLabel('Selecionar Distribuição72 manual',{exact:true}).check();
    await managerPage.getByLabel('Vendedor para atribuição').selectOption(a.id);
    managerPage.once('dialog',dialog=>dialog.accept());
    await managerPage.getByRole('button',{name:'Atribuir responsável',exact:true}).click();
    await expect(managerPage.getByRole('status').filter({hasText:'1 lead(s) atribuídos.'})).toBeVisible();
    await expect(managerPage.getByLabel('Selecionar Distribuição72 manual',{exact:true})).toHaveCount(0);
    for(const lead of bulk)await managerPage.getByLabel(`Selecionar ${lead.name}`,{exact:true}).check();
    managerPage.once('dialog',dialog=>dialog.accept());
    await managerPage.getByRole('button',{name:'Atribuir responsável',exact:true}).click();
    await expect(managerPage.getByRole('status').filter({hasText:'2 lead(s) atribuídos.'})).toBeVisible();
    await expect(managerPage.locator('tbody tr')).toHaveCount(3);
    await managerPage.getByLabel('Selecionar leads da página',{exact:true}).check();
    await managerPage.getByLabel('Equipe para distribuição automática').selectOption(teamId);
    managerPage.once('dialog',dialog=>dialog.accept());
    await managerPage.getByRole('button',{name:'Distribuição automática',exact:true}).click();
    await expect(managerPage.getByRole('status').filter({hasText:'3 lead(s) atribuídos.'})).toBeVisible();
    await expect(managerPage.getByRole('heading',{name:'Nenhum cadastro encontrado'})).toBeVisible();
    const assigned:RecordData[]=[];
    for(const lead of [...automatic].sort((left,right)=>left.id.localeCompare(right.id))){
      const response=await page.request.get(`/api/leads/${lead.id}`);expect(response.status()).toBe(200);assigned.push(await response.json() as RecordData);
    }
    expect(assigned[0].owner_id).toBe(assigned[2].owner_id);
    expect(assigned[0].owner_id).not.toBe(assigned[1].owner_id);
    for(const lead of assigned)expect([a.id,b.id]).toContain(lead.owner_id);
    expect((await managerPage.request.post('/api/leads/distribute',{headers:{origin},data:{mode:'manual',owner_id:outside.id,leads:[{id:assigned[0].id,version:assigned[0].version}]}})).status()).toBe(403);
    expect((await page.request.post('/api/leads/distribute',{headers:{origin},data:{mode:'manual',owner_id:inactive.id,leads:[{id:assigned[0].id,version:assigned[0].version}]}})).status()).toBe(400);
    const customer=await create<RecordData>(page.request,'/api/customers',{name:'Distribuição72 cliente transferido',owner_id:a.id});
    const company=await create<RecordData>(page.request,'/api/companies',{name:'Distribuição72 empresa transferida',owner_id:a.id,person_type:'PJ'});
    const opportunity=await create<{id:string}>(page.request,'/api/opportunities',{title:'Distribuição72 oportunidade transferida',customer_id:customer.id,owner_id:a.id});
    const task=await create<{id:string}>(page.request,'/api/tasks',{title:'Distribuição72 tarefa transferida',opportunity_id:opportunity.id,owner_id:a.id,due_date:'2026-12-20'});
    await managerPage.locator('summary').filter({hasText:'Transferir carteira'}).click();
    await managerPage.getByLabel('Vendedor origem',{exact:true}).selectOption(a.id);
    await managerPage.getByLabel('Vendedor destino',{exact:true}).selectOption(b.id);
    await expect(managerPage.getByRole('button',{name:'Transferir carteira',exact:true})).toBeDisabled();
    await managerPage.getByLabel('Confirmo a transferência manual').check();
    await fits(managerPage);
    managerPage.once('dialog',dialog=>dialog.accept());
    await managerPage.getByRole('button',{name:'Transferir carteira',exact:true}).click();
    await expect(managerPage.getByRole('status').filter({hasText:/Transferidos \d+ cadastros, 1 oportunidades e 1 tarefas/})).toBeVisible();
    for(const [resource,id] of [['leads',manualId],['customers',customer.id],['companies',company.id],['opportunities',opportunity.id],['tasks',task.id]]){
      const response=await page.request.get(`/api/${resource}/${id}`);expect(response.status()).toBe(200);expect((await response.json()).owner_id).toBe(b.id);
    }
    await managerPage.goto(`/leads/${manualId}`);
    await managerPage.getByRole('button',{name:'Atividades',exact:true}).click();
    await expect(managerPage.locator('.crm-feed-item').filter({hasText:`${a.name} -> ${b.name}`})).toBeVisible();
    const history=await managerPage.request.get(`/api/activities?record_id=${manualId}`);
    expect(history.status()).toBe(200);
    expect((await history.json()).items).toEqual(expect.arrayContaining([expect.objectContaining({action:'portfolio.transferred',detail:`${a.name} -> ${b.name}`})]));
    await fits(managerPage);
  }finally{await managerPage.close();}
});
