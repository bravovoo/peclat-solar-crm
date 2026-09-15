'use client';
import { useEffect,useRef } from 'react';
import { X } from 'lucide-react';
export function Modal({title,children,onClose}:{title:string;children:React.ReactNode;onClose:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null;const el=dialog.current;const overflow=document.body.style.overflow;document.body.style.overflow='hidden';el?.showModal();return()=>{el?.close();document.body.style.overflow=overflow;previous?.focus();};},[]);
 return <dialog ref={dialog} className="crm-modal" aria-labelledby="modal-title" onCancel={e=>{e.preventDefault();onClose();}}><div className="crm-modal-header"><h2 id="modal-title">{title}</h2><button className="icon-button" aria-label="Fechar janela" onClick={onClose}><X size={20}/></button></div>{children}</dialog>;
}
