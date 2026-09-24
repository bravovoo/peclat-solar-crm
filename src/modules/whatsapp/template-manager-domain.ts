import {z} from 'zod';

export const templateDraftStatuses=['DRAFT','SUBMITTING','PENDING','APPROVED','REJECTED','PAUSED','DISABLED','IN_APPEAL','PENDING_DELETION','DELETED','LIMIT_EXCEEDED','UNKNOWN','UNCERTAIN'] as const;
export type TemplateDraftStatus=typeof templateDraftStatuses[number];

export function bodyVariableCount(text:string){
 const matches=[...text.matchAll(/\{\{(\d+)\}\}/g)].map(match=>Number(match[1]));
 if(!matches.length)return 0;
 const unique=[...new Set(matches)].sort((a,b)=>a-b),max=Math.max(...unique);
 if(max>10||unique.length!==max||unique.some((value,index)=>value!==index+1))return -1;
 return max;
}

export function templateBodyComponents(bodyText:string,examples:string[]){
 return [{type:'BODY',text:bodyText,...(examples.length?{example:{body_text:[examples]}}:{})}];
}

export function renderTemplatePreview(bodyText:string,examples:string[]){
 return bodyText.replace(/\{\{(\d+)\}\}/g,(_,index:string)=>examples[Number(index)-1]??`{{${index}}}`);
}

const draftShape={
 name:z.string().trim().min(3).max(128).regex(/^[a-z0-9_]+$/,'Use somente letras minúsculas, números e sublinhado.'),
 category:z.enum(['MARKETING','UTILITY']),
 language:z.string().trim().regex(/^[a-z]{2}(?:_[A-Z]{2})?$/,'Use um idioma como pt_BR.'),
 body_text:z.string().trim().min(1,'Informe o texto do modelo.').max(1024),
 example_values:z.array(z.string().trim().min(1,'Preencha todos os exemplos.').max(120)).max(10),
};
const validateDraft=(value:{body_text:string;example_values:string[]},context:z.RefinementCtx)=>{
 const count=bodyVariableCount(value.body_text);
 if(count<0)context.addIssue({code:'custom',path:['body_text'],message:'As variáveis devem ser sequenciais, de {{1}} até {{10}}, sem lacunas.'});
 if(/[{}]/.test(value.body_text.replace(/\{\{\d+\}\}/g,'')))context.addIssue({code:'custom',path:['body_text'],message:'Use variáveis no formato {{1}}, {{2}} e assim por diante.'});
 if(count>=0&&value.example_values.length!==count)context.addIssue({code:'custom',path:['example_values'],message:`Informe exatamente ${count} exemplo(s), um para cada variável.`});
 if(/^\s*\{\{\d+\}\}/.test(value.body_text)||/\{\{\d+\}\}\s*$/.test(value.body_text))context.addIssue({code:'custom',path:['body_text'],message:'O texto não pode começar ou terminar com uma variável.'});
 if(/\}\}\s*\{\{/.test(value.body_text))context.addIssue({code:'custom',path:['body_text'],message:'Separe variáveis consecutivas com texto fixo.'});
};

export const templateDraftCreateInput=z.object(draftShape).strict().superRefine(validateDraft);
export const templateDraftUpdateInput=z.object({...draftShape,version:z.number().int().positive()}).strict().superRefine(validateDraft);
export const templateDraftSubmitInput=z.object({version:z.number().int().positive(),confirmation:z.literal(true)}).strict();
