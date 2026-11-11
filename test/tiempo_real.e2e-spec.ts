import type { AddressInfo } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { io, type Socket } from 'socket.io-client';
import { NoAutenticadoError } from '../src/common/exceptions/errores_dominio.js';
import {
  type SesionVerificada,
  VerificadorSesiones,
} from '../src/modules/authentication/domain/services/verificador_sesiones.service.js';
import { INTERVALO_REVALIDACION_MS } from '../src/modules/notifications/presentation/gateways/tiempo_real.gateway.js';

const CLAVE = 'clave-interna-de-prueba-con-32-caracteres';
Object.assign(process.env, {
  NODE_ENV: 'test',
  PUERTO: '3999',
  CORS_ORIGENES: 'http://localhost:5173',
  API_URL: 'http://api.invalida:3000/api/v1',
  CLAVE_INTERNA: CLAVE,
});

const DESPACHADOR = '11111111-1111-4111-8111-111111111111';
const CONDUCTOR_A = '22222222-2222-4222-8222-222222222222';
const CONDUCTOR_B = '33333333-3333-4333-8333-333333333333';
const CIUDADANO_A = '44444444-4444-4444-8444-444444444444';
const CIUDADANO_B = '55555555-5555-4555-8555-555555555555';

/** Reemplaza a la API: cada token corresponde a una sesión, o falla. */
class VerificadorSesionesFalso extends VerificadorSesiones {
  readonly sesiones = new Map<string, SesionVerificada | Error>();

  verificar(token: string): Promise<SesionVerificada> {
    const sesion = this.sesiones.get(token);
    if (!sesion)
      return Promise.reject(new NoAutenticadoError('Token inválido'));
    return sesion instanceof Error
      ? Promise.reject(sesion)
      : Promise.resolve(sesion);
  }
}

function enUnaHora(): Date {
  return new Date(Date.now() + 3_600_000);
}

type Respuesta = { evento: string; datos: unknown };

