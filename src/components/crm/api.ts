export class ApiError extends Error{constructor(message:string,public status:number,public data:Record<string,unknown>={}){super(message);}}
export async function api<T>(url:string,method='GET',body?:unknown,signal?:AbortSignal):Promise<T>{
 const result=await fetch(url,{method,headers:body!==undefined?{'Content-Type':'application/json'}:undefined,body:body!==undefined?JSON.stringify(body):undefined,signal,cache:'no-store'});
 const data=await result.json();if(!result.ok)throw new ApiError(data.error??'Não foi possível concluir.',result.status,data);return data;
}
export const errorMessage=(e:unknown)=>e instanceof Error?e.message:'Não foi possível conectar. Tente novamente.';
