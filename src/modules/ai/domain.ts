import {z} from 'zod';

export const commercialAiActions=['summarize','suggest_reply','next_action','missing_information','follow_up','closing_support','rewrite_message'] as const;
export type CommercialAiAction=(typeof commercialAiActions)[number];
export const commercialAiRequest=z.discriminatedUnion('action',[
 z.object({conversation_id:z.uuid(),action:z.enum(['summarize','suggest_reply','next_action','missing_information','follow_up','closing_support']),request_id:z.uuid()}).strict(),
 z.object({conversation_id:z.uuid().optional(),action:z.literal('rewrite_message'),request_id:z.uuid(),draft:z.string().trim().min(1).max(4096),previous_suggestion:z.string().trim().min(1).max(4000).optional()}).strict(),
]);
export const aiSettingsInput=z.object({
 enabled:z.boolean(),provider:z.enum(['gemini','openai']),
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
