# Cambios en el servidor WebSocket: seguimiento de ambulancia para ciudadanos

**Para:** el agente del servidor de tiempo real (proyecto `ambulancia/webSocket`).
**Contexto:** la API ya emite un evento nuevo para que el ciudadano vea en vivo la ambulancia de su propio reporte. El servidor WebSocket hoy **rechaza** ese evento y al rol ciudadano. Hacen falta **dos cambios pequeños**; no hay lógica nueva de negocio.

---

## 1. Qué hace la API (ya implementado, no tocar)

- **Evento nuevo `seguimiento.actualizado`.** La API lo envía a `POST /interno/eventos` como siempre: mismo sobre `{ id, tipo, ocurridoEn, datos, salas }` y misma clave interna.
- **Salas:** siempre **una sola**, la del ciudadano que reportó la emergencia, `usuario:{uuid}`. Nunca `central`.
- **Datos:** `{ "seguimiento": { emergenciaId, numeroEmergencia, estadoEmergencia, disponible, motivoNoDisponible, ambulancias[], consultadoEn, intervaloSugeridoSegundos } }`. El servidor no lo interpreta, solo lo reparte.
- **Frecuencia:** máximo uno cada 3 s por ambulancia en movimiento, más uno por cada cambio de etapa o de ruta. Termina con un evento final `disponible: false`.
- **Verificación de sesión:** `POST /autenticacion/sesiones/verificar` (el que ya usa el servidor) responde `rol: "ciudadano"` para estos usuarios.

**Hoy, sin los cambios:** el servidor responde `400` a esas entregas (evento fuera de la lista blanca) y la API registra en su log `No se entregó seguimiento.actualizado …`. No se cae nada; solo el ciudadano no recibe el aviso.

---

## 2. Cambios necesarios

### 2.1 Aceptar el rol ciudadano

`src/common/constants/roles.ts`: agregar el rol, igual que en el backend (`back/api/src/common/constants/roles.ts`):

```ts
export const Roles = {
  ADMINISTRADOR: 'administrador',
  DESPACHADOR: 'despachador',
  PARAMEDICO: 'paramedico',
  CONDUCTOR: 'conductor',
  CIUDADANO: 'ciudadano',
} as const;
```

Sin esto, `esRolValido` (en `api_verificador_sesiones.service.ts`) descarta la sesión y el ciudadano recibe `error_autenticacion` al conectarse.

### 2.2 Permitir el evento

`src/modules/notifications/domain/eventos.ts`: agregar a `EVENTOS_NEGOCIO`:

```ts
  'seguimiento.actualizado',
```

---

## 3. Lo que NO hay que cambiar (comprobar que siga así)

- **Salas:** `salasPermitidas(usuarioId, rol)` en `src/modules/notifications/domain/salas.ts` ya une a quien no es de la central **solo** a `usuario:{id}`. Con el rol ciudadano debe quedar exactamente así: **nunca a `central`**. Si alguien cambia `ROLES_CENTRAL`, el ciudadano no debe entrar ahí; la sala `central` recibe datos de todas las emergencias y de la flota.
- **El cliente no elige salas:** las sigue decidiendo el servidor.
- **La revalidación periódica de la sesión, el cierre de sesión y el bloqueo** funcionan igual: un ciudadano bloqueado por la central queda desconectado.

---

## 4. Pruebas sugeridas

1. Un token de ciudadano conecta, recibe `conectado` y queda solo en `usuario:{id}`; no en `central`.
2. Una entrega de la API con `tipo: "seguimiento.actualizado"` y `salas: ["usuario:{id}"]` responde `2xx` y llega solo a ese socket.
3. Un ciudadano no recibe `emergencia.creada`, `ambulancia.ubicacion_actualizada` ni ningún evento de la sala `central`.
4. Bloquear al ciudadano desde la web lo desconecta en la siguiente revalidación.
5. Los roles existentes (administrador, despachador, conductor, paramédico) siguen igual.

---

## 5. Documentación a actualizar en ese proyecto

- La lista de eventos y las salas por rol en su documentación (`arquitectura.md` o equivalente).
- Si mantienen una copia, `back/api/docs/api-tiempo-real-frontend.md`: agregar el rol ciudadano (solo sala personal) y el evento `seguimiento.actualizado`. El contrato para la app está en `back/api/docs/SEGUIMIENTO_AMBULANCIA_CIUDADANO_FLUTTER.md`, sección 4B.

Cuando esté desplegado, avise al equipo de Flutter: la guía les pide no activar el WebSocket del ciudadano hasta esa confirmación.
