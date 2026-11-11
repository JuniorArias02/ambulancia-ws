# Ambulancias Galenos — Servidor de tiempo real

Servidor WebSocket (NestJS 12 + Socket.IO 4) que reparte a la web y a la app móvil los cambios que confirma la API (`../back/api`). Va aparte de la API para poder reiniciarlo, desplegarlo o escalarlo sin tocarla.

- Reglas: [`arquitectura.md`](arquitectura.md).
- Propuesta original: [`guia-implementacion.md`](guia-implementacion.md).
- Contrato para los clientes (eventos, salas y ejemplos): [`../back/api/docs/api-tiempo-real-frontend.md`](../back/api/docs/api-tiempo-real-frontend.md).

## Cómo funciona

```text
 Cliente (web / app)                 webSocket/ (este servidor)                  back/api
 ───────────────────                 ──────────────────────────                  ────────
 1. Conecta con su token  ───────►   2. POST /api/v1/interno/sesiones/verificar ───►  JWT + sesión + usuario activo
                                        (cabecera x-clave-interna)            ◄───  { usuarioId, rol, expiraEn }
                          ◄───────   3. Lo mete en sus salas según el rol
                                        y revalida la sesión cada 60 s

                                                                     Caso de uso: guarda, audita y publica
                                                                     Notificador: recarga los datos y decide
                                                                     a quién va cada evento
                                     5. Descarta los repetidos  ◄───  4. POST /interno/eventos
                          ◄───────      y emite a las salas             (x-clave-interna, con reintentos)
```

Responsabilidades:

| Pieza | Decide |
| --- | --- |
| **API** | **Qué** se notifica y **a quién**: arma los datos con los mismos DTO del REST. A cada tripulante le envía solo su servicio. |
| **Este servidor** | **Quién entra a cada sala**, según el rol que valida la API. Además verifica la sesión al conectar y cada 60 s, y entrega cada evento una sola vez. |

No tiene base de datos ni conoce el secreto JWT: la API es la única autoridad sobre las sesiones.

### Salas

| Sala | Quién entra |
| --- | --- |
| `central` | `administrador`, `despachador` |
| `usuario:{id}` | cada usuario, solo la suya. Es la **única** sala de la tripulación (`conductor`, `paramedico`) y del `ciudadano` |

El cliente no puede unirse a salas: no hay eventos cliente → servidor.

El `ciudadano` solo recibe `seguimiento.actualizado`, la ambulancia de su propio reporte, y **nunca** entra a `central`, que lleva datos de todas las emergencias y de la flota. Los roles se copian de `back/api/src/common/constants/roles.ts`: si la API agrega uno, hay que agregarlo en `src/common/constants/roles.ts`. Si no, esas sesiones reciben `error_autenticacion`.

### Seguridad

- **Puente en los dos sentidos** con la cabecera `x-clave-interna`: la misma clave en `CLAVE_INTERNA` (aquí) y en `TIEMPO_REAL_CLAVE_INTERNA` (API). Se compara en tiempo constante.
- `POST /interno/eventos` **no debe quedar expuesto a internet**. En producción, publique solo el WebSocket (`/socket.io`) en el proxy inverso y deje `/interno` en la red interna.
- Solo se aceptan eventos y salas conocidos (`central` o `usuario:<uuid>`).
- El token del cliente solo se guarda en memoria para revalidar. Nunca va a los logs, y los logs no incluyen datos de los eventos.
- Se desconecta al cliente si se cierra la sesión, si se bloquea al usuario, si le cambian el rol o si vence el token.

### Fallos y reintentos

- **API → este servidor:** la API reintenta a 1 s, 3 s y 10 s cuando hay errores de red, 429 o 5xx, con el mismo `id`. Este servidor recuerda los `id` entregados durante 10 minutos y no repite la entrega. Las ubicaciones GPS no se reintentan, porque la siguiente es más nueva.
- **Este servidor → API, al verificar sesiones:**

  | Situación | Qué hace |
  | --- | --- |
  | 401 o 400 | Sesión inválida: envía `error_autenticacion` y desconecta |
  | Error de red, 403 o 5xx al conectar | Envía `error_conexion` y el cliente reintenta |
  | Esos mismos fallos al revalidar | No corta la conexión; vuelve a intentar en la siguiente vuelta |

- **Sin Redis y sin outbox, por ahora:** si un evento se pierde, el cliente lo recupera porque reconsulta el REST al reconectar. Con más de una instancia de este servidor habría que agregar `@socket.io/redis-adapter`.

## Puesta en marcha

```bash
cp .env.example .env     # misma clave que TIEMPO_REAL_CLAVE_INTERNA en back/api/.env
npm install
npm run start:dev        # http://localhost:3001, namespace /tiempo-real
```

En `back/api/.env`, configure `TIEMPO_REAL_URL=http://localhost:3001` y la misma clave en `TIEMPO_REAL_CLAVE_INTERNA`. Si faltan, la API arranca igual pero no envía notificaciones (lo avisa en el log).

| Variable | Uso |
| --- | --- |
| `PUERTO` | Puerto HTTP y WebSocket (3001) |
| `CORS_ORIGENES` | Orígenes de la web que pueden abrir el WebSocket, separados por coma |
| `API_URL` | Base del REST, por ejemplo `http://localhost:3000/api/v1` |
| `CLAVE_INTERNA` | Secreto compartido con la API (mínimo 32 caracteres) |

## Scripts

| Script | Uso |
| --- | --- |
| `npm test` | Pruebas unitarias (Vitest) |
| `npm run test:e2e` | Levanta la app con Socket.IO real (la API se simula) |
| `npm run typecheck` / `npm run lint` | Tipos y oxlint |
| `npm run build` / `npm run start:prod` | Compilar y ejecutar |

## Estructura

Mismas convenciones que `back/api`: carpetas en inglés, código en español, ESM con imports `.js` y pruebas en la carpeta `test/` de cada módulo.

```text
src/
├── common/          # roles, error de autenticación, clave interna y su guard
├── config/          # validación de variables de entorno
├── configurar_aplicacion.ts   # adaptador Socket.IO + ValidationPipe (lo usan main y las E2E)
└── modules/
    ├── authentication/   # VerificadorSesiones (puerto) → ApiVerificadorSesiones (HTTP a la API)
    └── notifications/
        ├── domain/            # salas, eventos conocidos, CanalTiempoReal (puerto)
        ├── application/       # EntregarEvento, RegistroEntregas (deduplicación)
        ├── infrastructure/    # adaptador Socket.IO con CORS
        └── presentation/      # POST /interno/eventos y el gateway /tiempo-real
test/tiempo_real.e2e-spec.ts
```
