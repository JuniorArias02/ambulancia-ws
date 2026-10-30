# Guía de implementación — WebSockets (tiempo real)

> **Para quién:** el agente o desarrollador que implemente los WebSockets de Ambulancias Galenos.
> **Léase junto con:** [`arquitectura.md`](arquitectura.md) (reglas de WebSockets, en esta misma carpeta), `back/api/docs/arquitectura.md` (reglas del backend) y `back/api/.contexto/` (contexto de cada módulo del backend).
> **Estado del backend al escribir esto (2026-10-24):** REST completo para la web (usuarios, autenticación, ambulancias, turnos, emergencias, asignaciones, ubicaciones, instituciones de salud). **No hay nada de tiempo real todavía.** 59 pruebas en verde.

> **Decisión tomada (2026-10-24) — reemplaza la recomendación de la sección 1.2:** el WebSocket **no** va dentro de `back/api`. Es un **servidor independiente en esta carpeta** (NestJS + Socket.IO), conectado con la API por **HTTP interno protegido con una clave compartida** y sin Redis. Se mantiene lo demás de esta guía: el bus de eventos, los puntos de publicación, las salas, el contrato de eventos, la revalidación y el límite de GPS. Así quedó implementado:
> - Este servidor: [`README.md`](README.md).
> - Lado de la API: `back/api/.contexto/tiempo-real.md`.
> - Contrato para los clientes: `back/api/docs/api-tiempo-real-frontend.md`.

---

## 0. Primero: presentar la propuesta (regla §15)

`arquitectura.md §15` exige **presentar la tecnología y los cambios de arquitectura antes de escribir código**. Este documento ya trae una propuesta justificada (secciones 1 y 2). El primer paso es mostrarla al responsable del proyecto y **esperar su aprobación**, en especial la decisión de la sección 1.2 (dentro del backend o como servicio aparte).

---

## 1. Tecnología propuesta y por qué

### 1.1 Socket.IO con `@nestjs/websockets` + `@nestjs/platform-socket.io`

| Motivo | Detalle |
| --- | --- |
| Encaja con el stack | El backend es **NestJS 12** (ESM). Los paquetes oficiales `@nestjs/websockets@^12.2.0` y `@nestjs/platform-socket.io@^12.2.0` están publicados y alineados con la versión instalada. |
| Lo pide la arquitectura | `back/api/docs/arquitectura.md` menciona "WebSockets con Socket.IO". |
| Salas en el servidor | Socket.IO tiene *rooms* nativas. Con eso se cumple §6: el cliente no elige la sala; el servidor lo mete en las que le corresponden. |
| Reconexión con espera progresiva | Viene incorporada en los clientes (§9). |
| Clientes para ambas apps | Web (React 19 + Vite, carpeta `front/`): `socket.io-client`. Móvil (Flutter, carpeta `app/`): `socket_io_client`. |
| Autenticación en el handshake | `auth: { token }`, reutilizando el JWT actual (§5). |
| Escala | Por ahora **una sola instancia**: **no hace falta Redis** (§10: "no introducir infraestructura adicional sin justificarla"). Si mañana hay varias instancias, se agrega `@socket.io/redis-adapter` sin cambiar el contrato. |

### 1.2 Dónde vive: **dentro de `back/api`** (recomendado)

La carpeta `webSocket/` existe en la raíz, pero se recomienda implementar el gateway **dentro del backend NestJS**, como un módulo más (`src/modules/notifications/`, nombre que ya prevé `back/api/docs/arquitectura.md`). Motivos, con las reglas de `arquitectura.md`:

- §2: "Reutilizar los servicios, casos de uso, repositorios, entidades y mecanismos de autenticación existentes" y "No duplicar la lógica de negocio". Un servicio aparte tendría que duplicar la validación del JWT y de la sesión, y volver a consultar los datos por otra vía.
- §2/§8: "No emitir eventos hasta que la operación se haya confirmado". Dentro del mismo proceso, el evento se publica justo después de que el caso de uso confirma la transacción. Con un servicio aparte se necesitaría un puente (HTTP o Redis) y, para no perder eventos, un *outbox*.
- §10: no introducir infraestructura sin justificarla.

