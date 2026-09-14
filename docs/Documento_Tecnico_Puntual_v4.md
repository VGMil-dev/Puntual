# Documento Técnico: Puntual (v4 — corrección de trazabilidad y checklist de arranque)

> **Nota de versión:** incorpora los refinements de la revisión del 2026-09-12 (v2), las decisiones de cierre de puntos menores del 2026-09-13 (v3), y la revisión de consistencia del 2026-09-14 (v4). Todos los `[PENDIENTE]` de la v1 quedaron resueltos. Se añadieron RF-023 a RF-030, RNF-011 a RNF-013, y los casos de uso CU-009 a CU-011. Cambios v3: definición de conversación, límite de holds concurrentes, transición nocturna No-show, sync Google Calendar unidireccional, costo único global plantillas, idempotencia jobs, tipo plantilla handoff explícito. Cambios v4: corrección de referencia cruzada RNF-027→RF-027, y nueva sección de checklist de arranque de piloto (aprobación previa de plantillas Meta).

## 1. INTRODUCCIÓN

### Objetivo

Construir un agente de inteligencia artificial especializado en la gestión de citas para clínicas odontológicas, operado por WhatsApp y Telegram, respaldado por un dashboard multi-rol que permita a la operación (clínica), al profesional (doctor) y a la plataforma (Puntual como producto) dar seguimiento al desempeño del agente y a las citas agendadas.

Puntual es un producto de mercado de **GAVANTI** (el startup de Milton), comercializado bajo un modelo de **suscripción mensual** por clínica.

### Alcance

El sistema cubre: la conversación automatizada con el paciente para agendar/confirmar/cancelar citas, la escalación a un humano cuando el agente no puede resolver la solicitud, la sincronización con Google Calendar (escritura unidireccional), la medición de satisfacción del paciente post-interacción, la gestión comercial de clínicas suscritas (alta, baja, estado de suscripción), y un dashboard con tres niveles de visibilidad (plataforma/GAVANTI, clínica, doctor). El sistema está diseñado para operar en modalidad multi-tenant: cada clínica es un cliente independiente de Puntual, con sus propias credenciales de canal.

### Actores del Sistema

- **Super Administrador (GAVANTI):** Milton — dueño/operador de la plataforma. Da seguimiento a la salud del bot (fallas, calidad de respuesta) y a métricas de negocio (citas agendadas, satisfacción) a través de todas las clínicas; da de alta nuevas clínicas y monitorea el estado de sus suscripciones mensuales.
- **Administrador de Clínica:** rol operativo tipo "secretaria" — supervisa el desempeño del bot de su clínica, recibe alertas de atención humana requerida, **atiende las conversaciones escaladas respondiendo desde el dashboard**, gestiona el mini-calendario vinculado a Google Calendar, y administra (crea/edita) a los doctores de su clínica y sus especialidades.
- **Doctor:** ve sus citas del día y las marca como completadas.
- **Paciente:** interactúa únicamente vía WhatsApp/Telegram con el agente conversacional — no tiene acceso al dashboard.
- **Sistema (IA/Agente):** ejecuta la conversación, decide cuándo escalar a humano, sugiere doctor según especialidad requerida, y actualiza el estado de las citas.

### Convención de zona horaria

Toda lógica temporal del sistema (reconfirmaciones, ventanas de confirmación, vencimientos de suscripción, métricas diarias, corte de conversación, transición nocturna No-show) opera en **America/Guayaquil (UTC-5, sin horario de verano)**. Cada `timestamp` se almacena en UTC y se interpreta/schedulea en UTC-5. Los doctores configuran su horario de atención en hora local ecuatoriana.

---

## 2. ESPECIFICACIÓN GENERAL DE REQUISITOS

### Requisitos Funcionales (RF)

