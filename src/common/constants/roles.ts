/**
 * Los mismos roles que el backend (`back/api/src/common/constants/roles.ts`).
 * Si allá cambian, hay que actualizarlos aquí.
 */
export const Roles = {
  ADMINISTRADOR: 'administrador',
  DESPACHADOR: 'despachador',
  PARAMEDICO: 'paramedico',
  CONDUCTOR: 'conductor',
  /** Reporta emergencias desde la app; solo sigue la ambulancia de su propio reporte. */
  CIUDADANO: 'ciudadano',
} as const;

export type NombreRol = (typeof Roles)[keyof typeof Roles];

export const NOMBRES_ROLES: readonly NombreRol[] = Object.values(Roles);

export function esRolValido(rol: string): rol is NombreRol {
  return NOMBRES_ROLES.some((valido) => valido === rol);
}
