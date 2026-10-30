/**
 * Eventos que la API puede publicar. Sus datos los define la API
 * (`back/api/src/modules/notifications/presentation/dto/eventos_tiempo_real.dto.ts`);
 * este servidor no los interpreta, solo los reparte.
 */
export const EVENTOS_NEGOCIO = [
  'emergencia.creada',
  'emergencia.actualizada',
  'emergencia.posible_duplicado',
  'asignacion.creada',
  'asignacion.actualizada',
  'asignacion.ruta_actualizada',
  'ambulancia.actualizada',
  'ambulancia.ubicacion_actualizada',
  'turno.actualizado',
  'mi_servicio.actualizado',
] as const;

export type EventoNegocio = (typeof EVENTOS_NEGOCIO)[number];

/** Sobre que recibe el cliente: el `id` le permite descartar repetidos. */
export interface EventoTiempoReal {
  id: string;
  tipo: EventoNegocio;
  /** ISO 8601, puesto por la API. */
  ocurridoEn: string;
  datos: Record<string, unknown>;
}
