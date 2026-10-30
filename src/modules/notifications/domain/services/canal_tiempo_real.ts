import type { EventoTiempoReal } from '../eventos.js';

/** Hacia los clientes conectados; lo implementa el gateway de Socket.IO. */
export abstract class CanalTiempoReal {
  abstract emitir(salas: readonly string[], evento: EventoTiempoReal): void;
}
