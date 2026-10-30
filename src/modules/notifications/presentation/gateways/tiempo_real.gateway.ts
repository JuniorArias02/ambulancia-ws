import { Logger } from '@nestjs/common';
import {
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';
import { NoAutenticadoError } from '../../../../common/exceptions/errores_dominio.js';
import {
  type SesionVerificada,
  VerificadorSesiones,
} from '../../../authentication/domain/services/verificador_sesiones.service.js';
import type { EventoTiempoReal } from '../../domain/eventos.js';
import { salasPermitidas } from '../../domain/salas.js';
import { CanalTiempoReal } from '../../domain/services/canal_tiempo_real.js';
import type {
  EventosClienteServidor,
  EventosServidorCliente,
} from '../dto/eventos_socket.dto.js';

type SocketTiempoReal = Socket<EventosClienteServidor, EventosServidorCliente>;

/** Cada cuánto se comprueba que la sesión siga vigente (cierre de sesión, bloqueo, cambio de rol). */
export const INTERVALO_REVALIDACION_MS = 60_000;

/** Un JWT de este sistema mide unos 300 caracteres; más que esto no se envía a la API. */
const LONGITUD_MAXIMA_TOKEN = 4096;

interface Vigilancia {
  revalidacion: NodeJS.Timeout;
  expiracion: NodeJS.Timeout;
}

/**
 * Solo notifica: no recibe eventos del cliente. Las salas se asignan al
 * conectar según el rol que validó la API.
 */
@WebSocketGateway({ namespace: 'tiempo-real' })
export class TiempoRealGateway
  extends CanalTiempoReal
  implements
    OnGatewayConnection<SocketTiempoReal>,
    OnGatewayDisconnect<SocketTiempoReal>
{
  @WebSocketServer()
  private readonly servidor: Namespace<
    EventosClienteServidor,
    EventosServidorCliente
  >;
  private readonly logger = new Logger(TiempoRealGateway.name);
  private readonly vigilancias = new Map<string, Vigilancia>();

  constructor(private readonly verificadorSesiones: VerificadorSesiones) {
    super();
  }

  async handleConnection(socket: SocketTiempoReal): Promise<void> {
    try {
      const token = extraerToken(socket);
      const sesion = await this.verificadorSesiones.verificar(token);
      // Pudo desconectarse mientras la API validaba la sesión.
      if (socket.disconnected) return;

      const salas = salasPermitidas(sesion.usuarioId, sesion.rol);
      await socket.join(salas);
      this.vigilar(socket, token, sesion);
      socket.emit('conectado', {
        usuarioId: sesion.usuarioId,
        rol: sesion.rol,
        salas,
      });
    } catch (error) {
      this.rechazar(socket, error);
    }
  }

  handleDisconnect(socket: SocketTiempoReal): void {
    const vigilancia = this.vigilancias.get(socket.id);
    if (!vigilancia) return;
    clearInterval(vigilancia.revalidacion);
    clearTimeout(vigilancia.expiracion);
    this.vigilancias.delete(socket.id);
  }

  emitir(salas: readonly string[], evento: EventoTiempoReal): void {
    this.servidor.to([...salas]).emit(evento.tipo, evento);
  }

  /** El token solo se guarda en memoria para revalidar; nunca se registra en el log. */
  private vigilar(
    socket: SocketTiempoReal,
    token: string,
    sesion: SesionVerificada,
  ): void {
    this.vigilancias.set(socket.id, {
      revalidacion: setInterval(
        () => void this.revalidar(socket, token, sesion),
        INTERVALO_REVALIDACION_MS,
      ),
      expiracion: setTimeout(
        () => this.rechazar(socket, new NoAutenticadoError('La sesión expiró')),
        sesion.expiraEn.getTime() - Date.now(),
      ),
    });
  }

  private async revalidar(
    socket: SocketTiempoReal,
    token: string,
    sesion: SesionVerificada,
  ): Promise<void> {
    try {
      const vigente = await this.verificadorSesiones.verificar(token);
      // Las salas dependen del rol: con otro rol podría seguir viendo lo que ya no le toca.
      if (
        vigente.rol !== sesion.rol ||
        vigente.usuarioId !== sesion.usuarioId
      ) {
        this.rechazar(
          socket,
          new NoAutenticadoError(
            'Sus permisos cambiaron; inicie sesión de nuevo',
          ),
        );
      }
    } catch (error) {
      if (error instanceof NoAutenticadoError) {
        this.rechazar(socket, error);
        return;
      }
      // Un fallo transitorio de la API no corta la conexión: se reintenta en la siguiente vuelta.
      this.logger.warn(`No se pudo revalidar una conexión: ${causaDe(error)}`);
    }
  }

  /** Distingue la sesión inválida (ir al login) de un fallo del servidor (reintentar). */
  private rechazar(socket: SocketTiempoReal, error: unknown): void {
    if (error instanceof NoAutenticadoError) {
      socket.emit('error_autenticacion', { mensaje: error.message });
    } else {
      this.logger.error(`No se pudo conectar un cliente: ${causaDe(error)}`);
      socket.emit('error_conexion', {
        mensaje: 'No fue posible establecer la conexión; intente de nuevo',
      });
    }
    socket.disconnect(true);
  }
}

/** Acepta `auth.token` (lo normal en Socket.IO) o el encabezado `Authorization: Bearer`. */
function extraerToken(socket: SocketTiempoReal): string {
  const auth: Record<string, unknown> = socket.handshake.auth;
  const [esquema, cabecera] = (
    socket.handshake.headers.authorization ?? ''
  ).split(' ');
  const token =
    typeof auth.token === 'string' && auth.token !== ''
      ? auth.token
      : esquema === 'Bearer'
        ? cabecera
        : undefined;

  if (!token) throw new NoAutenticadoError('Falta el token de acceso');
  if (token.length > LONGITUD_MAXIMA_TOKEN) {
    throw new NoAutenticadoError('Token inválido');
  }
  return token;
}

function causaDe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
