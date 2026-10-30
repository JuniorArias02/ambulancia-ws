import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { esRolValido } from '../../../../common/constants/roles.js';
import { NoAutenticadoError } from '../../../../common/exceptions/errores_dominio.js';
import { CABECERA_CLAVE_INTERNA } from '../../../../common/security/clave_interna.js';
import type { VariablesEntorno } from '../../../../config/variables_entorno.js';
import {
  type SesionVerificada,
  VerificadorSesiones,
} from '../../domain/services/verificador_sesiones.service.js';

const TIEMPO_ESPERA_MS = 5_000;

/**
 * La API es la autoridad: verifica la firma del JWT, que la sesión no esté
 * revocada y que el usuario siga activo, y devuelve su rol vigente.
 */
@Injectable()
export class ApiVerificadorSesiones extends VerificadorSesiones {
  private readonly url: string;
  private readonly clave: string;

  constructor(configuracion: ConfigService<VariablesEntorno, true>) {
    super();
    const base = configuracion.get('API_URL', { infer: true });
    this.url = `${base.replace(/\/+$/, '')}/interno/sesiones/verificar`;
    this.clave = configuracion.get('CLAVE_INTERNA', { infer: true });
  }

  async verificar(token: string): Promise<SesionVerificada> {
    const respuesta = await fetch(this.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [CABECERA_CLAVE_INTERNA]: this.clave,
      },
      body: JSON.stringify({ token }),
      signal: AbortSignal.timeout(TIEMPO_ESPERA_MS),
    });

    if (respuesta.ok) return aSesionVerificada(await respuesta.json());
    // 401: sesión inválida; 400: token mal formado. Un 403 sería la clave
    // interna mal configurada: no es culpa del usuario y no lo saca de la sesión.
    if (respuesta.status === 401 || respuesta.status === 400) {
      throw new NoAutenticadoError(await mensajeDe(respuesta));
    }
    throw new Error(
      `La API respondió ${respuesta.status} al verificar la sesión`,
    );
  }
}

function aSesionVerificada(cuerpo: unknown): SesionVerificada {
  if (
    typeof cuerpo === 'object' &&
    cuerpo !== null &&
    'usuarioId' in cuerpo &&
    'rol' in cuerpo &&
    'expiraEn' in cuerpo &&
    typeof cuerpo.usuarioId === 'string' &&
    typeof cuerpo.rol === 'string' &&
    esRolValido(cuerpo.rol) &&
    typeof cuerpo.expiraEn === 'string'
  ) {
    const expiraEn = new Date(cuerpo.expiraEn);
    if (!Number.isNaN(expiraEn.getTime())) {
      return { usuarioId: cuerpo.usuarioId, rol: cuerpo.rol, expiraEn };
    }
  }
  throw new Error('La API devolvió una sesión con un formato inesperado');
}

/** El mensaje que el filtro de errores de la API pone en `mensaje`, si viene. */
async function mensajeDe(respuesta: Response): Promise<string> {
  const cuerpo: unknown = await respuesta.json().catch(() => null);
  return typeof cuerpo === 'object' &&
    cuerpo !== null &&
    'mensaje' in cuerpo &&
    typeof cuerpo.mensaje === 'string'
    ? cuerpo.mensaje
    : 'Sesión inválida o expirada';
}
