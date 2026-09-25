import assert from 'node:assert/strict';
import test from 'node:test';
import {api,ApiError} from '../src/components/crm/api';

async function withResponse(response:Response,run:()=>Promise<void>){
 const previous=globalThis.fetch;
 globalThis.fetch=async()=>response;
 try{await run();}finally{globalThis.fetch=previous;}
}

test('cliente de API aceita JSON válido e preserva arrays',async()=>{
 await withResponse(Response.json([{id:'1'}]),async()=>assert.deepEqual(await api<{id:string}[]>('/api/test'),[{id:'1'}]));
});

test('cliente de API trata resposta vazia sem expor erro técnico de JSON',async()=>{
 await withResponse(new Response(null,{status:503}),async()=>{
  await assert.rejects(()=>api('/api/test'),error=>error instanceof ApiError&&error.status===503&&error.message==='Serviço indisponível no momento. Tente novamente.');
 });
});

test('cliente de API trata JSON inválido com mensagem segura',async()=>{
 await withResponse(new Response('resposta interrompida',{status:200,headers:{'content-type':'application/json'}}),async()=>{
  await assert.rejects(()=>api('/api/test'),error=>error instanceof ApiError&&error.status===502&&error.message==='O servidor retornou uma resposta inválida. Tente novamente.');
 });
});
