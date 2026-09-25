export class ApiError extends Error{constructor(message:string,public status:number,public data:Record<string,unknown>={}){super(message);}}
export async function api<T>(url:string,method='GET',body?:unknown,signal?:AbortSignal):Promise<T>{
 const result=await fetch(url,{method,headers:body!==undefined?{'Content-Type':'application/json'}:undefined,body:body!==undefined?JSON.stringify(body):undefined,signal,cache:'no-store'});
 const raw=await result.text();
 if(!raw.trim())throw new ApiError(result.ok?'O servidor não retornou os dados esperados. Tente novamente.':'Serviço indisponível no momento. Tente novamente.',result.ok?502:result.status);
 let data:unknown;
 try{data=JSON.parse(raw);}catch{throw new ApiError(result.ok?'O servidor retornou uma resposta inválida. Tente novamente.':'Serviço indisponível no momento. Tente novamente.',result.ok?502:result.status);}
 const details=data!==null&&typeof data==='object'&&!Array.isArray(data)?data as Record<string,unknown>:{};
 if(!result.ok)throw new ApiError(typeof details.error==='string'?details.error:'Não foi possível concluir.',result.status,details);return data as T;
}
export const errorMessage=(e:unknown)=>e instanceof Error?e.message:'Não foi possível conectar. Tente novamente.';
