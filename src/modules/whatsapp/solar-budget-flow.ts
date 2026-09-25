export const SOLAR_FLOW_TECHNICAL_NAME='peclat_solicitar_orcamento_solar';
export const SOLAR_FLOW_DISPLAY_NAME='Peclat Solar - Solicitar Orçamento';
export const SOLAR_FLOW_JSON_VERSION='7.3';

const states=['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'].map(value=>({id:value,title:value}));
const choices=(items:string[])=>items.map((title,index)=>({id:String(index+1),title}));
const data=(names:string[])=>Object.fromEntries(names.map(name=>[name,{type:'string',__example__:''}]));
const navigate=(name:string,payload:Record<string,string>)=>({name:'navigate',next:{type:'screen',name},payload});

export function solarBudgetFlowJson(){
 return {
  version:SOLAR_FLOW_JSON_VERSION,
  screens:[
   {id:'IDENTIFICATION',title:'Solicite seu orçamento',data:{},layout:{type:'SingleColumnLayout',children:[{type:'Form',name:'identification',children:[
    {type:'TextBody',text:'Preencha algumas informações para que nossa equipe possa analisar seu projeto de energia solar.'},
    {type:'TextInput',name:'full_name',label:'Nome completo',required:true,'input-type':'text'},
    {type:'TextInput',name:'city',label:'Cidade',required:true,'input-type':'text'},
    {type:'Dropdown',name:'state',label:'Estado',required:true,'data-source':states},
    {type:'Dropdown',name:'property_type',label:'Tipo de imóvel',required:true,'data-source':choices(['Residencial','Comercial','Industrial','Rural','Condomínio','Outro'])},
    {type:'Footer',label:'Continuar','on-click-action':navigate('CONSUMPTION',{full_name:'${form.full_name}',city:'${form.city}',state:'${form.state}',property_type:'${form.property_type}'})}
   ]}]}},
   {id:'CONSUMPTION',title:'Consumo',data:data(['full_name','city','state','property_type']),layout:{type:'SingleColumnLayout',children:[{type:'Form',name:'consumption',children:[
    {type:'TextBody',text:'Qual o valor médio da sua conta de energia? Você possui uma fatura disponível?'},
    {type:'TextInput',name:'average_bill',label:'Conta média (R$)','input-type':'number',required:true},
    {type:'RadioButtonsGroup',name:'has_bill',label:'Possui fatura?',required:true,'data-source':choices(['Sim','Não'])},
    {type:'Footer',label:'Continuar','on-click-action':navigate('PROJECT',{full_name:'${data.full_name}',city:'${data.city}',state:'${data.state}',property_type:'${data.property_type}',average_bill:'${form.average_bill}',has_bill:'${form.has_bill}'})}
   ]}]}},
   {id:'PROJECT',title:'Seu projeto',data:data(['full_name','city','state','property_type','average_bill','has_bill']),layout:{type:'SingleColumnLayout',children:[{type:'Form',name:'project',children:[
    {type:'RadioButtonsGroup',name:'property_owned',label:'O imóvel é próprio?',required:true,'data-source':choices(['Sim','Não'])},
    {type:'Dropdown',name:'commercial_interest',label:'Principal interesse',required:true,'data-source':choices(['Reduzir a conta de energia','Financiar o sistema','Comprar à vista','Sistema com baterias','Sistema para empresa','Ainda estou pesquisando'])},
    {type:'RadioButtonsGroup',name:'technical_visit',label:'Visita técnica?',required:true,'data-source':choices(['Sim','Não','Quero conversar primeiro'])},
    {type:'Footer',label:'Continuar','on-click-action':navigate('CONTACT',{full_name:'${data.full_name}',city:'${data.city}',state:'${data.state}',property_type:'${data.property_type}',average_bill:'${data.average_bill}',has_bill:'${data.has_bill}',property_owned:'${form.property_owned}',commercial_interest:'${form.commercial_interest}',technical_visit:'${form.technical_visit}'})}
   ]}]}},
   {id:'CONTACT',title:'Contato',data:data(['full_name','city','state','property_type','average_bill','has_bill','property_owned','commercial_interest','technical_visit']),layout:{type:'SingleColumnLayout',children:[{type:'Form',name:'contact',children:[
    {type:'RadioButtonsGroup',name:'preferred_contact_period',label:'Melhor período',required:true,'data-source':choices(['Manhã','Tarde','Noite'])},
    {type:'TextArea',name:'observations',label:'Observações','helper-text':'Opcional. Ex.: tenho ar-condicionado, piscina ou pretendo aumentar o consumo.'},
    {type:'Footer',label:'Revisar','on-click-action':navigate('CONFIRMATION',{full_name:'${data.full_name}',city:'${data.city}',state:'${data.state}',property_type:'${data.property_type}',average_bill:'${data.average_bill}',has_bill:'${data.has_bill}',property_owned:'${data.property_owned}',commercial_interest:'${data.commercial_interest}',technical_visit:'${data.technical_visit}',preferred_contact_period:'${form.preferred_contact_period}',observations:'${form.observations}'})}
   ]}]}},
   {id:'CONFIRMATION',title:'Obrigado!',terminal:true,success:true,data:data(['full_name','city','state','property_type','average_bill','has_bill','property_owned','commercial_interest','technical_visit','preferred_contact_period','observations']),layout:{type:'SingleColumnLayout',children:[
    {type:'TextHeading',text:'Recebemos as informações do seu projeto.'},
    {type:'TextBody',text:'Um consultor da Peclat Solar continuará o atendimento pelo WhatsApp.'},
    {type:'Footer',label:'Concluir','on-click-action':{name:'complete',payload:{full_name:'${data.full_name}',city:'${data.city}',state:'${data.state}',property_type:'${data.property_type}',average_bill:'${data.average_bill}',has_bill:'${data.has_bill}',property_owned:'${data.property_owned}',commercial_interest:'${data.commercial_interest}',technical_visit:'${data.technical_visit}',preferred_contact_period:'${data.preferred_contact_period}',observations:'${data.observations}'}}}
   ]}}
  ]
 };
}

export const solarBudgetDefaultMappings=[
 ['full_name','name','Nome completo'],['city','city','Cidade'],['state','state','Estado'],['property_type','property_type','Tipo de imóvel'],['average_bill','average_bill','Valor médio da conta'],['has_bill','has_bill','Possui fatura'],['property_owned','property_owned','Imóvel próprio'],['commercial_interest','commercial_interest','Interesse comercial'],['technical_visit','technical_visit','Visita técnica'],['preferred_contact_period','preferred_contact_period','Melhor período'],['observations','observations','Observações']
] as const;
