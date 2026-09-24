'use client';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {Bell,Check} from 'lucide-react';
import {api} from '@/components/crm/api';

type Notification={id:string;title:string;detail:string;entity_type:string;entity_id:string|null;read_at:string|null;created_at:string};
export function NotificationCenter(){
 const [items,setItems]=useState<Notification[]>([]),[open,setOpen]=useState(false);const root=useRef<HTMLDivElement>(null);
 useEffect(()=>{let active=true;async function load(){try{const result=await api<{items:Notification[]}>('/api/notifications');if(active)setItems(result.items);}catch{}}void load();const timer=setInterval(load,30000);return()=>{active=false;clearInterval(timer);};},[]);
 useEffect(()=>{if(!open)return;const close=(event:MouseEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false);};document.addEventListener('mousedown',close);return()=>document.removeEventListener('mousedown',close);},[open]);
 const unread=items.filter(item=>!item.read_at).length;
 async function read(item:Notification){if(!item.read_at){await api('/api/notifications','POST',{notification_id:item.id});setItems(current=>current.map(value=>value.id===item.id?{...value,read_at:new Date().toISOString()}:value));}setOpen(false);}
 return <div className="notification-center" ref={root}><button className="icon-button" aria-label={`Notificações${unread?` (${unread} não lidas)`:''}`} aria-expanded={open} onClick={()=>setOpen(value=>!value)}><Bell size={18}/>{unread>0&&<b>{Math.min(unread,99)}</b>}</button>{open&&<div className="notification-popover"><header><strong>Notificações</strong><span>{unread} não lida{unread===1?'':'s'}</span></header>{items.length?items.map(item=><Link key={item.id} className={item.read_at?'':'unread'} href={item.entity_type==='lead'&&item.entity_id?`/leads/${item.entity_id}`:'#'} onClick={()=>void read(item)}><span>{item.read_at?<Check size={14}/>:<i/>}<strong>{item.title}</strong></span><small>{item.detail}</small></Link>):<p>Nenhuma notificação.</p>}</div>}</div>;
}