| Etiqueta | Descripción | Actor |
|---|---|---|
| RF-001 | El agente conversacional agenda, confirma y cancela citas vía WhatsApp/Telegram. | Sistema |
| RF-002 | El agente escala la conversación a un humano cuando el paciente lo pide explícitamente. | Sistema |
| RF-003 | El agente escala la conversación a un humano ante reclamos o situaciones fuera de su capacidad de resolución. | Sistema |
| RF-004 | El Super Administrador visualiza métricas globales del bot: tasa de fallas, calidad de respuesta, citas agendadas, satisfacción del cliente. | Super Admin |
| RF-005 | El Administrador de Clínica visualiza el desempeño del bot de su clínica y recibe alertas cuando se requiere atención humana. | Clinic Admin |
| RF-006 | El Administrador de Clínica gestiona un mini-calendario vinculado a Google Calendar para las citas de los doctores de su clínica. | Clinic Admin |
| RF-007 | El Doctor visualiza sus citas programadas para el día actual. | Doctor |
| RF-008 | El Doctor marca una cita como completada, lo cual libera el slot en Google Calendar y dispara la encuesta de satisfacción al paciente. | Doctor |
| RF-009 | El paciente recibe una micro-encuesta de satisfacción (escala 1-5) tras la interacción/cita. | Sistema |
| RF-010 | Al confirmarse una cita, el sistema crea el evento correspondiente en el Google Calendar del doctor asignado (el evento en su calendario es su mecanismo de notificación de nuevas citas) y registra la asignación internamente. | Sistema |
| RF-011 | Cada clínica configura sus propias credenciales de Google Calendar, WhatsApp y Telegram (modelo multi-tenant "bring your own channel"). | Super Admin / Clinic Admin |
| RF-012 | Si el agente/canal falla, los mensajes entrantes se encolan para procesamiento posterior. | Sistema |
| RF-013 | El Administrador de Clínica crea, edita y cancela citas directamente en la agenda, además de las que agenda el bot. | Clinic Admin |
| RF-014 | El Super Administrador crea nuevas clínicas en el sistema (alta del tenant). | Super Admin |
| RF-015 | Las clínicas operan bajo un plan de suscripción mensual; el Super Administrador recibe una alerta cuando una clínica pierde vigencia de suscripción, para dar seguimiento comercial. | Sistema / Super Admin |
| RF-016 | El Administrador de Clínica crea y edita los doctores de su clínica, asignándoles una o más especialidades. | Clinic Admin |
| RF-017 | El agente consulta las especialidades registradas para sugerir el doctor correspondiente según el motivo de consulta del paciente. | Sistema |
| RF-018 | Para citas Confirmadas con 2 o más días de antelación, el sistema envía un mensaje de reconfirmación al paciente 2 días antes; si el paciente no responde o indica que no asistirá, la cita se cancela automáticamente y se le notifica. | Sistema |
| RF-019 | Para citas agendadas con menos de un día de antelación (de un día para otro), el sistema exige confirmación explícita del paciente dentro de una ventana corta (ej. 1 hora desde que se solicita); si no confirma dentro del plazo, la cita no se agenda y se notifica al paciente. | Sistema |
| RF-020 | El Super Administrador puede dar de alta una clínica bajo un plan de prueba gratuito con fecha de fin definida, sin requerir ninguna integración de cobro durante ese período. | Super Admin |
| RF-021 | Al vencer el plan de prueba de una clínica, el sistema la transiciona automáticamente a estado "Pago pendiente" y le solicita el pago directamente a la clínica por su canal correspondiente — no depende de que el Super Administrador lo detecte manualmente. | Sistema |
| RF-022 | Si la clínica no completa el pago dentro del plazo de gracia tras entrar en "Pago pendiente", el sistema la Suspende (bloquea el uso del agente) y notifica tanto a la clínica como al Super Administrador. | Sistema |
| RF-023 | **Handoff bidireccional a humano:** cuando una conversación es escalada (RF-002/RF-003), el agente deja de responder en ese hilo y el Administrador de Clínica puede responder al paciente directamente desde el dashboard; sus mensajes salen por el mismo canal (WhatsApp/Telegram) vía el Channel Gateway. La conversación queda en un buzón compartido por clínica con estados: `Escalada` → `En atención humana` → `Resuelta` (la clínica la cierra) → opcionalmente `Reactivada al bot`. | Clinic Admin |
| RF-024 | **Mensajes iniciados por el negocio (plantillas):** toda notificación que el sistema envía por WhatsApp fuera de la ventana de 24 horas de servicio al cliente (reconfirmaciones RF-018, encuestas RF-009, avisos de pago RF-021/RF-022, **primer mensaje de handoff RF-023**) se envía usando **plantillas de mensaje de Meta aprobadas**, gestionadas por clínica en el dashboard (alta, sincronización de estados de aprobación, selección de plantilla por tipo de notificación). Telegram no tiene esta restricción. El sistema registra el costo estimado por conversación iniciada para alimentar la métrica de costo operativo. | Sistema / Clinic Admin |
| RF-025 | **Atomicidad de agendamiento:** la consulta de disponibilidad con reserva (RF-001) se ejecuta de forma atómica: al proponer un slot al paciente, el sistema coloca un *hold* temporal (defecto: 15 minutos) sobre ese slot para esa conversación; si el paciente no confirma, el hold expira y el slot queda libre. Dos solicitudes concurrentes sobre el mismo slot no pueden confirmarse a la vez (lock distribuido en Redis). Una cita en estado Solicitada nunca bloquea el calendario del doctor de forma visible: el bloqueo es interno de Puntual, y el evento en Google Calendar solo se crea al pasar a Confirmada. **Límite de holds concurrentes por doctor: configurable por clínica (default 3).** | Sistema |
| RF-026 | **Autenticación y usuarios del dashboard:** acceso al dashboard mediante email + contraseña con sesiones seguras (JWT de corta duración + refresh token, o equivalente). El Super Administrador crea la cuenta inicial del Administrador de Clínica al dar de alta la clínica (RF-014); desde ahí, la clínica administra sus propios usuarios (admins y doctores) sin intervención de GAVANTI. Recuperación de contraseña por correo. | Sistema |
| RF-027 | **Verificación de origen de webhooks:** el Channel Gateway rechaza cualquier webhook entrante sin firma válida — `X-Hub-Signature-256` (Meta Cloud API, con el `app_secret` de la clínica) y *secret token* de Telegram — antes de encolarlo o procesarlo. | Sistema |
| RF-028 | **Retención y borrado de datos personales:** los datos de pacientes y citas se conservan mientras la clínica sea cliente vigente. Al dar de baja una clínica (eliminación del tenant por el Super Administrador), el sistema ejecuta borrado lógico inmediato (anonimización) y borrado físico programado a los 90 días, notificando a la clínica conforme a lo pactado en el contrato de servicio. El paciente puede solicitar acceso/rectificación/eliminación ante su clínica, y la clínica ejecuta la acción desde el dashboard. | Sistema / Clinic Admin |
| RF-029 | **Duración de slot configurable:** la duración por defecto de una cita es 30 minutos, configurable por clínica y sobrescribible por doctor y por especialidad (ej. limpieza 45 min, ortodoncia 60 min). El agente propone slots calculados con la duración correspondiente al motivo de consulta. | Clinic Admin |
| RF-030 | **No-show:** al cierre del día, el Doctor o el Administrador de Clínica puede marcar como No-show las citas Confirmadas no atendidas; el sistema sugiere esa acción listando las citas del día que quedaron sin completar. **Transición automática nocturna:** a las 23:59 hora local (America/Guayaquil), las citas en estado Confirmada que no fueron marcadas como Completada ni No-show pasan automáticamente a No-show. | Doctor / Clinic Admin / Sistema |

**Definiciones de métricas (para RF-004 y RF-005):**

- **Conversación (unidad de métrica):** un thread de chat (WhatsApp o Telegram) entre un paciente y una clínica. Se considera **cerrada** tras **24 horas de inactividad** (sin mensajes ni del paciente ni del bot/humano). Una nueva interacción tras ese corte inicia una nueva conversación.
- **Tasa de fallas** = (mensajes entrantes que no obtuvieron respuesta por error del sistema o del proveedor de IA) ÷ (total de mensajes entrantes procesados), por día y por clínica. Incluye caídas de canal encoladas (RF-012) cuando el reintento también falla.
- **Calidad de respuesta / tasa de resolución autónoma** = (conversaciones cerradas por el bot sin escalación a humano) ÷ (total de conversaciones cerradas en el período), por semana y por clínica. Las escaladas que el humano resuelve cuentan como "resueltas con intervención", categoría separada.
- **Satisfacción** = promedio de la micro-encuesta (1-5) por clínica y por doctor, con n visible; no se muestra promedio con n < 5.
- **Costo operativo de IA** = tokens consumidos por proveedor de IA + conversaciones iniciadas por plantillas de Meta, por clínica y mes (alimenta el análisis de margen por suscriptor, matriz de calidad "Costo-eficiencia de IA").

