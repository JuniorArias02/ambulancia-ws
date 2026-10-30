# Tiempo real (WebSocket) — guía para frontend y app móvil

**Servidor (desarrollo):** `http://localhost:3001`, namespace **`/tiempo-real`** (Socket.IO 4, path `/socket.io`). Es un servidor **aparte** de la API: el proyecto `webSocket/` en la raíz del repositorio.

El WebSocket **solo avisa**. Toda acción sigue yendo por el REST: crear emergencias, despachar, marcar el avance, enviar el GPS (`POST /ubicaciones`). El cliente no envía eventos por el socket.

**El REST es la fuente de verdad.** El servidor no guarda ni reenvía los eventos que el cliente se perdió mientras estaba desconectado.

## 1. Conexión

```ts
io('http://localhost:3001/tiempo-real', {
  auth: { token: tokenAcceso },   // el mismo token del login
  transports: ['websocket'],
});
```

También se acepta el encabezado `Authorization: Bearer <token>` en el handshake (útil en Flutter).

| Evento que recibe el cliente | Cuándo | Qué hacer |
| --- | --- | --- |
| `conectado` `{ usuarioId, rol, salas }` | La sesión es válida y ya está en sus salas | Reconsultar el REST (ver 4) y mostrar "en línea" |
| `error_autenticacion` `{ mensaje }` | Sin token, token inválido o vencido, sesión cerrada, usuario bloqueado o **cambio de rol** | **Cerrar sesión e ir al login.** No reintentar con el mismo token |
| `error_conexion` `{ mensaje }` | Fallo temporal del servidor | Reintentar con espera progresiva (ver 4) |

Después de cualquiera de los dos errores, el servidor desconecta el socket. Socket.IO **no reconecta solo** cuando la desconexión la hace el servidor (`reason === 'io server disconnect'`).

Mientras el socket está abierto, el servidor revisa la sesión **cada 60 s**. Al cerrar sesión, al cambiar la contraseña o si un administrador bloquea al usuario, el socket se corta en menos de un minuto.

## 2. Salas (las asigna el servidor)

| Rol | Recibe |
| --- | --- |
| `administrador`, `despachador` | Todo lo de la central (sala `central`) |
| `conductor`, `paramedico` | Solo `mi_servicio.actualizado`, con **su propio** servicio (sala `usuario:{id}`) |

## 3. Eventos

Todos llegan dentro del mismo sobre:

```ts
interface EventoTiempoReal<T> {
  id: string;          // uuid: descarte los repetidos
  tipo: string;        // igual al nombre del evento
  ocurridoEn: string;  // ISO 8601: descarte los más viejos que el último aplicado al mismo recurso
  datos: T;
}
```

Los DTO son **los mismos que devuelve el REST** (ver [`api-emergencias-frontend.md`](../../back/api/docs/api-emergencias-frontend.md), [`api-despacho-frontend.md`](../../back/api/docs/api-despacho-frontend.md) y [`api-ambulancias-frontend.md`](../../back/api/docs/api-ambulancias-frontend.md)).

### Central (`administrador`, `despachador`)

| Evento | `datos` | Cuándo |
| --- | --- | --- |
| `emergencia.creada` | `{ emergencia: EmergenciaRespuesta }` | `POST /emergencias` |
| `emergencia.actualizada` | `{ emergencia: EmergenciaRespuesta, cambios: string[] }` | Edición (`cambios` = campos enviados), cancelación, duplicada, o cuando cambia su estado al despachar, atender o cerrar (`['estado']`) |
| `emergencia.posible_duplicado` | `{ emergenciaId, numeroEmergencia, posibles: PosibleDuplicadaRespuesta[] }` | Al crearla, si hay candidatas. **Solo una sugerencia**: nunca se marca sola |
| `asignacion.creada` | `{ asignacion: AsignacionRespuesta }` | Despacho |
| `asignacion.actualizada` | `{ asignacion: AsignacionRespuesta }` | Avance o cancelación |
| `ambulancia.actualizada` | `{ ambulancia: AmbulanciaRespuesta }` | Alta, edición, cambio de estado, despacho, fin de servicio o fin de turno |
| `ambulancia.ubicacion_actualizada` | `{ ambulanciaId, asignacionId, latitud, longitud, velocidad, registradaEn }` | GPS. **Máximo una cada 3 s por ambulancia**: las intermedias se descartan |
| `turno.actualizado` | `{ turno: TurnoRespuesta }` | Inicio, cambio de integrantes o fin de turno |

### Tripulación (`conductor`, `paramedico`)

| Evento | `datos` | Cuándo |
| --- | --- | --- |
| `mi_servicio.actualizado` | `MiServicioRespuesta`, **la misma forma que `GET /mi-servicio`** | Le asignan un servicio, cambia su avance o se cancela; cambia la emergencia que atiende (prioridad, dirección…); entra o sale de un turno |

La app **reemplaza** su estado con ese payload. Si sale del turno, llega `{ turno: null, asignacion: null, emergencia: null }`.