**Si aun así se decide un servicio aparte**, el contrato de eventos de este documento (sección 4) sigue sirviendo igual, pero hay que agregar un puente backend → servicio y resolver la autenticación allá. Es más trabajo y más riesgo; no se recomienda a esta escala.

La carpeta `webSocket/` queda para la documentación (las reglas y esta guía).

---

## 2. Arquitectura propuesta dentro del backend

### 2.1 Panorama

```text
Caso de uso (application)          EventosModule (global)           NotificationsModule
─────────────────────────          ──────────────────────           ───────────────────
1. Persiste (transacción OK)  →    PublicadorEventos.publicar() →   Suscriptor:
2. Audita                          (bus en memoria, async,            - recarga los datos por id
3. publica EventoDominio           nunca rompe la petición HTTP)      - los convierte con los DTO de respuesta
   { tipo, ids }                                                       - emite por el gateway a las salas correctas
```

- **Los casos de uso no conocen Socket.IO**: dependen de un puerto abstracto `PublicadorEventos` (igual que dependen de `AuditoriaRepositorio`).
- **Eventos de dominio livianos** (`tipo` + ids). El suscriptor de notificaciones recarga el recurso desde los repositorios y arma el payload con los **mismos DTO de respuesta del REST**. Así el frontend recibe exactamente la forma que ya conoce (`EmergenciaRespuestaDto`, `AsignacionRespuestaDto`, etc.) y no se duplica el mapeo (§2).
- **Por qué un bus y no inyectar el gateway en los casos de uso**: `NotificationsModule` necesita importar `AmbulancesModule`, `EmergenciesModule` y `AssignmentsModule` para recargar datos. Si esos módulos importaran a su vez `NotificationsModule`, habría una dependencia circular. El bus va en un módulo **global sin dependencias** (`EventosModule`), y `NotificationsModule` se **suscribe** al iniciar (`onModuleInit`).

### 2.2 Archivos a crear

```text
back/api/src/
├── common/events/
│   ├── eventos_dominio.ts          # unión discriminada EventoDominio (sin any)
│   ├── publicador_eventos.ts       # abstract class PublicadorEventos { publicar(e): void; suscribir(fn): void }
│   ├── bus_eventos.ts              # implementación en memoria: llama a los suscriptores de forma async,
│   │                               # con try/catch y Logger (sin tokens ni datos clínicos en el log)
│   └── eventos.module.ts           # @Global() provee PublicadorEventos → BusEventos
├── modules/authentication/
│   └── infrastructure/services/verificador_token.service.ts
│                                   # verificar(token): verifica el JWT (HS256, issuer EMISOR_JWT, firma con
│                                   # JWT_SECRETO) + valida la carga {sub, sid} + ValidarSesion.ejecutar()
│                                   # → UsuarioAutenticado. Reutiliza lo que hoy usa JwtStrategy.
└── modules/notifications/
    ├── domain/eventos_tiempo_real.ts        # nombres de eventos + tipos de payload + sobre (sección 4)
    ├── application/notificador_tiempo_real.service.ts
    │                                        # se suscribe al bus; por cada EventoDominio recarga, mapea y emite
    ├── infrastructure/adaptador_socket_io.ts # extends IoAdapter: CORS desde CORS_ORIGENES (ConfigService)
    ├── presentation/gateways/tiempo_real.gateway.ts
    │                                        # @WebSocketGateway({ namespace: 'tiempo-real' })
    │                                        # handleConnection: autentica y une a las salas
    └── notifications.module.ts              # importa AuthenticationModule, AmbulancesModule,
                                             # EmergenciesModule, AssignmentsModule
```

Cambios en lo existente:
- `AuthenticationModule`: **exportar** `VerificadorToken` (hoy no exporta nada).
- `src/main.ts`: `app.useWebSocketAdapter(new AdaptadorSocketIo(app, configuracion))`.
- `src/app.module.ts`: importar `EventosModule` y `NotificationsModule`.
- Los casos de uso de la sección 3.2: inyectar `PublicadorEventos` **como último parámetro del constructor** y publicar **después** de persistir y auditar.
- Specs existentes: pasar un doble `PublicadorEventosMemoria` (guarda los eventos en un arreglo) en `test/dobles/`. Sirve, además, para verificar en las pruebas que se publicó el evento correcto.

