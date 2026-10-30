import { type NombreRol, Roles } from '../../../common/constants/roles.js';

/**
 * Nombres compartidos con la API (`back/api/src/modules/notifications/domain/
 * salas_tiempo_real.ts`): ella elige a qué sala va cada evento; aquí se decide
 * quién entra a cada sala.
 */

/** Panel de coordinación: hoy administradores y despachadores ven lo mismo. */
export const SALA_CENTRAL = 'central';

const ROLES_CENTRAL: readonly NombreRol[] = [
  Roles.ADMINISTRADOR,
  Roles.DESPACHADOR,
];

/** Los identificadores de usuario son UUID. */
export const PATRON_SALA =
  /^(central|usuario:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export function salaDeUsuario(usuarioId: string): string {
  return `usuario:${usuarioId}`;
}

/**
 * El servidor decide las salas según el rol que validó la API; el cliente
 * nunca las elige. Cada persona solo entra a la suya.
 */
export function salasPermitidas(usuarioId: string, rol: NombreRol): string[] {
  const salas = [salaDeUsuario(usuarioId)];
  if (ROLES_CENTRAL.includes(rol)) salas.push(SALA_CENTRAL);
  return salas;
}
