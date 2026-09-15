'use client';
import { useEffect,useState } from 'react';
import { api,errorMessage } from './api';
export function useRemote<T>(url:string|null,revision=0){
 const key=`${url}:${revision}`;const [result,setResult]=useState<{key:string;data?:T;error?:string}>({key:''});
 useEffect(()=>{if(!url)return;const controller=new AbortController();const timer=setTimeout(()=>{api<T>(url,'GET',undefined,controller.signal).then(data=>setResult({key,data})).catch(error=>{if(!controller.signal.aborted)setResult({key,error:errorMessage(error)});});},200);return()=>{clearTimeout(timer);controller.abort();};},[url,key]);
 return {data:result.key===key?result.data:undefined,error:result.key===key?result.error:undefined,loading:!!url&&result.key!==key};
}