### 2.3 Convenciones del backend que hay que respetar

- Carpetas en inglés, código y comentarios en español (`back/api/docs/arquitectura.md`).
- ESM: los imports llevan la extensión `.js`.
- Sin `any`.
- **Pruebas en la carpeta `test/` de cada módulo**, replicando la ruta del código (por ejemplo, `notifications/test/application/notificador_tiempo_real.service.spec.ts`). Nunca junto al código. Los dobles compartidos van en `back/api/test/dobles/` y los de un solo módulo en `<modulo>/test/dobles/`. Regla completa en `back/api/docs/arquitectura.md` §13.
- `npm run typecheck`, `npm run lint` (oxlint `--type-aware`) y `npm test` (Vitest) deben quedar en verde. Al final, `npm run format`.
- Comentarios solo donde explican un **porqué**, con la misma densidad que el código existente.

---

## 3. Qué eventos existen hoy y dónde se publican

### 3.1 Casos de uso de `arquitectura.md §3` frente a lo que existe

| Caso de §3 | ¿Existe en el backend? | Evento |
| --- | --- | --- |
| Nuevos reportes de emergencia | ❌ No hay "reportes" ni WhatsApp todavía | — (no implementar, §15) |
| Creación y actualización de emergencias | ✅ | `emergencia.creada`, `emergencia.actualizada` |
| Cambios de prioridad y estado de emergencias | ✅ | dentro de `emergencia.actualizada` (con `cambios`) |
| Posibles duplicados | ✅ (`GET /emergencias/{id}/posibles-duplicadas`) | `emergencia.posible_duplicado` |
| Asignación o reasignación de ambulancias | ✅ | `asignacion.creada` |
| Aceptación o rechazo del servicio por la ambulancia | ❌ No existe (la asignación no se acepta ni se rechaza) | — |
| Cambios de disponibilidad de ambulancias | ✅ | `ambulancia.actualizada` |
| Ubicación GPS | ✅ (`POST /ubicaciones`) | `ambulancia.ubicacion_actualizada` |
| Llegada al lugar | ✅ (avance `en_escena`) | `asignacion.actualizada` |
| Paciente a bordo | ≈ avance `trasladando` | `asignacion.actualizada` |
| Asignación de IPS y llegada al destino | Parcial: llegada = finalizar desde `trasladando`. La IPS de destino irá en la historia clínica (no existe aún) | `asignacion.actualizada` |
| Finalización o cancelación | ✅ | `asignacion.actualizada` |
| Cambios de tripulación (no está en §3, pero la app lo necesita) | ✅ turnos | `turno.actualizado` y `mi_servicio.actualizado` |

**Implementar solo lo que existe.** Lo marcado con ❌ queda para cuando existan esos módulos.

### 3.2 Puntos de publicación (todos en `back/api/src/modules/*/application/use-cases/`)

Publicar **después** de `repositorio.…()` y de `auditoria.registrar()`. Nunca antes ni dentro de la transacción.

| Caso de uso (archivo) | Evento(s) de dominio a publicar |
| --- | --- |
| `emergencies/…/registrar_emergencia.use-case.ts` | `emergencia.creada` { emergenciaId } |
| `emergencies/…/actualizar_emergencia.use-case.ts` | `emergencia.actualizada` { emergenciaId, cambios: campos enviados } |
| `emergencies/…/cancelar_emergencia.use-case.ts` | `emergencia.actualizada` { emergenciaId, cambios: ['estado'] } |
| `emergencies/…/marcar_emergencia_duplicada.use-case.ts` | `emergencia.actualizada` { emergenciaId, cambios: ['estado', 'emergenciaPrincipalId'] } |
| `ambulances/…/crear_ambulancia.use-case.ts`, `actualizar_ambulancia…`, `cambiar_estado_ambulancia…` | `ambulancia.actualizada` { ambulanciaId } |
| `ambulances/…/iniciar_turno.use-case.ts`, `reemplazar_integrantes_turno…` | `turno.actualizado` { turnoId, usuariosAfectados: integrantes anteriores + nuevos } |
| `ambulances/…/finalizar_turno.use-case.ts` | `turno.actualizado` { … } + `ambulancia.actualizada` si cambió su estado |
| `assignments/…/despachar_ambulancia.use-case.ts` | `asignacion.creada` { asignacionId } + `ambulancia.actualizada` + `emergencia.actualizada` |
| `assignments/…/avanzar_asignacion.use-case.ts` | `asignacion.actualizada` { asignacionId } + `ambulancia.actualizada` (si finalizó) + `emergencia.actualizada` (si cambió su estado) |
| `assignments/…/cancelar_asignacion.use-case.ts` | `asignacion.actualizada` + `ambulancia.actualizada` + `emergencia.actualizada` |
| `locations/…/reportar_ubicacion.use-case.ts` | `ambulancia.ubicacion_actualizada` { la ubicación guardada } |

