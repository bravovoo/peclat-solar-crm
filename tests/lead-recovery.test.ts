import {test} from 'node:test';
import assert from 'node:assert/strict';
import {leadFirstName} from '../src/modules/lead-recovery/engine';
import {assessLead,type LeadFact,type RecoveryConfig,type RecoveryStep} from '../src/modules/lead-recovery/eligibility';
import {recoverySettingsInput} from '../src/modules/lead-recovery/domain';

const now=new Date('2026-09-24T15:00:00Z');
const config:RecoveryConfig={organization_id:crypto.randomUUID(),enabled:true,include_uncontacted:true,timezone:'America/Sao_Paulo',business_hours:{},lead_stages:['contact'],seller_ids:[],version:1,updated_by:crypto.randomUUID()};
const steps:RecoveryStep[]=[{id:crypto.randomUUID(),position:1,delay_days:3,template_id:crypto.randomUUID(),header_parameters:[],body_parameters:[],template_name:'recuperar_lead',template_language:'pt_BR',template_status:'APPROVED',supported:true}];
function fact(overrides:Partial<LeadFact>={}):LeadFact{return {id:crypto.randomUUID(),name:'Lead fictício',stage:'contact',status:'active',owner_id:crypto.randomUUID(),owner_name:'Vendedor',created_at:'2026-09-01T12:00:00Z',updated_at:'2026-09-20T12:00:00Z',phone:'+5531999990000',consent_status:'opted_in',consent_source:'Formulário',consent_version:1,conversation_id:null,automations_paused:false,automation_blocked:false,last_inbound_at:null,last_manual_outbound_at:'2026-09-20T12:00:00Z',last_commercial_activity_at:null,future_task_at:null,has_won_opportunity:false,has_lost_opportunity:false,has_accepted_proposal:false,owner_active:true,enrollment_id:null,enrollment_status:null,enrollment_version:null,attempt_count:null,next_attempt_at:null,state_reason:null,...overrides};}

test('recuperação distingue sem resposta de não contatado e não reinicia com automação',()=>{
 const awaiting=assessLead(fact(),config,steps,now);assert.equal(awaiting.classification,'awaiting_reply');assert.equal(awaiting.eligible,true);assert.equal(awaiting.inactivity_anchor,'2026-09-20T12:00:00.000Z');
 const uncontacted=assessLead(fact({last_manual_outbound_at:null,last_commercial_activity_at:'2026-09-10T12:00:00Z'}),config,steps,now);assert.equal(uncontacted.classification,'not_contacted');assert.equal(uncontacted.inactivity_anchor,'2026-09-10T12:00:00.000Z');
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
 const hours=Object.fromEntries(['1','2','3','4','5','6','7'].map(day=>[day,{enabled:true,start:'08:00',end:'18:00'}]));
 const base={enabled:false,include_uncontacted:false,timezone:'America/Sao_Paulo',business_hours:hours,lead_stages:['contact'],seller_ids:[],steps:[{position:1,delay_days:3,template_id:crypto.randomUUID(),header_parameters:[],body_parameters:['Olá {{lead_name}}']}],version:1};
 assert.equal(recoverySettingsInput.parse(base).enabled,false);
 assert.throws(()=>recoverySettingsInput.parse({...base,organization_id:crypto.randomUUID()}));
 assert.throws(()=>recoverySettingsInput.parse({...base,steps:[{...base.steps[0],body_parameters:['{{phone}}']}]}));
});

test('recuperação usa primeiro nome e fallback seguro sem nome',()=>{
 assert.equal(leadFirstName('  Maria da Silva  '),'Maria');
 assert.equal(leadFirstName('João-Pedro Souza'),'João-Pedro');
 assert.equal(leadFirstName('   '),'Cliente');
 const hours=Object.fromEntries(['1','2','3','4','5','6','7'].map(day=>[day,{enabled:true,start:'08:00',end:'18:00'}]));
 const input={enabled:false,include_uncontacted:false,timezone:'America/Sao_Paulo',business_hours:hours,lead_stages:['contact'],seller_ids:[],steps:[{position:1,delay_days:3,template_id:crypto.randomUUID(),header_parameters:[],body_parameters:['Olá {{lead_first_name}}']}],version:1};
 assert.equal(recoverySettingsInput.safeParse(input).success,true);
});
