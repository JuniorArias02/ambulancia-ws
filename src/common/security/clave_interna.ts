import { createHash, timingSafeEqual } from 'node:crypto';

/** Cabecera con la que se autentican entre sí la API y este servidor. */
export const CABECERA_CLAVE_INTERNA = 'x-clave-interna';

/** Se comparan huellas de igual longitud para que el tiempo no revele la clave. */
export function coincideClave(recibida: string, esperada: string): boolean {
  return timingSafeEqual(huellaDe(recibida), huellaDe(esperada));
}

function huellaDe(valor: string): Buffer {
  return createHash('sha256').update(valor).digest();
}
