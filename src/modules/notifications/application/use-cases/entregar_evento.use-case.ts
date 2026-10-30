import { Injectable } from '@nestjs/common';
import type { EventoTiempoReal } from '../../domain/eventos.js';
import { CanalTiempoReal } from '../../domain/services/canal_tiempo_real.js';
import { RegistroEntregas } from '../services/registro_entregas.js';

export interface EntregarEventoEntrada extends EventoTiempoReal {
  salas: string[];
}

export type ResultadoEntrega = 'entregado' | 'duplicado';

@Injectable()
export class EntregarEvento {
  constructor(
    private readonly canal: CanalTiempoReal,
    private readonly registroEntregas: RegistroEntregas,
  ) {}

  ejecutar({ salas, ...evento }: EntregarEventoEntrada): ResultadoEntrega {
    if (!this.registroEntregas.registrar(evento.id)) return 'duplicado';
    this.canal.emitir(salas, evento);
    return 'entregado';
  }
}
