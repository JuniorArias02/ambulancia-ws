import { ConfigService } from '@nestjs/config';
import { NoAutenticadoError } from '../../../../../common/exceptions/errores_dominio.js';
import type { VariablesEntorno } from '../../../../../config/variables_entorno.js';
import { ApiVerificadorSesiones } from '../../../infrastructure/services/api_verificador_sesiones.service.js';

const CLAVE = 'clave-interna-de-prueba-con-32-caracteres';

function responder(status: number, cuerpo: unknown): Response {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('ApiVerificadorSesiones', () => {
  let fetchFalso: ReturnType<typeof vi.fn<typeof fetch>>;
  let verificador: ApiVerificadorSesiones;

  beforeEach(() => {
    fetchFalso = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchFalso);
    verificador = new ApiVerificadorSesiones(
      new ConfigService<VariablesEntorno, true>({
        API_URL: 'http://api:3000/api/v1/',
        CLAVE_INTERNA: CLAVE,
      }),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it('pregunta a la API con la clave interna y devuelve la sesión', async () => {
    fetchFalso.mockResolvedValue(
      responder(200, {
        usuarioId: 'u1',
        rol: 'despachador',
        expiraEn: '2026-10-24T20:00:00.000Z',
      }),
    );

    const sesion = await verificador.verificar('token-1');

    const [url, opciones] = fetchFalso.mock.calls[0] ?? [];
    expect(url).toBe('http://api:3000/api/v1/interno/sesiones/verificar');
    expect(opciones?.headers).toEqual(
      expect.objectContaining({ 'x-clave-interna': CLAVE }),
    );
    expect(opciones?.body).toBe(JSON.stringify({ token: 'token-1' }));
    expect(sesion).toEqual({
      usuarioId: 'u1',
      rol: 'despachador',
      expiraEn: new Date('2026-10-24T20:00:00.000Z'),
    });
  });

  it('una sesión inválida es un error de autenticación', async () => {
    fetchFalso.mockResolvedValue(
      responder(401, { mensaje: 'Sesión inválida o expirada' }),
    );

    await expect(verificador.verificar('token-1')).rejects.toThrow(
      NoAutenticadoError,
    );
  });

  it('una clave interna rechazada no saca al usuario de su sesión', async () => {
    fetchFalso.mockResolvedValue(responder(403, { mensaje: 'Clave' }));

    const error: unknown = await verificador.verificar('t').catch((e) => e);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(NoAutenticadoError);
  });

  it('desconfía de un rol que no existe', async () => {
    fetchFalso.mockResolvedValue(
      responder(200, {
        usuarioId: 'u1',
        rol: 'superusuario',
        expiraEn: '2026-10-24T20:00:00.000Z',
      }),
    );

    const error: unknown = await verificador.verificar('t').catch((e) => e);

    expect(error).not.toBeInstanceOf(NoAutenticadoError);
    expect(error).toBeInstanceOf(Error);
  });
});
