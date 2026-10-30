import { Module } from '@nestjs/common';
import { AuthenticationModule } from '../authentication/authentication.module.js';
import { RegistroEntregas } from './application/services/registro_entregas.js';
import { EntregarEvento } from './application/use-cases/entregar_evento.use-case.js';
import { CanalTiempoReal } from './domain/services/canal_tiempo_real.js';
import { EventosInternosController } from './presentation/controllers/eventos_internos.controller.js';
import { TiempoRealGateway } from './presentation/gateways/tiempo_real.gateway.js';

@Module({
  imports: [AuthenticationModule],
  controllers: [EventosInternosController],
  providers: [
    TiempoRealGateway,
    { provide: CanalTiempoReal, useExisting: TiempoRealGateway },
    RegistroEntregas,
    EntregarEvento,
  ],
})
export class NotificationsModule {}
