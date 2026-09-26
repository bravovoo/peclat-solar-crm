import {test} from 'node:test';
import assert from 'node:assert/strict';
import {leadFirstName} from '../src/modules/lead-recovery/engine';
import {assessLead,type LeadFact,type RecoveryConfig,type RecoveryStep} from '../src/modules/lead-recovery/eligibility';
import {recoverySettingsInput} from '../src/modules/lead-recovery/domain';

const now=new Date('2026-09-24T15:00:00Z');
const config:RecoveryConfig={organization_id:crypto.randomUUID(),enabled:true,include_uncontacted:true,timezone:'America/Sao_Paulo',business_hours:Object.fromEntries(['1','2','3','4','5','6','7'].map(d=>[d,{enabled:true,start:'10:00',end:'14:00'}])),lead_stages:['contact'],seller_ids:[],version:1,updated_by:crypto.randomUUID()};
const steps:RecoveryStep[]=[{id:crypto.randomUUID(),position:1,delay_days:3,template_id:crypto.randomUUID(),header_parameters:[],body_parameters:[],template_name:'recuperar_lead',template_language:'pt_BR',template_status:'APPROVED',supported:true}];
function fact(overrides:Partial<LeadFact>={}):LeadFact{return {id:crypto.randomUUID(),name:'Lead fictício',stage:'contact',status:'active',owner_id:crypto.randomUUID(),owner_name:'Vendedor',created_at:'2026-09-01T12:00:00Z',updated_at:'2026-09-20T12:00:00Z',phone:'+5531999990000',consent_status:'opted_in',consent_source:'Formulário',consent_version:1,service_started_at:null,service_source:'',conversation_id:crypto.randomUUID(),conversation_phone:'+5531999990000',anchor_message_id:crypto.randomUUID(),enrollment_anchor:null,enrollment_anchor_message_id:null,automations_paused:false,automation_blocked:false,last_inbound_at:null,last_manual_outbound_at:'2026-09-20T12:00:00Z',last_commercial_activity_at:null,future_task_at:null,has_won_opportunity:false,has_lost_opportunity:false,has_accepted_proposal:false,owner_active:true,enrollment_id:null,enrollment_status:null,enrollment_version:null,attempt_count:null,next_attempt_at:null,state_reason:null,...overrides};}

test('recuperação distingue sem resposta de não contatado e não reinicia com automação',()=>{
 const awaiting=assessLead(fact(),config,steps,now);assert.equal(awaiting.classification,'awaiting_reply');assert.equal(awaiting.eligible,true);assert.equal(awaiting.inactivity_anchor,'2026-09-20T12:00:00.000Z');
 const uncontacted=assessLead(fact({last_manual_outbound_at:null,last_commercial_activity_at:'2026-09-10T12:00:00Z'}),config,steps,now);assert.equal(uncontacted.eligible,false);assert.equal(uncontacted.inactivity_anchor,null);
 const replied=assessLead(fact({last_inbound_at:'2026-09-21T12:00:00Z'}),config,steps,now);assert.equal(replied.reason,'awaiting_seller');assert.equal(replied.eligible,false);
});

test('recuperação exclui consentimento, opt-out, tarefa futura e negociação concluída',()=>{
 assert.equal(assessLead(fact({consent_status:'unknown'}),config,steps,now).reason,'consent_required');
 assert.equal(assessLead(fact({consent_status:'opted_out'}),config,steps,now).reason,'opted_out');
 assert.equal(assessLead(fact({future_task_at:'2026-09-25T12:00:00Z'}),config,steps,now).reason,'follow_up_scheduled');
 assert.equal(assessLead(fact({has_won_opportunity:true}),config,steps,now).reason,'negotiation_concluded');
 assert.equal(assessLead(fact({has_lost_opportunity:true}),config,steps,now).reason,'negotiation_concluded');
});

test('configuração bloqueia campos extras e variáveis não autorizadas',()=>{
 const hours=Object.fromEntries(['1','2','3','4','5','6','7'].map(day=>[day,{enabled:true,start:'10:00',end:'14:00'}]));
 const base={enabled:false,include_uncontacted:false,timezone:'America/Sao_Paulo',business_hours:hours,lead_stages:['contact'],seller_ids:[],steps:[{position:1,delay_days:3,template_id:crypto.randomUUID(),header_parameters:[],body_parameters:['Olá {{lead_name}}']}],version:1};
 assert.equal(recoverySettingsInput.parse(base).enabled,false);
 assert.throws(()=>recoverySettingsInput.parse({...base,organization_id:crypto.randomUUID()}));
 assert.throws(()=>recoverySettingsInput.parse({...base,steps:[{...base.steps[0],body_parameters:['{{phone}}']}]}));
});

test('recuperação usa primeiro nome e fallback seguro sem nome',()=>{
 assert.equal(leadFirstName('  Maria da Silva  '),'Maria');
 assert.equal(leadFirstName('João-Pedro Souza'),'João-Pedro');
 assert.equal(leadFirstName('   '),'Cliente');
 const hours=Object.fromEntries(['1','2','3','4','5','6','7'].map(day=>[day,{enabled:true,start:'10:00',end:'14:00'}]));
 const input={enabled:false,include_uncontacted:false,timezone:'America/Sao_Paulo',business_hours:hours,lead_stages:['contact'],seller_ids:[],steps:[{position:1,delay_days:3,template_id:crypto.randomUUID(),header_parameters:[],body_parameters:['Olá {{lead_first_name}}']}],version:1};
 assert.equal(recoverySettingsInput.safeParse(input).success,true);
});
import {recoveryDueAt,recoveryIsOpen} from '../src/modules/lead-recovery/schedule';
test('janela fixa de São Paulo: limites, domingo e prazo absoluto',()=>{
 const hours=Object.fromEntries(['1','2','3','4','5','6','7'].map(d=>[d,{enabled:d!=='7',start:'08:00',end:'18:00'}]));
 for(const [date,expected] of [['2030-01-09T12:59:59Z',false],['2030-01-09T13:00:00Z',true],['2030-01-09T16:59:59Z',true],['2030-01-09T17:00:00Z',false],['2030-01-13T14:00:00Z',false]] as const)assert.equal(recoveryIsOpen(hours,new Date(date)),expected);
 assert.equal(recoveryDueAt('2030-01-11T21:00:00Z',2,hours).toISOString(),'2030-01-14T13:00:00.000Z');
});
test('quatro passos crescentes; quinto passo e inclusão de nunca contatados são rejeitados',()=>{
 const hours=Object.fromEntries(['1','2','3','4','5','6','7'].map(d=>[d,{enabled:true,start:'10:00',end:'14:00'}]));
 const input={enabled:false,include_uncontacted:false,timezone:'America/Sao_Paulo',business_hours:hours,lead_stages:['new'],seller_ids:[],steps:[2,5,7,10].map((d,i)=>({position:i+1,delay_days:d,template_id:crypto.randomUUID(),header_parameters:[],body_parameters:[]})),version:1};
 assert.equal(recoverySettingsInput.safeParse(input).success,true);
 assert.equal(recoverySettingsInput.safeParse({...input,include_uncontacted:true}).success,false);
 assert.equal(recoverySettingsInput.safeParse({...input,steps:[...input.steps,{...input.steps[3],position:5}]}).success,false);
 assert.equal(recoverySettingsInput.safeParse({...input,steps:input.steps.map(s=>({...s,delay_days:2}))}).success,false);
});
