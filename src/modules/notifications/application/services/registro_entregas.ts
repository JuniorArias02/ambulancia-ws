import { Injectable } from '@nestjs/common';

/** Bastante más que la suma de los reintentos de la API (unos 14 s). */
export const VENTANA_DEDUPLICACION_MS = 10 * 60_000;

/**
 * Recuerda los eventos ya entregados. Si la API reintenta porque no recibió
 * la respuesta, pero la primera entrega sí llegó, no se repite a los clientes.
 */
@Injectable()
export class RegistroEntregas {
  private readonly entregados = new Map<string, number>();

  /** `true` si es la primera vez que se ve el evento. */
  registrar(id: string, ahora: number = Date.now()): boolean {
    this.olvidarVencidos(ahora);
    if (this.entregados.has(id)) return false;
    this.entregados.set(id, ahora);
    return true;
  }

  /** El Map conserva el orden de inserción: los más viejos van primero. */
  private olvidarVencidos(ahora: number): void {
    for (const [id, registradoEn] of this.entregados) {
      if (ahora - registradoEn < VENTANA_DEDUPLICACION_MS) return;
      this.entregados.delete(id);
    }
  }
}
