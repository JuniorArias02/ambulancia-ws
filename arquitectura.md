# Reglas de arquitectura — WebSockets

## 1. Objetivo

Implementar comunicación en tiempo real mediante WebSockets para el sistema de gestión de emergencias médicas y ambulancias.

Los WebSockets deben complementar la API REST existente, no reemplazarla. La API REST será responsable de las operaciones de consulta y persistencia, mientras que los WebSockets comunicarán los eventos relevantes a los clientes conectados.

## 2. Reglas generales

- Antes de implementar, revisar la arquitectura, dependencias, estructura de carpetas y convenciones existentes.
- No modificar ni reemplazar funcionalidades existentes sin justificación.
- Reutilizar los servicios, casos de uso, repositorios, entidades y mecanismos de autenticación existentes.
- No duplicar la lógica de negocio entre los controladores REST y los manejadores de eventos WebSocket.
- No devolver `any` en TypeScript. Definir tipos e interfaces explícitos para los eventos y sus payloads.
- Mantener los nombres del dominio en español y las convenciones técnicas del proyecto.
- No utilizar WebSockets para sustituir operaciones que deban persistirse en la base de datos.
- No emitir eventos hasta que la operación de negocio correspondiente se haya confirmado correctamente.

## 3. Casos de uso

Los WebSockets deben permitir notificar en tiempo real:

- Recepción de nuevos reportes de emergencia.
- Creación y actualización de emergencias.
- Cambios de prioridad y estado de las emergencias.
- Detección de posibles reportes duplicados.
- Asignación o reasignación de ambulancias.
- Aceptación o rechazo de servicios por parte de una ambulancia.
- Cambios de disponibilidad de las ambulancias.
- Actualización de ubicación de las ambulancias, cuando exista autorización y disponibilidad de datos GPS.
- Llegada al lugar del incidente.
- Registro de paciente a bordo.
- Asignación de IPS y llegada al destino.
- Finalización o cancelación de servicios.

Los eventos deben corresponder a cambios reales del sistema. No se deben emitir eventos ficticios ni estados que todavía no se hayan guardado.

## 4. Separación entre REST y WebSockets

- Utilizar REST para crear, consultar, actualizar y cerrar reportes y emergencias, así como para asignar ambulancias.
- Utilizar WebSockets para notificar los cambios confirmados a los clientes autorizados.
- Las acciones críticas deben ejecutarse mediante casos de uso o servicios de negocio compartidos.
- El cliente no debe poder cambiar estados críticos simplemente enviando un evento arbitrario.
- Cuando el cliente solicite una operación por WebSocket, validar la identidad, los permisos, el payload y las reglas de negocio antes de ejecutarla.
- Evitar mantener dos implementaciones diferentes de la misma operación.

## 5. Autenticación y autorización

- Exigir autenticación para conectarse a los canales privados.
- Reutilizar el mecanismo de autenticación del proyecto cuando sea compatible.
- Validar los permisos y el rol del usuario antes de permitirle suscribirse a un canal.
- Separar los permisos de operadores del SEM, administradores y personal de ambulancias.
- Un usuario solo podrá recibir información correspondiente a los recursos y funciones que tenga autorizados.
- No confiar en el identificador de usuario, ambulancia o emergencia enviado por el frontend sin validarlo en el backend.
- No incluir tokens, contraseñas ni información sensible en los logs de eventos.

## 6. Canales y salas

Organizar los canales según el dominio y los permisos. Los siguientes nombres son propuestas y deben adaptarse a la tecnología seleccionada:

- `emergencias`: notificaciones autorizadas de emergencias para el panel de coordinación.
- `emergencias.{id}`: actualizaciones de una emergencia específica.
- `ambulancias`: cambios de disponibilidad y ubicación visibles para usuarios autorizados.
- `ambulancias.{id}`: notificaciones dirigidas a una ambulancia específica.
- `operadores`: notificaciones operativas para los operadores autorizados.

No permitir que el cliente se una libremente a una sala privada. La suscripción debe validarse en el servidor.

## 7. Convención de eventos

- Utilizar nombres de eventos consistentes, descriptivos y documentados.
- Separar los eventos que representan hechos ocurridos de las solicitudes de acciones.
- Definir un tipo de payload para cada evento.
- Incluir un identificador único del evento cuando se necesite trazabilidad o deduplicación.
- Incluir la fecha y hora del evento, el identificador del recurso y los datos mínimos necesarios.
- No enviar la entidad completa de la base de datos si solo se necesita informar un cambio.
- No enviar datos clínicos, personales o de contacto a usuarios que no necesiten conocerlos.

Ejemplos de nombres:

- `reporte.creado`
- `reporte.posible_duplicado`
- `emergencia.creada`
- `emergencia.actualizada`
- `emergencia.prioridad_actualizada`
- `ambulancia.asignada`
- `ambulancia.servicio_aceptado`
- `ambulancia.servicio_rechazado`
- `ambulancia.ubicacion_actualizada`
- `emergencia.servicio_finalizado`

