/**
 * El token o la sesión no son válidos: el cliente debe volver a iniciar sesión.
 * Cualquier otro error se trata como un fallo transitorio.
 */
export class NoAutenticadoError extends Error {
  constructor(mensaje = 'Sesión inválida o expirada') {
    super(mensaje);
    this.name = new.target.name;
  }
}
