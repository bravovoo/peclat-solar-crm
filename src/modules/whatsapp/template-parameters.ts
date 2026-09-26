export type WhatsAppTemplateParameterValues={header:string[];body:string[]};

type TemplateContext={recordName?:string|null;recordKind?:string|null;profileName?:string|null};
type TemplateShape={name:string;header_parameters:number;body_parameters:number};

const recoveryTemplates=new Set([
 'peclat_recuperacao_lead_1',
 'peclat_recuperacao_lead_2',
 'peclat_recuperacao_lead_3',
]);

function usableName(value:string|null|undefined){
 const normalized=(value??'').replace(/\s+/g,' ').trim();
 if(!normalized||/^\+?\d+$/.test(normalized)||/^(n[aã]o identificad[oa]|contato whatsapp)$/i.test(normalized))return '';
 return normalized;
}

export function whatsappTemplateFirstName(context:TemplateContext){
 const candidates=context.recordKind==='lead'
  ?[context.recordName,context.profileName]
  :[context.recordName,context.profileName];
 const name=candidates.map(usableName).find(Boolean);
 return name?.split(' ')[0]||'Cliente';
}

export function inferWhatsAppTemplateParameters(template:TemplateShape,context:TemplateContext):WhatsAppTemplateParameterValues{
 const values={
  header:Array.from({length:template.header_parameters},()=>''),
  body:Array.from({length:template.body_parameters},()=>''),
 };
 if(recoveryTemplates.has(template.name)&&values.body.length)values.body[0]=whatsappTemplateFirstName(context);
 return values;
}

export function renderWhatsAppTemplateText(text:string,values:string[]){
 return text.replace(/\{\{\s*(\d+)\s*\}\}/g,(placeholder,_position:string)=>values[Number(_position)-1]?.trim()||placeholder);
}