## 8. Consistencia con la base de datos

- La base de datos será la fuente oficial del estado de las emergencias y ambulancias.
- No utilizar el estado local del frontend como fuente de verdad.
- Publicar eventos después de confirmar la transacción de base de datos.
- Si el sistema necesita garantizar que un evento no se pierda después de guardar una operación, evaluar el patrón Transactional Outbox.
- Diseñar los consumidores para tolerar eventos duplicados cuando corresponda.
- No crear una nueva emergencia cada vez que se reciba una notificación de WebSocket.
- Utilizar los identificadores y relaciones existentes, incluyendo reportes, emergencias, asociaciones y asignaciones.

## 9. Reconexión y sincronización

- Implementar reconexión controlada cuando se pierda la conexión.
- Aplicar una espera progresiva entre intentos de reconexión para evitar solicitudes excesivas.
- No asumir que el cliente recibió todos los eventos durante una desconexión.
- Al reconectarse, consultar la API REST para recuperar el estado actual.
- Si se implementa reproducción de eventos, utilizar identificadores o cursores verificables.
- Evitar actualizaciones duplicadas en pantalla.
- Mostrar al usuario un indicador de conexión cuando sea relevante para la operación.

## 10. Rendimiento y estabilidad

- Evitar emitir eventos globales cuando solo los necesita un usuario o una sala.
- Limitar la frecuencia de las actualizaciones de ubicación GPS y validar los datos recibidos.
- No realizar consultas pesadas a la base de datos por cada conexión sin necesidad.
- Gestionar correctamente conexiones, errores, desconexiones y recursos asociados.
- Evitar ciclos de eventos entre clientes y servidores.
- Si se despliega más de una instancia del backend, evaluar un adaptador o mecanismo de publicación compartida, como Redis, según la tecnología utilizada.
- No introducir infraestructura adicional sin justificarla según la escala real del sistema.

## 11. Auditoría y manejo de errores

- Registrar las operaciones críticas mediante el mecanismo de auditoría del proyecto.
- Diferenciar errores de autenticación, autorización, validación y conexión.
- No exponer stack traces ni información interna del servidor al cliente.
- No registrar innecesariamente mensajes privados de WhatsApp ni datos clínicos.
- Los eventos de auditoría importantes deben persistirse en un mecanismo confiable; no depender exclusivamente de que un cliente WebSocket los reciba.
- Definir una estrategia de reintentos para publicaciones que fallen.

## 12. Frontend

- Centralizar la conexión WebSocket en un servicio o módulo reutilizable.
- No abrir una conexión nueva en cada componente.
- Gestionar las suscripciones y cancelar los listeners cuando ya no se necesiten.
- Actualizar el estado de la interfaz sin recargar toda la página.
- Manejar desconexiones, errores y reconexiones.
- Al recibir una notificación, actualizar los datos afectados o consultar nuevamente la API cuando sea necesario.
- Mantener separadas la conexión, la lógica de negocio, los hooks y los componentes visuales.
- No permitir que los eventos entrantes omitan las validaciones del frontend ni las del backend.

## 13. WhatsApp

- La recepción de mensajes de WhatsApp se realizará mediante el webhook correspondiente.
- No asumir que WhatsApp se comunica directamente con los WebSockets del navegador.
- El backend procesará el mensaje, persistirá el reporte y emitirá el evento correspondiente cuando la operación se confirme.
- Las notificaciones al panel del operador se transmitirán por WebSockets.
- Las respuestas al ciudadano se enviarán mediante la integración de WhatsApp correspondiente.
- Gestionar las notificaciones de WhatsApp y WebSocket como mecanismos independientes.
- Evitar que un mismo mensaje entrante cree reportes duplicados; validar el identificador externo del mensaje y aplicar idempotencia.
- No retrasar la escalación de una emergencia urgente por esperar una respuesta del bot o la recepción de un evento WebSocket.

## 14. Pruebas obligatorias

Verificar como mínimo:

- Conexión y desconexión.
- Autenticación y rechazo de usuarios no autorizados.
- Control de acceso a canales privados.
- Emisión de eventos después de confirmar una operación.
- Recepción de eventos por los clientes autorizados.
- Ausencia de filtración de información entre usuarios o ambulancias.
- Reconexión y sincronización después de perder conectividad.
- Manejo de eventos repetidos.
- Errores durante la persistencia o publicación de eventos.
- Cambios simultáneos de estado y asignaciones concurrentes.
- Carga de conexiones y frecuencia de actualización de ubicaciones.
- Integración del flujo WhatsApp → backend → base de datos → panel de coordinación.

## 15. Regla final

Antes de escribir código, identificar la tecnología WebSocket compatible con el stack actual, justificar su selección y presentar los cambios propuestos en la arquitectura.

Implementar únicamente lo necesario para cubrir los casos de uso reales, respetando las reglas de seguridad, consistencia, mantenibilidad y continuidad operativa del sistema SEM.
