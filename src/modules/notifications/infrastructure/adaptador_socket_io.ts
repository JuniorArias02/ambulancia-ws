import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { Server, type ServerOptions } from 'socket.io';

/** Solo los orígenes de la web autorizados pueden abrir el WebSocket desde el navegador. */
export class AdaptadorSocketIo extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly origenesPermitidos: string[],
  ) {
    super(app);
  }

  // Nest tipa las opciones como completas, pero Socket.IO acepta parciales.
  override createIOServer(
    puerto: number,
    opciones?: Partial<ServerOptions>,
  ): Server {
    const configuracion: Partial<ServerOptions> = {
      ...opciones,
      cors: { origin: this.origenesPermitidos, credentials: true },
    };
    return this.httpServer && puerto === 0
      ? new Server(this.httpServer, configuracion)
      : new Server(puerto, configuracion);
  }
}
