import { z } from 'zod';

export const teamId = z.uuid();
export const commercialTeamInput = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).default(''),
  manager_user_id: teamId,
  active: z.boolean().default(true),
  version: z.number().int().positive().optional(),
}).strict();

export const teamMemberInput = z.object({
  user_id: teamId,
  action: z.enum(['add', 'remove']),
}).strict();

export type CommercialTeam = {
  id: string; name: string; description: string; manager_user_id: string;
  manager_name: string; active: boolean; auto_distribute: boolean; version: number; member_count: number;
  created_at: string; updated_at: string;
};
export type CommercialTeamMember = {
  id: string; name: string; email: string; role_code: string; role_name: string;
  active: boolean; team_id: string | null; team_name: string | null;
  manager_name: string | null; leads: number; customers: number;
  opportunities_open: number; tasks_open: number;
};
