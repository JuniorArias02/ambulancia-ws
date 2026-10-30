import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ClaveInternaGuard } from '../../../../common/guards/clave_interna.guard.js';
import {
  EntregarEvento,
  type ResultadoEntrega,
} from '../../application/use-cases/entregar_evento.use-case.js';
import { EntregarEventoDto } from '../dto/entregar_evento.dto.js';

/** Puente desde la API. No debe exponerse fuera de la red interna. */
@Controller('interno/eventos')
@UseGuards(ClaveInternaGuard)
export class EventosInternosController {
  constructor(private readonly entregarEvento: EntregarEvento) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  entregar(@Body() dto: EntregarEventoDto): { resultado: ResultadoEntrega } {
    return { resultado: this.entregarEvento.ejecutar(dto) };
  }
}
