import { plainToInstance } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  IsUrl,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

export class VariablesEntorno {
  @IsIn(['development', 'test', 'production'])
  NODE_ENV: 'development' | 'test' | 'production';

  @IsInt()
  @Min(1)
  @Max(65535)
  PUERTO: number;

  /** Orígenes de la web autorizados a abrir el WebSocket, separados por coma. */
  @IsString()
  @IsNotEmpty()
  CORS_ORIGENES: string;

  /** Base del REST, por ejemplo `http://localhost:3000/api/v1`. */
  @IsUrl({ require_tld: false, require_protocol: true })
  API_URL: string;

  /** Secreto compartido con la API (`TIEMPO_REAL_CLAVE_INTERNA` allá). */
  @IsString()
  @MinLength(32)
  CLAVE_INTERNA: string;
}

export function validarVariablesEntorno(
  configuracion: Record<string, unknown>,
): VariablesEntorno {
  const variables = plainToInstance(VariablesEntorno, configuracion, {
    enableImplicitConversion: true,
  });
  const errores = validateSync(variables, { skipMissingProperties: false });

  if (errores.length > 0) {
    const detalle = errores
      .map((error) => Object.values(error.constraints ?? {}).join(', '))
      .join('; ');
    throw new Error(`Variables de entorno inválidas: ${detalle}`);
  }

  return variables;
}

export function listarOrigenesCors(origenes: string): string[] {
  return origenes.split(',').map((origen) => origen.trim());
}
