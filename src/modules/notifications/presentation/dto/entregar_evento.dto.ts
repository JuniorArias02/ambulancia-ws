import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsISO8601,
  IsObject,
  IsUUID,
  Matches,
} from 'class-validator';
import { EVENTOS_NEGOCIO, type EventoNegocio } from '../../domain/eventos.js';
import { PATRON_SALA } from '../../domain/salas.js';

/** Cuerpo que publica la API en `POST /interno/eventos`. */
export class EntregarEventoDto {
  /** Se repite en los reintentos de la API: sirve para no entregar dos veces. */
  @IsUUID()
  id: string;

  @IsIn(EVENTOS_NEGOCIO)
  tipo: EventoNegocio;

  @IsISO8601()
  ocurridoEn: string;

  /** Solo salas conocidas: una sala inventada no recibiría a nadie o filtraría datos. */
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  @Matches(PATRON_SALA, { each: true })
  salas: string[];

  @IsObject()
  datos: Record<string, unknown>;
}