### Estados de Suscripción de Clínica

| Estado | Significado | Quién lo dispara | Transiciones posibles |
|---|---|---|---|
| Prueba | Plan gratuito con fecha de fin definida (RF-020). | Super Administrador, al dar de alta la clínica. | → Pago pendiente (automático al vencer) |
| Pago pendiente | La prueba venció; el sistema ya solicitó el pago a la clínica. | Sistema, automáticamente (RF-021). | → Activa (si paga), → Suspendida (si no paga a tiempo) |
| Activa | La clínica tiene un pago vigente vía la pasarela. | Sistema, al confirmarse el pago. | → Pago pendiente (al vencer el siguiente ciclo mensual) |
| Suspendida | La clínica no pagó dentro del plazo de gracia; el agente deja de operar para ella. | Sistema, automáticamente (RF-022). | → Activa (si paga después) |

**Plazo de gracia:** 5 días naturales por defecto, configurable por clínica en el alta o edición del plan (resuelve el pendiente de la v1). Durante el plazo de gracia el agente sigue operando; al vencerlo sin pago, se Suspende. El recordatorio de pago se reenvía al día 2 y al día 4 del plazo de gracia.

### Ciclo de Vida de la Cita

| Estado | Significado | Quién lo dispara | Transiciones posibles |
|---|---|---|---|
| Solicitada | El paciente pidió una cita al agente; hay un *hold* temporal interno sobre el slot (RF-025), sin evento visible en Google Calendar. | Sistema (IA), a partir de la conversación. | → Confirmada, → Cancelada, → Expirada (hold vence) |
| Confirmada | El hold se materializa como evento en Google Calendar y se notifica al doctor (RF-010). | Sistema (IA) o Administrador de Clínica (RF-013). | → Completada, → Cancelada, → No-show |
| Completada | El doctor atendió y marcó la cita como lista (RF-008). | Doctor. | Estado final — libera el slot y dispara la micro-encuesta (RF-009). |
| Cancelada | La cita no se realizará. | Paciente (vía chat), Administrador de Clínica (RF-013), o el propio Sistema si vence un plazo de confirmación. | Estado final. |
| No-show | El paciente no se presentó a una cita Confirmada. | Doctor o Administrador de Clínica (RF-030), o **Sistema automático a las 23:59 local** si no hubo acción manual. | Estado final — distinto de Cancelada para no distorsionar las métricas de asistencia real. |
| Expirada | El hold de una cita Solicitada venció sin confirmación (incluye el caso de RF-019). | Sistema. | Estado final — se notifica al paciente si aplica. |

**Reglas de transición:** una cita solo puede pasar a Completada o No-show desde Confirmada (no desde Solicitada). Cancelada es alcanzable desde Solicitada o Confirmada, pero no desde Completada. Solo Completada dispara la encuesta de satisfacción — Cancelada, Expirada y No-show no la disparan, para no molestar a un paciente que no recibió el servicio.

**Reconfirmación automática (RF-018, RF-019):** existen dos ventanas de reconfirmación según la antelación con la que se agendó la cita (todas en hora local America/Guayaquil, ver convención en §1):

- **≥ 2 días de antelación:** 2 días antes de la fecha (a las 9:00 hora local), el sistema envía un mensaje pidiendo reconfirmación. Si el paciente no responde en 24 horas o dice que no asistirá, la cita pasa automáticamente a Cancelada y se le notifica.
- **< 1 día de antelación (agendamiento de un día para otro):** no hay margen para el flujo anterior, así que el sistema exige confirmación explícita dentro de una ventana corta (1 hora) desde que se solicita la cita. Si el paciente no confirma en ese plazo, la cita nunca llega a Confirmada — pasa a Expirada y se le informa al paciente.

### Requisitos No Funcionales (RNF)

| Etiqueta | Descripción |
|---|---|
| RNF-001 | Aislamiento de datos entre clínicas (multi-tenant) — una clínica no debe poder ver datos de otra. |
| RNF-002 | Tiempo de respuesta del agente conversacional dentro de un umbral aceptable para no perder al paciente: **p95 < 5 segundos percibido** (desde que llega el mensaje hasta que sale la respuesta), medido por el observability pipeline. |
| RNF-003 | Cifrado de credenciales de canal (Google Calendar, WhatsApp, Telegram) por clínica — AES-256-GCM con clave maestra de aplicación (ver RNF-012). |
| RNF-004 | Disponibilidad objetivo del sistema: **99.5% mensual** — el agente es el único canal del paciente hacia la clínica. |
| RNF-005 | Cumplimiento de la Ley Orgánica de Protección de Datos Personales de Ecuador para datos de pacientes y agenda médica (dato sensible de salud), incluyendo su Reglamento y el régimen de datos sensibles (consentimiento, principio de finalidad, derechos ARCO — ver §7). |
| RNF-006 | Resiliencia ante fallas de canal: los mensajes encolados (RF-012) deben reintentarse (backoff exponencial, máx. 5 intentos en 24 h) y no perderse ante una caída temporal; si se agotan los reintentos, se alerta al Super Admin. |
| RNF-007 | Auditoría: toda acción administrativa (crear clínica, editar cita manualmente, cambiar suscripción, responder un handoff, borrar datos) debe quedar registrada con usuario, fecha y tenant. Retención del log de auditoría: mínimo 2 años. |
| RNF-008 | Configurabilidad del modelo de IA sin necesidad de redeploy de código (solo variable de entorno), para poder comparar costo/calidad entre proveedores. |
| RNF-009 | Observabilidad: las fallas y métricas de desempeño del bot deben quedar expuestas de forma consultable para alimentar el dashboard del Super Administrador (RF-004), no solo como logs internos. |
| RNF-010 | El agente conversacional y el frontend nunca acceden directamente a las credenciales de canal de una clínica ni a las APIs externas (Google Calendar, Meta Cloud API, Telegram); toda integración externa pasa por una capa interna de integración ("Channel Gateway") dentro del backend de Puntual, que resuelve la clínica y usa las credenciales cifradas internamente. |
| RNF-011 | Tolerancia a duplicados e idempotencia: los webhooks de Meta y Telegram pueden llegar duplicados; el procesamiento de mensajes y de confirmaciones debe ser idempotente (clave de deduplicación por `message_id`/evento). **Jobs programados (reconfirmaciones, encuestas, vencimientos de suscripción, transición nocturna No-show) usan clave de idempotencia `tipo:clinicaId:entidadId:fechaEjecucion` (ej. `reconfirmacion:cli-12:cita-456:2026-09-14`).** |
| RNF-012 | Gestión de claves: la clave maestra de cifrado vive únicamente en variables de entorno/secrets del despliegue (nunca en el repositorio ni en la base de datos); rotación manual documentada. Para escalar, migrar a un KMS gestionado sin cambiar la interfaz de cifrado. |
| RNF-013 | Rate limiting y cuotas: protección de endpoints públicos (webhooks, login) contra abuso; throttling por tenant en el Channel Gateway para no exceder límites de Meta/Telegram/Google. |

