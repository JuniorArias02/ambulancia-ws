import type { NombreRol } from '../../../../common/constants/roles.js';
import type { EventoNegocio, EventoTiempoReal } from '../../domain/eventos.js';

export interface ConexionEstablecidaDto {
  usuarioId: string;
  rol: NombreRol;
  salas: string[];
}

export interface ErrorTiempoRealDto {
  mensaje: string;
}

/** Todo lo que el servidor puede enviar, para tipar Socket.IO. */
export type EventosServidorCliente = Record<
  EventoNegocio,
  (evento: EventoTiempoReal) => void
> & {
  conectado: (datos: ConexionEstablecidaDto) => void;
  /** El cliente debe cerrar la sesión: no sirve reintentar con el mismo token. */
  error_autenticacion: (datos: ErrorTiempoRealDto) => void;
  /** Fallo transitorio: el cliente puede reconectar más tarde. */
  error_conexion: (datos: ErrorTiempoRealDto) => void;
};

/** El cliente no envía eventos: toda acción va por el REST. */
export type EventosClienteServidor = Record<never, never>;
