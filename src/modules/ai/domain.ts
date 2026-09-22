import {z} from 'zod';

export const commercialAiActions=['summarize','suggest_reply','next_action','missing_information','follow_up','closing_support'] as const;
export type CommercialAiAction=(typeof commercialAiActions)[number];
export const commercialAiRequest=z.object({
 conversation_id:z.uuid(),
 action:z.enum(commercialAiActions),
 request_id:z.uuid(),
}).strict();
export const aiSettingsInput=z.object({
 enabled:z.boolean(),provider:z.literal('openai').default('openai'),
 model:z.string().trim().min(1).max(100),context_message_limit:z.number().int().min(10).max(50),
 max_requests_per_hour:z.number().int().min(1).max(500),version:z.number().int().positive().nullable(),
}).strict();
const short=z.string().trim().max(4000);
export const commercialAiOutput=z.object({
 summary:short,intent:z.string().trim().max(160),objections:z.array(z.string().trim().max(300)).max(10),
 missingInformation:z.array(z.string().trim().max(300)).max(15),nextAction:short,suggestedQuestion:short,
 suggestedReply:short,followUp:short,closingSupport:short,
}).strict();
export type CommercialAiOutput=z.infer<typeof commercialAiOutput>;
export type CommercialAiContext={
 contact:{name:string;kind:string;source:string;tags:string[];responsible:string};
 conversation:{messages:{direction:'customer'|'team';at:string;content:string}[];messageCount:number};
 commercial:{stage:string;opportunity:string;proposal:{name:string;value:string;validUntil:string;status:string}|null;openTasks:{title:string;dueDate:string;status:string}[]};
 solar:{averageConsumptionKwh:string;propertyType:string;roofType:string;sizing:{systemPowerKwp:string;moduleCount:number;estimatedMonthlyGenerationKwh:string}|null}|null;
};
