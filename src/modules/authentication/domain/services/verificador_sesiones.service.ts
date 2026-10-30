import type { NombreRol } from '../../../../common/constants/roles.js';

export interface SesionVerificada {
  usuarioId: string;
  rol: NombreRol;
  /** La conexión no debe sobrevivir al token. */
  expiraEn: Date;
}

export abstract class VerificadorSesiones {
  /**
   * Lanza `NoAutenticadoError` si el token o la sesión no son válidos;
   * cualquier otro error es un fallo transitorio que se puede reintentar.
   */
  abstract verificar(token: string): Promise<SesionVerificada>;
}
