export type Actor = {
  userId: string; organizationId: string; name: string; email: string;
  organizationName: string; organizationSlug: string; role: string; roleName: string;
  permissions: string[];
};
export class AccessError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function requirePermission(actor: Actor, permission: string) {
  if (!actor.permissions.includes(permission)) throw new AccessError(403, 'Seu perfil não tem acesso a esta área.');
}
// Aplicar ao repositório do domínio quando os registros comerciais forem introduzidos.
export function recordScope(actor: Actor, allPermission: string) {
  return { organizationId: actor.organizationId, ownerId: actor.permissions.includes(allPermission) ? undefined : actor.userId };
}
