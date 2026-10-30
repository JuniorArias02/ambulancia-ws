import { Module } from '@nestjs/common';
import { VerificadorSesiones } from './domain/services/verificador_sesiones.service.js';
import { ApiVerificadorSesiones } from './infrastructure/services/api_verificador_sesiones.service.js';

@Module({
  providers: [
    { provide: VerificadorSesiones, useClass: ApiVerificadorSesiones },
  ],
  exports: [VerificadorSesiones],
})
export class AuthenticationModule {}