Todas cerradas por ahora — no quedan RNF pendientes de esta ronda.

---

## 3. PLATAFORMA TECNOLÓGICA E INFRAESTRUCTURA

| Elemento | Tecnología | Justificación |
|---|---|---|
| API/Backend | NestJS | Arquitectura modular con soporte nativo para multi-tenant (guards/middlewares por rol), TypeScript de primera clase. |
| Frontend/Dashboard | Next.js | Renderizado híbrido, buen soporte para las 3 vistas por rol (Super Admin, Clínica, Doctor). |
| Canal WhatsApp | Meta Cloud API | Canal oficial directo, evita depender de una capa intermedia tipo Evolution API. |
| Canal Telegram | Telegraf | Ya validado en el proyecto original (odontolog-IA). |
| Calendario | Google Calendar API | Fuente de verdad de disponibilidad y agenda por doctor/clínica. **Solo escritura unidireccional** (crear/actualizar/borrar eventos desde Puntual); no se consumen webhooks de Google Calendar para sync bidireccional. |
| Colas/Cache | Redis (self-hosted) | Soporta el encolado de mensajes ante fallas (RF-012), locks de agendamiento concurrente (RF-025) y expiración de holds. |
| Base de datos | PostgreSQL | Persistencia relacional para clínicas, doctores, citas, suscripciones — reemplaza el JSON plano del proyecto original. |

### Aislamiento de Credenciales (Channel Gateway)

Ninguna credencial de clínica (Google Calendar, Meta Cloud API, token de bot de Telegram) vive ni se consulta desde el agente conversacional directamente. Existe una capa interna dentro del backend de NestJS — un **Channel Gateway** — que es la única pieza que conoce y usa esas credenciales:

- El agente, el dashboard y cualquier otro módulo interno solo hablan con **la propia API de Puntual** (ej. `GET /internal/disponibilidad`, `POST /internal/citas`). Nunca llaman a Google Calendar, Meta o Telegram directamente.
- El Channel Gateway resuelve automáticamente a qué clínica pertenece cada mensaje entrante, sin que el agente tenga que saberlo de antemano:
  - **WhatsApp (Meta Cloud API):** el webhook de Meta incluye el `phone_number_id` del número que recibió el mensaje; ese identificador está mapeado 1:1 a una clínica en la base de datos.
  - **Telegram (Telegraf):** cada clínica tiene su propio bot/token; el webhook llega a un endpoint o token específico de esa clínica, lo que ya identifica el tenant.
  - Con la clínica resuelta, el Channel Gateway adjunta un contexto de tenant (`clinicaId`) a toda la conversación, y ese contexto es el que se usa para aislar datos (RNF-001) y para decidir qué credenciales cifradas usar al hablar con Google Calendar.
- Antes de encolar o procesar, el Gateway **verifica la firma del webhook** (RF-027).
- Esto cumple dos cosas a la vez: cifra y oculta las credenciales por completo del agente de IA (LOPDP), y centraliza la lógica de "a qué clínica pertenece este mensaje" en un solo lugar en vez de repetirla en cada integración.

**Decisiones complementarias:**

- **ORM**: Prisma encaja bien con NestJS + Postgres y facilita el modelo multi-tenant (aislamiento por `clinica_id`).
- **Gestor de plantillas (RF-024):** módulo dentro del Channel Gateway (lado Meta) que almacena los nombres/estados de las plantillas por clínica y decide cuándo un envío requiere plantilla (fuera de ventana de 24 h) vs. mensaje libre (dentro de la ventana). **Tipos de plantilla gestionados: `reconfirmacion`, `encuesta`, `aviso_pago`, `handoff`.** Costo estimado por conversación iniciada: **valor único global configurable** (ej. `META_TEMPLATE_COST_USD=0.005`), registrado por envío para métricas de costo operativo.
- **Jobs programados — decisión por fases:** para el MVP, las reconfirmaciones (RF-018/019), vencimientos de suscripción (RF-015), encuestas, **transición nocturna No-show (RF-030)** y recordatorios de pago se ejecutan con un **scheduler simple (cron en el backend + tabla `scheduled_jobs` en Postgres, con trazabilidad e idempotencia por job usando clave `tipo:clinicaId:entidadId:fechaEjecucion`)**, en vez de introducir BullMQ desde el día uno. BullMQ sobre Redis se adopta cuando el volumen de clínicas haga insuficiente el cron (misma capacidad de encolado de RF-012, menos superficie operativa al inicio).
- **Orquestación de IA**: se mantiene el enfoque de odontolog-IA (Vercel AI SDK con fallback multi-modelo), pero el modelo primario y el de respaldo se definen por variable de entorno (`.env`), no hardcodeados en el código. Esto permite cambiar de proveedor (ej. de GPT-4 a Gemini) o probar cuál responde mejor y a menor costo, sin tocar código ni rehacer el deploy — solo redeployar con el `.env` actualizado.