describe('Servidor de tiempo real (E2E)', () => {
  let app: NestExpressApplication;
  let base: string;
  let verificador: VerificadorSesionesFalso;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    const { AppModule } = await import('../src/app.module.js');
    const { configurarAplicacion } =
      await import('../src/configurar_aplicacion.js');
    verificador = new VerificadorSesionesFalso();
    const modulo = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(VerificadorSesiones)
      .useValue(verificador)
      .compile();
    app = modulo.createNestApplication<NestExpressApplication>({
      logger: false,
    });
    configurarAplicacion(app);
    await app.listen(0, '127.0.0.1');
    const { port } = app.getHttpServer().address() as AddressInfo;
    base = `http://127.0.0.1:${port}`;
  });

  beforeEach(() => {
    verificador.sesiones.clear();
    verificador.sesiones.set('t-despachador', {
      usuarioId: DESPACHADOR,
      rol: 'despachador',
      expiraEn: enUnaHora(),
    });
    verificador.sesiones.set('t-conductor-a', {
      usuarioId: CONDUCTOR_A,
      rol: 'conductor',
      expiraEn: enUnaHora(),
    });
    verificador.sesiones.set('t-conductor-b', {
      usuarioId: CONDUCTOR_B,
      rol: 'conductor',
      expiraEn: enUnaHora(),
    });
    verificador.sesiones.set('t-ciudadano-a', {
      usuarioId: CIUDADANO_A,
      rol: 'ciudadano',
      expiraEn: enUnaHora(),
    });
    verificador.sesiones.set('t-ciudadano-b', {
      usuarioId: CIUDADANO_B,
      rol: 'ciudadano',
      expiraEn: enUnaHora(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    for (const socket of sockets.splice(0)) socket.disconnect();
  });

  afterAll(async () => {
    await app.close();
  });

  /** Primer evento de control: `conectado`, `error_autenticacion` o `error_conexion`. */
  function conectar(token?: string): Promise<{ socket: Socket } & Respuesta> {
    const socket = io(`${base}/tiempo-real`, {
      auth: token ? { token } : {},
      transports: ['websocket'],
      reconnection: false,
    });
    sockets.push(socket);
    return new Promise((resolver) => {
      for (const evento of [
        'conectado',
        'error_autenticacion',
        'error_conexion',
      ]) {
        socket.once(evento, (datos: unknown) =>
          resolver({ socket, evento, datos }),
        );
      }
    });
  }

  function escuchar(socket: Socket, evento: string): unknown[] {
    const recibidos: unknown[] = [];
    socket.on(evento, (datos: unknown) => recibidos.push(datos));
    return recibidos;
  }

  function publicar(
    envio: Record<string, unknown>,
    clave = CLAVE,
  ): Promise<Response> {
    return fetch(`${base}/interno/eventos`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-clave-interna': clave },
      body: JSON.stringify({
        id: crypto.randomUUID(),
        tipo: 'emergencia.creada',
        ocurridoEn: new Date().toISOString(),
        salas: ['central'],
        datos: { emergencia: { id: 'e1' } },
        ...envio,
      }),
    });
  }

  /** Da tiempo a que lleguen los paquetes por el WebSocket. */
  function pausa(): Promise<void> {
    return new Promise((resolver) => setTimeout(resolver, 100));
  }

  it('asigna las salas según el rol validado', async () => {
    const despachador = await conectar('t-despachador');
    const conductor = await conectar('t-conductor-a');

    expect(despachador.datos).toEqual({
      usuarioId: DESPACHADOR,
      rol: 'despachador',
      salas: [`usuario:${DESPACHADOR}`, 'central'],
    });
    expect(conductor.datos).toEqual({
      usuarioId: CONDUCTOR_A,
      rol: 'conductor',
      salas: [`usuario:${CONDUCTOR_A}`],
    });
  });

  it('rechaza conexiones sin token o con un token inválido', async () => {
    const sinToken = await conectar();
    const invalido = await conectar('t-falso');

    expect(sinToken.evento).toBe('error_autenticacion');
    expect(invalido.evento).toBe('error_autenticacion');
    await pausa();
    expect(invalido.socket.connected).toBe(false);
  });

  it('distingue una API caída de una sesión inválida', async () => {
    verificador.sesiones.set('t-caida', new Error('API no disponible'));

    const { evento } = await conectar('t-caida');

    expect(evento).toBe('error_conexion');
  });

  it('los eventos de la central no llegan a la tripulación', async () => {
    const despachador = await conectar('t-despachador');
    const conductor = await conectar('t-conductor-a');
    const enCentral = escuchar(despachador.socket, 'emergencia.creada');
    const enConductor = escuchar(conductor.socket, 'emergencia.creada');

    const respuesta = await publicar({});
    await pausa();

    expect(respuesta.status).toBe(202);
    expect(enCentral).toEqual([
      expect.objectContaining({
        tipo: 'emergencia.creada',
        datos: { emergencia: { id: 'e1' } },
      }),
    ]);
    expect(enCentral[0]).not.toHaveProperty('salas');
    expect(enConductor).toEqual([]);
  });

  it('un evento dirigido a un tripulante no llega a otro', async () => {
    const conductorA = await conectar('t-conductor-a');
    const conductorB = await conectar('t-conductor-b');
    const enA = escuchar(conductorA.socket, 'mi_servicio.actualizado');
    const enB = escuchar(conductorB.socket, 'mi_servicio.actualizado');

    await publicar({
      tipo: 'mi_servicio.actualizado',
      salas: [`usuario:${CONDUCTOR_A}`],
      datos: { turno: null, asignacion: null, emergencia: null },
    });
    await pausa();

    expect(enA).toHaveLength(1);
    expect(enB).toEqual([]);
  });

  it('solo la API con la clave interna puede publicar', async () => {
    const despachador = await conectar('t-despachador');
    const recibidos = escuchar(despachador.socket, 'emergencia.creada');

    const respuesta = await publicar(
      {},
      'otra-clave-con-mas-de-32-caracteres!',
    );
    await pausa();

    expect(respuesta.status).toBe(401);
    expect(recibidos).toEqual([]);
  });

  it('rechaza salas o eventos desconocidos', async () => {
    const sala = await publicar({ salas: ['usuario:*'] });
    const tipo = await publicar({ tipo: 'emergencia.borrada' });

    expect(sala.status).toBe(400);
    expect(tipo.status).toBe(400);
  });

  it('un reintento de la API no se entrega dos veces', async () => {
    const despachador = await conectar('t-despachador');
    const recibidos = escuchar(despachador.socket, 'emergencia.creada');
    const id = crypto.randomUUID();

    await publicar({ id });
    const repetido = await publicar({ id });
    await pausa();

    expect(await repetido.json()).toEqual({ resultado: 'duplicado' });
    expect(recibidos).toHaveLength(1);
  });

  it('desconecta cuando expira el token', async () => {
    verificador.sesiones.set('t-corto', {
      usuarioId: CONDUCTOR_A,
      rol: 'conductor',
      expiraEn: new Date(Date.now() + 300),
    });
    const { socket } = await conectar('t-corto');

    const error = await new Promise((resolver) =>
      socket.once('error_autenticacion', resolver),
    );

    expect(error).toEqual({ mensaje: 'La sesión expiró' });
  });

  it('desconecta al revalidar si la sesión fue cerrada o cambió el rol', async () => {
    vi.useFakeTimers({ toFake: ['setInterval'] });
    const cerrada = await conectar('t-conductor-a');
    const promovido = await conectar('t-conductor-b');
    const errores = [cerrada.socket, promovido.socket].map(
      (socket) =>
        new Promise((resolver) => socket.once('error_autenticacion', resolver)),
    );

    verificador.sesiones.delete('t-conductor-a');
    verificador.sesiones.set('t-conductor-b', {
      usuarioId: CONDUCTOR_B,
      rol: 'despachador',
      expiraEn: enUnaHora(),
    });
    vi.advanceTimersByTime(INTERVALO_REVALIDACION_MS);

    expect(await Promise.all(errores)).toEqual([
      { mensaje: 'Token inválido' },
      { mensaje: 'Sus permisos cambiaron; inicie sesión de nuevo' },
    ]);
  });

  describe('ciudadano', () => {
    const seguimiento = {
      seguimiento: {
        emergenciaId: 'e1',
        numeroEmergencia: 'EMG-20261104-0001',
        disponible: true,
        ambulancias: [],
      },
    };

    it('entra solo a su propia sala, nunca a la central', async () => {
      const { evento, datos } = await conectar('t-ciudadano-a');

      expect(evento).toBe('conectado');
      expect(datos).toEqual({
        usuarioId: CIUDADANO_A,
        rol: 'ciudadano',
        salas: [`usuario:${CIUDADANO_A}`],
      });
    });

    it('recibe el seguimiento de su reporte y nadie más lo recibe', async () => {
      const ciudadanoA = await conectar('t-ciudadano-a');
      const ciudadanoB = await conectar('t-ciudadano-b');
      const despachador = await conectar('t-despachador');
      const enA = escuchar(ciudadanoA.socket, 'seguimiento.actualizado');
      const enB = escuchar(ciudadanoB.socket, 'seguimiento.actualizado');
      const enCentral = escuchar(despachador.socket, 'seguimiento.actualizado');

      const respuesta = await publicar({
        tipo: 'seguimiento.actualizado',
        salas: [`usuario:${CIUDADANO_A}`],
        datos: seguimiento,
      });
      await pausa();

      expect(respuesta.status).toBe(202);
      expect(enA).toEqual([
        expect.objectContaining({
          tipo: 'seguimiento.actualizado',
          datos: seguimiento,
        }),
      ]);
      expect(enB).toEqual([]);
      expect(enCentral).toEqual([]);
    });

    it('no recibe nada de la central', async () => {
      const ciudadano = await conectar('t-ciudadano-a');
      const recibidos = [
        'emergencia.creada',
        'ambulancia.ubicacion_actualizada',
      ].flatMap((evento) => escuchar(ciudadano.socket, evento));

      await publicar({});
      await publicar({
        tipo: 'ambulancia.ubicacion_actualizada',
        datos: { ambulanciaId: 'a1', latitud: 7.89, longitud: -72.5 },
      });
      await pausa();

      expect(recibidos).toEqual([]);
    });

    it('queda desconectado si lo bloquean', async () => {
      vi.useFakeTimers({ toFake: ['setInterval'] });
      const { socket } = await conectar('t-ciudadano-a');
      const error = new Promise((resolver) =>
        socket.once('error_autenticacion', resolver),
      );

      // La API rechaza la sesión de un usuario bloqueado.
      verificador.sesiones.delete('t-ciudadano-a');
      vi.advanceTimersByTime(INTERVALO_REVALIDACION_MS);

      expect(await error).toEqual({ mensaje: 'Token inválido' });
    });
  });
});
