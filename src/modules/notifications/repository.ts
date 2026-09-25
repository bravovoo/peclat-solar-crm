import {z} from 'zod';
import {database} from '@/server/db';
import {AccessError,type Actor} from '@/modules/auth/policy';

export const notificationReadInput=z.object({notification_id:z.uuid()}).strict();

export async function listUserNotifications(actor:Actor){
 const result=await database().query('SELECT id,notification_type,title,detail,entity_type,entity_id,read_at,created_at FROM user_notifications WHERE organization_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 30',[actor.organizationId,actor.userId]);
 return {items:result.rows,unread:result.rows.filter(row=>!row.read_at).length};
}

export async function markUserNotificationRead(actor:Actor,id:string){
 const result=await database().query('UPDATE user_notifications SET read_at=COALESCE(read_at,now()) WHERE organization_id=$1 AND user_id=$2 AND id=$3 RETURNING id',[actor.organizationId,actor.userId,id]);
 if(!result.rowCount)throw new AccessError(404,'Notificação não encontrada.');
 return {ok:true};
}