- **Cobros de suscripción — recomendación revisada: PayPhone para el arranque, Kushki como migración futura.** La variable que importa aquí no es solo la comisión, sino la fricción de arranque:
  - **PayPhone**: registro de comercio autoservicio, se generan credenciales de API y se pueden emitir links de cobro "en segundos" desde el propio sistema, sin aprobación previa ni contacto humano para el flujo básico (API Link / API Sale). Comisión de 5% + IVA, solo sobre lo que efectivamente cobras, sin costos fijos ni penalización si no cobras nada un mes (relevante para clínicas en plan de prueba gratuito).
  - **Kushki**: requiere un proceso formal de "afiliación" — envío de documentación (RUC, cuenta bancaria) y selección de banco adquirente (Internacional, Pacífico o Guayaquil), con 1-2 semanas de aprobación. Además, para habilitar cobros recurrentes reales (tokenización externa) hay que contactar a un ejecutivo de cuenta y certificarse en PCI DSS. Es la opción más barata por transacción, pero no es "integro y ya puedo cobrar" — tiene fricción humana y de cumplimiento desde el día uno.
  - **Para el MVP y las primeras clínicas: PayPhone.** Cuando el volumen de clínicas pagas justifique el ahorro en comisión (2.95% vs 5%+IVA), se evalúa migrar el cobro a Kushki sin tener que rediseñar el modelo de Suscripción/Plan — solo el procesador detrás.
  - Importante: ninguna de las dos pasarelas se necesita mientras una clínica esté en plan de prueba gratuito (ver RF-020 más abajo) — la integración de cobro solo entra en juego cuando una clínica pasa a plan pago.

- **Observabilidad — decisión por fases:** para el MVP, **logs estructurados (JSON) en Postgres + endpoints de métricas agregadas** que alimentan directamente el dashboard del Super Admin (suficiente para RF-004/RNF-009: fallas, latencia p95, resolución autónoma). **OpenObserve (self-hosted)** se evalúa como fase 2 cuando el volumen de logs lo justifique — unifica logs, métricas y trazas vía SQL/API sin que el Super Administrador dependa de una herramienta externa. (Sentry autohospedado queda descartado por sobredimensionado: requiere Kafka + ClickHouse + Redis + Postgres adicionales.)

---

## 4. MATRIZ DE ATRIBUTOS DE CALIDAD

| Atributo | Prioridad | Aplicación | Riesgo |
|---|---|---|---|
| Disponibilidad | Alta | El bot es el único canal del paciente hacia la clínica; caídas se traducen en citas perdidas. | Dependencia de APIs externas (WhatsApp, Google Calendar). |
| Seguridad/Privacidad | Alta | Datos de pacientes y agenda médica son sensibles bajo LOPDP Ecuador. | Multi-tenant mal aislado expone datos entre clínicas. |
| Precisión de escalación | Alta | Una mala detección de "requiere humano" frustra al paciente o sobrecarga a la clínica. | Falsos negativos/positivos en la lógica de handoff. |
| Continuidad de servicio por suscripción | Media-Alta | Una clínica con suscripción vencida no debería perder acceso de forma abrupta sin aviso previo (RF-015). | Cortar el servicio sin gracia/aviso genera fricción comercial con el cliente. |
| Desempeño | Alta | El paciente espera respuesta casi inmediata del agente por chat; una demora larga se siente como que "no funciona". | Latencia del proveedor de IA o de la consulta a Google Calendar en tiempo real. |
| Usabilidad | Media-Alta | El Administrador de Clínica cumple un rol tipo secretaria, sin perfil técnico — el dashboard debe ser autoexplicativo. | Sobrecargar el dashboard con métricas técnicas (propias de observabilidad) en vez de indicadores accionables. |
| Costo-eficiencia de IA | Media | El modelo de IA es el costo variable más directo del negocio; debe poder monitorearse y ajustarse (RNF-008). | Un modelo caro sin visibilidad de costo erosiona el margen por clínica suscrita. |
| Confiabilidad del agendamiento | Alta | Dos pacientes no deben poder confirmar el mismo slot, ni un slot quedar bloqueado indefinidamente (RF-025). | Carreras de concurrencia o holds sin expiración degradan la agenda. |
| Cumplimiento de plantillas Meta | Media-Alta | Las reconfirmaciones/encuestas/avisos/handoff dependen de plantillas aprobadas (RF-024). | Una plantilla rechazada o pausada silencia las notificaciones del sistema. |

Sin pendientes en esta sección por ahora.

---

## 5. ESPECIFICACIÓN DE CASOS DE USO (CUs)

### CU-001: Agendamiento de Cita vía Chat (RF-001, RF-017, RF-025, RF-029)
| Campo | Detalle |
|---|---|
| Descripción | El paciente agenda una cita conversando con el agente por WhatsApp o Telegram. |
| Actores | Paciente, Sistema (IA). |
| Flujo Principal | 1. Paciente inicia conversación. 2. El agente identifica intención de agendar y solicita datos (motivo de consulta, disponibilidad). 3. El agente consulta disponibilidad a través de la API interna de Puntual, que internamente usa las credenciales cifradas de la clínica para consultar Google Calendar. 4. Al proponer un slot, el sistema coloca un *hold* temporal de 15 min (RF-025), respetando el límite de holds concurrentes por doctor (default 3, configurable). 5. El paciente confirma → la cita pasa a Confirmada, se crea el evento en Google Calendar (RF-010) y se notifica al doctor. 6. Si el hold expira sin confirmación, la cita pasa a Expirada. |
| Flujo Alterno | A. Motivo de consulta no claro → el agente pregunta por síntomas/tratamiento y cruza con especialidades (RF-017). B. Slot propuesto no sirve → se libera el hold y se propone el siguiente disponible. C. Límite de holds alcanzado → el agente informa al paciente que no hay disponibilidad inmediata y sugiere horarios alternativos. |

### CU-002: Escalación a Atención Humana (RF-002, RF-003)
| Campo | Detalle |
|---|---|
| Descripción | El agente detecta que no puede continuar resolviendo la conversación y transfiere a un humano de la clínica. |
| Actores | Paciente, Sistema (IA), Administrador de Clínica. |
| Flujo Principal | 1. El paciente pide hablar con alguien, o el sistema detecta un reclamo/situación no resoluble. 2. El agente envía un mensaje de transición al paciente ("te comunico con un asistente") y deja de intervenir en ese hilo. 3. La conversación aparece en el buzón de handoff del dashboard con prioridad y resumen generado por el agente (motivo, datos ya recolectados). 4. El sistema notifica al Administrador de Clínica (RF-005). |
| Post-condición | La conversación queda en estado `Escalada`; su atención continúa en CU-009. |