`emergencia.posible_duplicado`: al recibir `emergencia.creada`, el notificador puede ejecutar `BuscarPosiblesDuplicadas` (ya existe) y, si encuentra resultados, emitirlo a `central`. **Solo se sugiere; nunca se marca solo** (regla de `back/api/docs/arquitectura.md`).

---

## 4. Contrato para los clientes (lo que debe quedar documentado)

### 4.1 Conexión

```text
URL:        http://localhost:3000/tiempo-real      (namespace "tiempo-real"; path por defecto /socket.io)
Handshake:  auth: { token: "<tokenAcceso del login>" }
Transporte: websocket (con polling como respaldo)
```

- Sin token, con un token inválido o expirado, con la sesión revocada o con el usuario inactivo o bloqueado: el servidor emite **`error_autenticacion`** `{ mensaje }` y **desconecta**. El cliente debe ir al login, no reintentar en bucle.
- **Revalidación**: cada 60 s el servidor vuelve a ejecutar `ValidarSesion` para cada socket, y además lo desconecta cuando expira el token (`exp`). Así, cerrar sesión, cambiar la contraseña o bloquear al usuario también corta el tiempo real (§5), igual que ya pasa con el REST.
- Al conectarse correctamente: **`conectado`** `{ usuarioId, rol, salas }`.

### 4.2 Salas (solo las asigna el servidor; §6)

| Sala | Quién entra | Para qué |
| --- | --- | --- |
| `central` | `administrador`, `despachador` | Panel de coordinación: emergencias, asignaciones, ambulancias, turnos y GPS. Equivale a `emergencias`, `ambulancias` y `operadores` de §6 juntos, porque hoy ven lo mismo |
| `usuario:{id}` | cada usuario (su propio id, tomado del token) | Notificaciones dirigidas a la tripulación (`mi_servicio.actualizado`) |

- **No hay eventos cliente → servidor para unirse a salas.** Cualquier `join` que mande el cliente se ignora.
- Se usa `usuario:{id}` y no `ambulancias.{id}` para la tripulación: la membresía a una ambulancia cambia con los turnos. Notificar a las personas del turno evita mantener sincronizadas las salas por ambulancia.

### 4.3 Sobre común de todos los eventos (§7)

```ts
interface EventoTiempoReal<T> {
  id: string;          // uuid del evento, para que el cliente descarte duplicados
  tipo: string;        // igual al nombre del evento
  ocurridoEn: string;  // ISO 8601
  datos: T;
}
```

### 4.4 Eventos servidor → cliente

| Evento | Sala | `datos` |
| --- | --- | --- |
| `emergencia.creada` | `central` | `{ emergencia: EmergenciaRespuestaDto }` |
| `emergencia.actualizada` | `central` | `{ emergencia: EmergenciaRespuestaDto, cambios: string[] }` |
| `emergencia.posible_duplicado` | `central` | `{ emergenciaId, numeroEmergencia, posibles: PosibleDuplicadaRespuestaDto[] }` |
| `asignacion.creada` | `central` | `{ asignacion: AsignacionRespuestaDto }` |
| `asignacion.actualizada` | `central` | `{ asignacion: AsignacionRespuestaDto }` |
| `ambulancia.actualizada` | `central` | `{ ambulancia: AmbulanciaRespuestaDto }` |
| `ambulancia.ubicacion_actualizada` | `central` | `{ ambulanciaId, asignacionId, latitud, longitud, velocidad, registradaEn }` |
| `turno.actualizado` | `central` | `{ turno: TurnoRespuestaDto }` |
| `mi_servicio.actualizado` | `usuario:{id}` de cada integrante afectado | `MiServicioRespuestaDto` (**la misma forma que `GET /mi-servicio`**) |
| `conectado` | el propio socket | `{ usuarioId, rol, salas }` |
| `error_autenticacion` | el propio socket | `{ mensaje }` |

