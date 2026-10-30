import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  listarOrigenesCors,
  type VariablesEntorno,
} from './config/variables_entorno.js';
import { AdaptadorSocketIo } from './modules/notifications/infrastructure/adaptador_socket_io.js';

/** Compartido por `main.ts` y las pruebas E2E, para probar la app tal como arranca. */
export function configurarAplicacion(app: NestExpressApplication): void {
  const configuracion =
    app.get<ConfigService<VariablesEntorno, true>>(ConfigService);

  app.enableShutdownHooks();
  // Sin CORS en HTTP: la única ruta HTTP es el puente interno desde la API.
  app.useWebSocketAdapter(
    new AdaptadorSocketIo(
      app,
      listarOrigenesCors(configuracion.get('CORS_ORIGENES', { infer: true })),
    ),
  );
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
}