### CU-003: Doctor Completa Cita del Día (RF-007, RF-008)
| Campo | Detalle |
|---|---|
| Descripción | El doctor revisa su agenda diaria y marca cada cita como completada al finalizar. |
| Actores | Doctor. |
| Flujo Principal | 1. Doctor abre su vista de citas del día. 2. Atiende al paciente. 3. Marca la cita como "lista". 4. La API interna de Puntual libera el slot en Google Calendar (usando las credenciales cifradas de la clínica) y dispara la encuesta de satisfacción (CU-010). |

### CU-004: Monitoreo Global del Bot (RF-004)
| Campo | Detalle |
|---|---|
| Descripción | El Super Administrador revisa la salud y desempeño del agente across todas las clínicas. |
| Actores | Super Administrador. |
| Flujo Principal | 1. Accede al dashboard global. 2. Visualiza fallas, tasa de resolución autónoma, citas agendadas y satisfacción agregada, según las definiciones de métricas del §2 (conversación = thread 24h inactividad). 3. Puede filtrar por clínica, período y canal (WhatsApp/Telegram). |

### CU-005: Gestión Manual de la Agenda (RF-013)
| Campo | Detalle |
|---|---|
| Descripción | El Administrador de Clínica crea, edita o cancela una cita directamente desde el dashboard, sin pasar por el bot. |
| Actores | Administrador de Clínica. |
| Flujo Principal | 1. Accede al mini-calendario. 2. Selecciona crear/editar/cancelar. 3. El sistema valida disponibilidad (misma lógica de holds y atomicidad, RF-025) y sincroniza con Google Calendar a través del Channel Gateway (el dashboard nunca llama a Google Calendar directamente). |

### CU-006: Alta de Clínica (RF-014, RF-015, RF-020, RF-021, RF-026)
| Campo | Detalle |
|---|---|
| Descripción | El Super Administrador registra una nueva clínica como cliente de Puntual, ya sea directamente en plan pago o en un plan de prueba gratuito por tiempo definido (típico durante el MVP, para conseguir la primera clínica piloto). |
| Actores | Super Administrador. |
| Flujo Principal | 1. Super Administrador crea la clínica y elige el tipo de plan: prueba gratuita (con fecha de fin) o pago (vinculado a la pasarela). 2. Se crea la cuenta inicial del Administrador de Clínica (RF-026) y se le envía invitación por correo. 3. La clínica configura sus credenciales de canal (Google Calendar, WhatsApp, Telegram) — esto no depende del tipo de plan. 4. Si está en prueba, el sistema no invoca la pasarela de pago en ningún momento. 5. Al acercarse o vencer la fecha de fin de la prueba, el sistema alerta al Super Administrador para convertirla a pago (ahí sí se activa la integración con PayPhone/Kushki) o darla de baja. |

### CU-007: Gestión de Doctores y Especialidades (RF-016, RF-017, RF-029)
| Campo | Detalle |
|---|---|
| Descripción | El Administrador de Clínica registra doctores y les asigna especialidades y duración de slot, que el agente usa para sugerir el doctor correcto. |
| Actores | Administrador de Clínica, Sistema (IA). |
| Flujo Principal | 1. Administrador crea/edita un doctor: especialidad(es), horario de atención, duración de slot (RF-029). 2. El paciente describe su necesidad al agente. 3. El agente cruza la necesidad con las especialidades disponibles y sugiere el doctor. |

### CU-008: Reconfirmación Automática de Cita (RF-018, RF-019, RF-024)
| Campo | Detalle |
|---|---|
| Descripción | El sistema pide confirmación al paciente antes de la fecha de la cita, con una ventana distinta según qué tan próxima esté. |
| Actores | Paciente, Sistema (IA). |
| Flujo Principal | 1. Si faltan ≥2 días para la cita, el sistema envía el recordatorio de reconfirmación 2 días antes a las 9:00 (hora local); si en 24 h no hay respuesta o el paciente dice que no asistirá, cancela automáticamente y notifica. 2. Si la cita se agendó de un día para otro, el sistema exige confirmación explícita dentro de 1 hora; si no llega, la cita pasa a Expirada y se notifica al paciente. 3. En WhatsApp, estos envíos usan plantillas aprobadas si caen fuera de la ventana de 24 h (RF-024); si el paciente responde, la conversación retoma la ventana y el agente procesa la respuesta. |

### CU-009: Atención Humana desde el Dashboard (RF-023, RF-005)
| Campo | Detalle |
|---|---|
| Descripción | El Administrador de Clínica atiende las conversaciones escaladas respondiendo al paciente desde el dashboard, por el mismo canal por el que escribió el paciente. |
| Actores | Administrador de Clínica, Paciente. |
| Flujo Principal | 1. El admin abre el buzón de handoff y selecciona una conversación `Escalada` (ve historial completo y el resumen del agente). 2. Al escribir el primer mensaje, la conversación pasa a `En atención humana`; el mensaje sale por WhatsApp/Telegram vía Channel Gateway (es un mensaje del negocio: **usa plantilla `handoff` si aplica, RF-024**). 3. El admin resuelve la solicitud (agenda manual si aplica, CU-005) y marca la conversación como `Resuelta`. 4. Opcionalmente, reactiva el bot en ese hilo. |
| Flujo Alterno | A. La conversación escalada era solo un reclamo informativo → el admin responde y cierra sin agendar. B. Nadie atiende en X minutos (configurable, defecto 30) → se reenvía la alerta y se escala notificación a un segundo contacto de la clínica. |

### CU-010: Micro-encuesta de Satisfacción (RF-009, RF-024)
| Campo | Detalle |
|---|---|
| Descripción | Al completarse una cita, el sistema envía al paciente una micro-encuesta de 1-5 y registra la respuesta para las métricas de satisfacción. |
| Actores | Sistema, Paciente. |
| Flujo Principal | 1. El doctor marca la cita como Completada (RF-008). 2. El sistema programa el envío de la encuesta para 1-2 horas después (configurable), dando margen para que el paciente salga de consulta. 3. El paciente recibe el mensaje (plantilla en WhatsApp si aplica) y responde con un número del 1 al 5 o con botones. 4. El sistema registra la respuesta vinculada a cita, doctor y clínica; alimenta las métricas (§2, definición de satisfacción). |
| Reglas | - Se envía **una sola vez** por cita completada; sin recordatorios. - Si el paciente no responde en 24 h, la encuesta queda sin respuesta (sin consecuencias, sin reenvío). - Una respuesta fuera de rango o ambigua es rechazada con una pregunta de aclaración (una sola vez). - Cancelada, Expirada y No-show **no** disparan encuesta. |