Los DTO son los mismos que ya devuelve el REST (ver `back/api/docs/api-*-frontend.md`).

**Cuándo emitir `mi_servicio.actualizado`** (la app móvil reemplaza su estado con ese payload):
- `asignacion.creada` o `asignacion.actualizada` → a los integrantes del turno de esa asignación (`asignacion.turnoId` → `TurnosRepositorio.buscarPorId` → `integrantes`).
- `emergencia.actualizada` → a los integrantes de las **asignaciones activas** de esa emergencia (`AsignacionesRepositorio.listar({ emergenciaId, soloActivas: true })`). Así la tripulación ve en el acto un cambio de prioridad o de dirección.
- `turno.actualizado` → a `usuariosAfectados`: los integrantes anteriores y los nuevos. A quien sale del turno le llega `{ turno: null, … }`.
- Para cada usuario, el payload se arma con el caso de uso que ya existe, **`ObtenerMiServicio.ejecutar(usuarioId)`**. No hay que duplicar esa lógica.

**Minimización de datos (§7):** la tripulación solo recibe **su** servicio, nunca la lista general. El informante (`informanteNombre` y `informanteTelefono`) va en la emergencia; hay que **confirmar con el responsable** si la tripulación debe verlo. Es útil para llamar y ubicar el sitio, pero son datos de contacto. Si no, omitirlos en el payload de `mi_servicio.actualizado`.

### 4.5 Eventos cliente → servidor

**Ninguno.** Toda acción va por REST (§4: el cliente no cambia estados enviando eventos). El GPS sigue siendo `POST /ubicaciones`.

### 4.6 Reglas para los clientes (§9 y §12)

- **Una sola conexión por app**, en un servicio o *provider* central; nunca una por componente.
- **Al conectar y al reconectar, volver a consultar el REST** (por ejemplo, invalidar las queries de React Query, o en la app llamar a `GET /mi-servicio`). El servidor **no reenvía** los eventos perdidos.
- Descartar eventos repetidos por `id`.
- Mostrar un indicador de conexión: conectado, reconectando o sin conexión.
- Ante `error_autenticacion`: cerrar sesión en el cliente.
- Web: con un evento, actualizar la caché (`queryClient.setQueryData`) o invalidar la query afectada. No recargar la página.

---

## 5. Seguridad y estabilidad (checklist de implementación)

- [ ] Token solo por `handshake.auth.token` (aceptar también `Authorization: Bearer` en los headers del handshake). **Nunca loguear el token.**
- [ ] Reutilizar `ValidarSesion` (`back/api/src/modules/authentication/application/use-cases/validar_sesion.use-case.ts`) y la configuración del JWT (`EMISOR_JWT`, HS256, `JWT_SECRETO`), igual que `jwt.strategy.ts`.
- [ ] CORS del gateway desde `CORS_ORIGENES` (lista separada por comas, igual que en `main.ts`).
- [ ] Salas asignadas solo en `handleConnection`, según el rol del token **validado**.
- [ ] Limpiar los intervalos y temporizadores de revalidación en `handleDisconnect`.
- [ ] El bus captura todos los errores de los suscriptores: **un fallo al emitir nunca rompe ni demora la respuesta REST** (§11). Loguear el tipo de evento y el id, sin datos clínicos ni personales.
- [ ] GPS (§10): limitar `ambulancia.ubicacion_actualizada` a **1 cada 3 s por ambulancia**. Se descartan las intermedias, porque la siguiente trae la posición más nueva. La validación de los datos ya la hace `POST /ubicaciones`.
- [ ] No consultar la BD por cada conexión más allá de validar la sesión.
- [ ] Sin *outbox* por ahora: si el proceso cae justo después de guardar, el evento se pierde. Los clientes lo cubren al reconsultar el REST al reconectar (§8 y §9). Se anota como mejora futura.

