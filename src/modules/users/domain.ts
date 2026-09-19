import {z} from 'zod';
import {emailSchema} from '@/modules/auth/validation';
import {uuid} from '@/modules/crm/domain';
export const managedRoles=['admin','manager','seller','technician','support','postsales'] as const;
export const userCreateInput=z.object({name:z.string().trim().min(2).max(180),email:emailSchema,role_code:z.enum(managedRoles),active:z.boolean().default(true)}).strict();
export const userUpdateInput=z.object({name:z.string().trim().min(2).max(180),role_code:z.enum(managedRoles),active:z.boolean(),version:z.number().int().positive()}).strict();
export const userId=uuid;
export type ManagedUser={id:string;name:string;email:string;role_code:typeof managedRoles[number];role_name:string;active:boolean;team_name:string|null;last_access:string|null;created_at:string;version:number};