## 4. Reglas para los clientes

1. **Una sola conexión por app**, en un servicio o *provider* central. Nunca una por componente.
2. **Al recibir `conectado`, ya sea la primera vez o tras reconectar, vuelva a consultar el REST.** Lo que pasó mientras estaba desconectado no se reenvía.
3. Descarte los eventos con un `id` ya visto. También los que tengan un `ocurridoEn` anterior al último aplicado para el mismo recurso: un reintento puede llegar tarde.
4. Reconexión con espera progresiva, por ejemplo de 1 s hasta un máximo de 30 s.
5. Muestre el estado de la conexión: en línea, reconectando o sin conexión.
6. Desuscriba los *listeners* al desmontar.

## 5. Web (React 19 + React Query)

```ts
// src/realtime/socket.ts — una sola conexión para toda la app
import { io, type Socket } from 'socket.io-client';

export function crearSocket(token: string): Socket {
  return io(`${import.meta.env.VITE_TIEMPO_REAL_URL}/tiempo-real`, {
    auth: { token },
    transports: ['websocket'],
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 30_000,
  });
}
```

```ts
// src/realtime/useTiempoReal.ts — se monta una vez, en el layout autenticado
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

interface EventoTiempoReal<T> { id: string; tipo: string; ocurridoEn: string; datos: T }

export function useTiempoReal(token: string, cerrarSesion: () => void) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const socket = crearSocket(token);
    const vistos = new Set<string>();
    const nuevo = (e: EventoTiempoReal<unknown>) => {
      if (vistos.has(e.id)) return false;
      vistos.add(e.id);
      return true;
    };

    // Al conectar o reconectar, el REST manda: se invalida todo lo visible.
    socket.on('conectado', () => queryClient.invalidateQueries());
    socket.on('error_autenticacion', cerrarSesion);
    socket.on('disconnect', (razon) => {
      if (razon === 'io server disconnect') setTimeout(() => socket.connect(), 5_000);
    });

    socket.on('emergencia.creada', (e: EventoTiempoReal<{ emergencia: { id: string } }>) => {
      if (nuevo(e)) queryClient.invalidateQueries({ queryKey: ['emergencias'] });
    });
    socket.on('ambulancia.ubicacion_actualizada', (e: EventoTiempoReal<{ ambulanciaId: string }>) => {
      if (nuevo(e)) queryClient.setQueryData(['ubicacion', e.datos.ambulanciaId], e.datos);
    });
    // … igual para asignacion.*, ambulancia.actualizada y turno.actualizado

    return () => { socket.removeAllListeners(); socket.disconnect(); };
  }, [token, queryClient, cerrarSesion]);
}
```

Agregue `VITE_TIEMPO_REAL_URL=http://localhost:3001` al `.env` del frontend.

## 6. App móvil (Flutter, `socket_io_client`)

```dart
final socket = IO.io(
  '$tiempoRealUrl/tiempo-real',
  IO.OptionBuilder()
      .setTransports(['websocket'])
      .setAuth({'token': tokenAcceso})
      .enableReconnection()
      .setReconnectionDelay(1000)
      .setReconnectionDelayMax(30000)
      .build(),
);

socket.on('conectado', (_) => servicio.recargar());          // GET /mi-servicio
socket.on('error_autenticacion', (_) => sesion.cerrar());
socket.on('mi_servicio.actualizado', (evento) {
  if (vistos.add(evento['id'])) servicio.reemplazar(MiServicio.fromJson(evento['datos']));
});
```

Mientras no tenga conexión, la app puede seguir consultando `GET /mi-servicio` cada 10–15 s como respaldo.

## 7. Tipos TypeScript

```ts
type Sala = 'central' | `usuario:${string}`;

interface ConexionEstablecida { usuarioId: string; rol: 'administrador' | 'despachador' | 'paramedico' | 'conductor'; salas: Sala[] }
interface ErrorTiempoReal { mensaje: string }

interface UbicacionTiempoReal {
  ambulanciaId: string;
  asignacionId: string | null;
  latitud: number;
  longitud: number;
  velocidad: number | null;
  registradaEn: string;
}

interface DatosEventos {
  'emergencia.creada': { emergencia: EmergenciaRespuesta };
  'emergencia.actualizada': { emergencia: EmergenciaRespuesta; cambios: string[] };
  'emergencia.posible_duplicado': { emergenciaId: string; numeroEmergencia: string; posibles: PosibleDuplicadaRespuesta[] };
  'asignacion.creada': { asignacion: AsignacionRespuesta };
  'asignacion.actualizada': { asignacion: AsignacionRespuesta };
  'ambulancia.actualizada': { ambulancia: AmbulanciaRespuesta };
  'ambulancia.ubicacion_actualizada': UbicacionTiempoReal;
  'turno.actualizado': { turno: TurnoRespuesta };
  'mi_servicio.actualizado': MiServicioRespuesta;
}
```

Las fechas llegan como texto ISO 8601, igual que en el REST.