---

## 6. Pruebas (§14, adaptadas a lo que existe)

Unitarias (Vitest; los specs van en `<modulo>/test/…` y los dobles compartidos en `back/api/test/dobles/`):
- [ ] Cada caso de uso de la sección 3.2 publica el evento correcto **y no publica si la operación falla** (por ejemplo, transición inválida → `ReglaNegocioError` → 0 eventos).
- [ ] `NotificadorTiempoReal`: a qué salas va cada evento; `mi_servicio.actualizado` solo a los integrantes correctos (**sin filtración entre tripulaciones**).
- [ ] Limitador de GPS: descarta los reportes con menos de 3 s de diferencia por ambulancia y deja pasar los de ambulancias distintas.
- [ ] Bus: un suscriptor que lanza un error no afecta a los demás ni al publicador.

E2E (`npm run test:e2e`, archivos `back/api/test/*.e2e-spec.ts`, con `socket.io-client` contra la app levantada):
- [ ] Conexión con un token válido → `conectado` con las salas correctas por rol.
- [ ] Sin token, con un token inválido o con la sesión cerrada → `error_autenticacion` + desconexión.
- [ ] Un despachador recibe `emergencia.creada` al hacer `POST /emergencias`; un conductor **no** la recibe.
- [ ] Al despachar, el conductor del turno recibe `mi_servicio.actualizado` y un conductor de **otro** turno no recibe nada.
- [ ] Al cerrar sesión (`POST /autenticacion/cerrar-sesion`), el socket se desconecta en la siguiente revalidación.
- [ ] Dos despachos simultáneos a la misma ambulancia → un solo `asignacion.creada` (el otro responde 409 y no emite).

Datos de prueba que ya existen en la BD local (MySQL `ambulancia` en `localhost:3306`): administrador del seed, `pedro.conductor@prueba.co` y `ana.paramedica@prueba.co` (contraseña `Prueba2026x`) y la ambulancia `AMB-01`.

---

## 7. Orden de trabajo sugerido

1. Presentar la propuesta (secciones 1 y 2) y esperar aprobación.
2. `npm i @nestjs/websockets@^12.2.0 @nestjs/platform-socket.io@^12.2.0` en `back/api`. `npm i -D socket.io-client` para las pruebas E2E.
3. `common/events/` (puerto, bus y módulo global) + el doble `PublicadorEventosMemoria`.
4. Publicar los eventos en los casos de uso (sección 3.2), con sus pruebas unitarias.
5. `VerificadorToken` en `authentication` y exportarlo.
6. `notifications/`: adaptador con CORS, gateway (autenticación, salas y revalidación) y notificador (recargar, mapear y emitir), con el limitador de GPS.
7. Pruebas E2E.
8. `typecheck`, `lint`, `test` y `format`.
9. **Documentar para el frontend**: crear `back/api/docs/api-tiempo-real-frontend.md` con la sección 4 de esta guía, ejemplos de conexión con `socket.io-client` (React 19 + React Query) y `socket_io_client` (Flutter), y los tipos TypeScript de cada payload.
10. Actualizar el contexto del backend: crear `back/api/.contexto/tiempo-real.md` y actualizar `00-general.md`, `hoja-de-ruta.md` (paso 5 → hecho) y el README (`notifications/` en la estructura).

---

## 8. Criterios de aceptación

- Un despachador con el panel abierto ve aparecer una emergencia nueva **sin recargar**, y ve moverse las ambulancias en el mapa.
- Cuando el despachador asigna una ambulancia, el celular de esa tripulación (y de ninguna otra) recibe el servicio al instante.
- Cuando la tripulación marca "en escena" o "finalizada", el panel se actualiza solo: la asignación, la emergencia y la ambulancia.
- Cerrar sesión o bloquear a un usuario corta su conexión de tiempo real en menos de 60 s.
- Si se cae la conexión y vuelve, el cliente queda con el estado correcto (porque reconsulta el REST).
- Ninguna operación REST falla ni se demora porque falle el envío por WebSocket.
