import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { VariablesEntorno } from '../../config/variables_entorno.js';
import {
  CABECERA_CLAVE_INTERNA,
  coincideClave,
} from '../security/clave_interna.js';

/** Solo la API puede publicar eventos en este servidor. */
@Injectable()
export class ClaveInternaGuard implements CanActivate {
  private readonly claveEsperada: string;

  constructor(configuracion: ConfigService<VariablesEntorno, true>) {
    this.claveEsperada = configuracion.get('CLAVE_INTERNA', { infer: true });
  }

  canActivate(contexto: ExecutionContext): boolean {
    const recibida = contexto
      .switchToHttp()
      .getRequest<Request>()
      .header(CABECERA_CLAVE_INTERNA);
    if (!recibida || !coincideClave(recibida, this.claveEsperada)) {
      throw new UnauthorizedException('Clave interna inválida');
    }
    return true;
  }
}