### CU-011: Gestión de Plantillas de Mensaje (RF-024)
| Campo | Detalle |
|---|---|
| Descripción | La clínica administra en el dashboard las plantillas de WhatsApp que el sistema usa para mensajes iniciados por el negocio. |
| Actores | Administrador de Clínica. |
| Flujo Principal | 1. El admin crea/sincroniza una plantilla en Meta (nombre, idioma, categoría, cuerpo) y la registra en Puntual indicando su tipo: **`reconfirmacion`, `encuesta`, `aviso_pago`, `handoff`**. 2. El sistema muestra el estado de aprobación de Meta por plantilla y **bloquea/bypass con alerta** el envío de notificaciones cuyo tipo no tenga plantilla aprobada (alerta visible para admin y Super Admin, para que una plantilla rechazada no silencie el sistema). 3. El sistema registra por envío: tipo, plantilla usada, **costo estimado (valor único global configurable `META_TEMPLATE_COST_USD`)** y resultado. |

---

## 6. TARJETAS CRC (CLASES CANDIDATAS)

1. **Clínica:** representa al tenant — credenciales de canal, doctores asociados, configuración de calendario, suscripción activa, usuarios del dashboard.
2. **Doctor:** agenda, disponibilidad, especialidad(es), duración de slot, citas asignadas, **límite de holds concurrentes (configurable, default 3)**.
3. **Paciente:** identidad mínima necesaria para agendar (nombre, contacto), historial de citas.
4. **Cita:** estado (Solicitada/Confirmada/Completada/Cancelada/No-show/Expirada), *hold* temporal con expiración, vínculo a slot de Google Calendar, doctor y paciente asociados.
5. **Agente/Bot:** motor conversacional, lógica de escalación, sugerencia de doctor por especialidad, métricas de interacción — nunca posee credenciales de clínica, solo llama a la API interna de Puntual.
6. **Conversación/Thread:** hilo de chat con el paciente; **corte por 24h inactividad para métricas**; estados de handoff (Escalada / En atención humana / Resuelta / Reactivada al bot); historial compartido con el dashboard.
7. **Encuesta:** resultado de satisfacción vinculado a una cita completada; envío único, respuesta opcional.
8. **Alerta:** notificación de atención humana requerida (a Clínica) o de cambio de estado de suscripción (a Super Administrador).
9. **Suscripción/Plan:** tipo de plan (prueba gratuita / pago), estado de vigencia (Prueba/Pago pendiente/Activa/Suspendida), fecha de vencimiento, plazo de gracia, pasarela asociada (solo aplica si es plan pago).
10. **Channel Gateway:** guarda y cifra las credenciales de canal por clínica (Google Calendar, Meta Cloud API, Telegram); resuelve qué clínica corresponde a cada mensaje entrante, **verifica firmas de webhook**, gestiona plantillas de Meta (tipos: reconfirmacion, encuesta, aviso_pago, handoff), y es el único componente que habla con las APIs externas (**Google Calendar: solo escritura**).
11. **ScheduledJob:** trabajos programados (reconfirmaciones, vencimientos de suscripción, envío de encuestas, **transición nocturna No-show**) con trazabilidad e idempotencia; en el MVP se ejecutan vía scheduler simple (§3). **Clave de idempotencia: `tipo:clinicaId:entidadId:fechaEjecucion` (ej. `reconfirmacion:cli-12:cita-456:2026-09-14`, `no_show_nocturno:cli-12:2026-09-14`).**

---

## 7. REFERENCIAS REGULATORIAS (ÁMBITO LEGAL)

- **Ley Orgánica de Protección de Datos Personales (Ecuador):** aplica con especial cuidado por tratarse de datos de salud (citas médicas), no solo datos personales generales. Implica: consentimiento informado del paciente (recolectado vía chat en el alta del paciente), principio de finalidad (los datos solo se usan para gestión de citas), derechos ARCO ejecutables vía la clínica (RF-028), y medidas técnicas de seguridad proporcionales (cifrado RNF-003/RNF-012, aislamiento RNF-001).
- **Reglamento a la LOPDP (Decreto Ejecutivo Nro. 2977):** desarrolla obligaciones del responsable del tratamiento: registro de actividades de tratamiento, política de retención, y medidas de seguridad — cubierto por RF-028 y RNF-007.
- **Responsable del tratamiento:** cada clínica es responsable de los datos de sus pacientes; GAVANTI actúa como **encargado del tratamiento** (procesa por cuenta de la clínica). El contrato de suscripción debe incluir la cláusula de encargo de tratamiento que la LOPDP exige, junto con la política de retención/borrado (RF-028). Debe quedar reflejado en los términos que el paciente acepta en el chat.
- **Historias clínicas (normativa del Ministerio de Salud Pública):** Puntual **no** almacena historia clínica ni diagnósticos — solo datos de agendamiento (nombre, contacto, motivo de consulta en términos generales, fecha/hora). La clínica conserva la historia clínica en sus propios sistemas conforme a la normativa sanitaria vigente. Esta delimitación debe mantenerse como regla de diseño: el campo "motivo de consulta" se limita a categorías de tratamiento, no a descripciones clínicas.
- **Recomendación operativa:** suscribir un registro de actividades de tratamiento por clínica (registro interno simple dentro del dashboard o documento por clínica) para facilitar una eventual notificación ante incidentes de seguridad a la autoridad de protección de datos dentro de las 72 horas.

---

## 8. CHECKLIST DE ARRANQUE DE PILOTO (PRE-REQUISITOS OPERATIVOS)

Antes de dar de alta la primera clínica piloto (CU-006) y activar tráfico real de pacientes, deben quedar resueltos los siguientes puntos que **no son requisitos funcionales del sistema, pero sí condiciones externas** de las que depende el correcto funcionamiento de RF-018/RF-019/RF-009/RF-021/RF-022/RF-023:

| # | Pre-requisito | Por qué bloquea el arranque | Responsable |
|---|---|---|---|
| 1 | Las 4 plantillas de Meta (`reconfirmacion`, `encuesta`, `aviso_pago`, `handoff`) deben estar **creadas y aprobadas por Meta** antes de la primera cita real. | La aprobación de Meta puede tardar de horas a varios días, y una plantilla puede ser rechazada sin motivo claro la primera vez. Si RF-018 (reconfirmación a 2 días) se dispara sin plantilla aprobada, el paciente nunca recibe el mensaje y la cita se cancela "silenciosamente" desde su perspectiva. | Administrador de Clínica (con soporte de GAVANTI) |
| 2 | Verificar que el número de WhatsApp Business de la clínica esté verificado y con el límite de conversaciones/día (tier) suficiente para el volumen esperado del piloto. | Meta limita el volumen de conversaciones iniciadas por negocio según el tier del número; un piloto que arranca en un tier bajo puede toparse con el límite antes de tener datos útiles. | Administrador de Clínica |
| 3 | Confirmar que el calendario de Google del/los doctor(es) piloto está compartido con la cuenta de servicio/credenciales que usará el Channel Gateway, con permisos de escritura. | RF-010/CU-001 dependen de poder crear eventos en el calendario del doctor asignado; sin el permiso correcto, toda cita "Confirmada" fallaría silenciosamente al intentar sincronizar. | Administrador de Clínica |
| 4 | Definir y comunicar a la clínica piloto la fecha de fin de su período de prueba gratuita (RF-020) antes del alta, para evitar sorpresas en la transición a "Pago pendiente" (RF-021). | Evita fricción comercial si la clínica no esperaba la transición automática a cobro. | Super Administrador |
| 5 | Validar en un entorno de prueba (sandbox de Meta) que el flujo de handoff (CU-009) efectivamente usa la plantilla `handoff` fuera de la ventana de 24 h, antes de depender de ella con un paciente real. | Es la plantilla más nueva (añadida en v3); conviene probarla end-to-end antes de que un reclamo real dependa de que salga correctamente. | GAVANTI (equipo técnico) |

**Nota:** este checklist no reemplaza los criterios de aceptación por RF/CU que se definirán en el desglose de épicas — es una capa previa de "condiciones externas listas" específica para el arranque del piloto.

---

## APÉNDICE A: RESUMEN DE CAMBIOS v1 → v2 → v3 → v4

### v1 → v2 (2026-09-12)
1. **Resueltos los 3 pendientes de la v1:** plazo de gracia definido (5 días, configurable); creado CU-010 (micro-encuesta); sección regulatoria ampliada (Reglamento a la LOPDP, rol encargado/responsable, delimitación con historia clínica).
2. **RF-023 (handoff bidireccional)** y **CU-009**: mecanismo completo de escalación — buzón compartido, estados, respuesta del humano desde el dashboard vía Channel Gateway.
3. **RF-024 y CU-011 (plantillas Meta):** restricción de ventana de 24 h, gestor de plantillas, comportamiento ante plantilla rechazada, costo por conversación.
4. **RF-025:** atomicidad de agendamiento con hold temporal de 15 min y locks en Redis; nueva transición Expirada en el ciclo de vida de la cita.
5. **RF-026:** autenticación y gestión de usuarios del dashboard.
6. **RF-027 / RNF-011:** verificación de firmas de webhook e idempotencia.
7. **RF-028:** retención, borrado y derechos ARCO.
8. **RF-029:** duración de slot configurable por doctor/especialidad.
9. **RF-030:** flujo de No-show con sugerencia al cierre del día.
10. **RNF-002:** umbral definido (p95 < 5 s). **RNF-006:** política de reintentos. **RNF-007:** retención del log de auditoría. **RNF-012/RNF-013:** gestión de claves y rate limiting. RNF-010 reordenado a su posición.
11. **Definiciones de métricas de RF-004** (formulas concretas de fallas, resolución autónoma, satisfacción, costo).
12. **Convención de zona horaria** explícita (America/Guayaquil, UTC-5).
13. **Redacción de RF-010** clarificada (el evento en Google Calendar es la notificación al doctor).
14. **Decisiones por fases:** scheduler simple + logs en Postgres para el MVP (BullMQ y OpenObserve como fase 2), reduciendo la superficie operativa inicial.

### v2 → v3 (2026-09-13) — Cierre de puntos menores para breakpoints
1. **Definición de "conversación" para métricas (§2):** thread por paciente/clínica, corte por **24h de inactividad**.
2. **RF-025:** añadido **límite de holds concurrentes por doctor (configurable, default 3)**.
3. **RF-030 / Ciclo de vida:** añadida **transición automática nocturna a No-show a las 23:59 local** para citas Confirmadas sin acción manual.
4. **Google Calendar (§3):** confirmado **solo escritura unidireccional** (no webhook de sync bidireccional).
5. **RF-024 / CU-011:** **costo estimado por conversación iniciada = valor único global configurable** (`META_TEMPLATE_COST_USD`).
6. **RNF-011 / ScheduledJob:** **clave de idempotencia para jobs** = `tipo:clinicaId:entidadId:fechaEjecucion`.
7. **CU-011:** **tipo de plantilla `handoff` añadido explícitamente** (primer mensaje humano en escalación fuera de ventana 24h).
8. **Convención de zona horaria (§1):** extendida a corte de conversación y transición nocturna No-show.

### v3 → v4 (2026-09-14) — Corrección de trazabilidad y checklist de arranque
1. **Corrección de referencia cruzada:** en §3 (Aislamiento de Credenciales), la verificación de firma de webhook citaba erróneamente **RNF-027**; corregido a **RF-027**, que es el requisito funcional real que define esa validación.
2. **Nueva sección 8 — Checklist de arranque de piloto:** 5 pre-requisitos operativos externos (aprobación de plantillas Meta, tier del número de WhatsApp, permisos de escritura en Google Calendar del doctor piloto, comunicación de fecha de fin de prueba, prueba end-to-end de la plantilla `handoff` en sandbox) que deben resolverse antes de dar de alta la primera clínica real — no son RF/RNF del sistema, sino condiciones de las que dependen RF-018/019/009/021/022/023 en producción.

---

**El documento v4 está listo para desglose en épicas/historias con criterios de aceptación trazables a cada RF/CU/RNF.**