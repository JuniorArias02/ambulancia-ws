import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { configurarAplicacion } from './configurar_aplicacion.js';
import type { VariablesEntorno } from './config/variables_entorno.js';

async function iniciar(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configurarAplicacion(app);

  const puerto = app
    .get<ConfigService<VariablesEntorno, true>>(ConfigService)
    .get('PUERTO', { infer: true });
  await app.listen(puerto);
  Logger.log(
    `Tiempo real escuchando en el puerto ${puerto} (namespace /tiempo-real)`,
    'Inicio',
  );
}

await iniciar();
