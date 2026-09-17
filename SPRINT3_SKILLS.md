# SPRINT 3 — Inventario de Habilidades (Protocolo Skill-First)

> **Regla rectora:** Ningún ticket pasa a `In Progress` sin que sus habilidades requeridas estén inventariadas, verificadas y declaradas como **Disponibles** con evidencia reproducible. Cada subagente debe ejecutar su mini-protocolo Skill-First antes de tocar código.

---

## 1. Matriz de Habilidades del Sprint 3

| Habilidad | Origen | Evidencia de Disponibilidad | Subagente Asignado | Estado |
|---|---|---|---|---|
| **`availability-calculation`** | Adquirida / Código base | Lógica en `E1.5` de horarios recurrentes (`startTime`, `endTime`, `dayOfWeek`), intervalos de 30 min / jerarquía. Verificado en `apps/api/src/modules/doctors`. | `backend_availability_engineer` | **Disponible** |
| **`timezone-handling`** (`America/Guayaquil`) | Existente / Repo | Documento Técnico v4 §1, Guía v1 §27. Manipulación con `date-fns-tz` o utilitario `Date` UTC vs UTC-5 sin DST. | `backend_availability_engineer`, `backend_postgres_defense_engineer` | **Disponible** |
| **`slot-duration-hierarchy`** | Existente / Repo | Resuelto y aceptado en E1.5 (Sprint 2): `Doctor > Specialty > Clinic default (30 min)`. Campos ya presentes en `schema.prisma`. | `backend_availability_engineer` | **Disponible** |
| **`redis-lua-atomicity`** | Adquirida / Docs & Spike | Script Lua embebido en `RedisService` (`EVAL`/`EVALSHA`): valida slot no tomado (`SET NX EX`), valida `current_holds < maxConcurrentHolds`, incrementa contador atómicamente. Fallo controlado y des-incremento atómico. Probado con `ioredis`. | `backend_redis_locking_engineer` | **Disponible** |
| **`hold-lifecycle`** | Existente / Docs | Ciclo definido en RF-025: Hold de 15 min con TTL en Redis, decremento atómico al expirar/confirmar/cancelar, asociación unívoca a `conversationId`. | `backend_redis_locking_engineer` | **Disponible** |
| **`reconciliation-after-restart`** | Adquirida / Patrón | Proceso en arranque de módulo (`onApplicationBootstrap` / `OnModuleInit`): lee holds activos de Postgres (`status = SOLICITADA` y `holdExpiresAt > NOW()`) y reconstruye claves/contadores en Redis para evitar contadores inflados o locks huérfanos. | `backend_redis_locking_engineer` | **Disponible** |
| **`postgres-exclusion-constraints`** | Adquirida / Postgres docs | Extensión `btree_gist` en PostgreSQL 16 con `EXCLUDE USING gist (doctor_id WITH =, tstzrange(start_at, end_at) WITH &&) WHERE (status IN ('SOLICITADA', 'CONFIRMADA'))`. Impide a nivel motor solapamientos de citas activas. | `backend_postgres_defense_engineer` | **Disponible** |
| **`prisma-migrations`** | Existente / Skills | Skills locales `.agents/skills/prisma-cli` y `prisma-database-setup`. Migración manual vía `prisma migrate dev --create-only` con SQL nativo para `btree_gist` y partial exclusion constraints. | `backend_postgres_defense_engineer` | **Disponible** |
| **`scheduled-jobs`** | Existente / Guía §17 | Patrón `scheduled_jobs` en PostgreSQL con clave de idempotencia `tipo:clinicaId:entidadId:fechaEjecucion` y verificación perezosa (lazy check) + barrido cron sin BullMQ. | `backend_postgres_defense_engineer`, `backend_confirmation_engineer` | **Disponible** |
| **`lazy-expiration`** | Existente / Docs | En cada consulta de disponibilidad o intento de confirmación, si `holdExpiresAt < NOW()`, la cita se transiciona a `EXPIRADA` en Postgres y se decrementa el contador en Redis si persiste. | `backend_postgres_defense_engineer` | **Disponible** |
| **`concurrency-testing`** | Adquirida / Spike Jest | Suite Node con `Promise.all` y `autocannon` disparando N peticiones concurrentes contra el mismo slot de tiempo y probando límite de 3 holds concurrentes con 5 peticiones. | `qa_concurrency_engineer` | **Disponible** |
| **`load-generation`** | Existente / Skill | Generación de ráfagas HTTP concurrentes mediante scripts Node `fetch` concurrentes y `p-limit` / `Promise.all` con medición de respuestas 200 OK vs 409 Conflict. | `qa_concurrency_engineer` | **Disponible** |
| **`evidence-capture`** | Existente / Repo | Captura de logs estructurados, códigos HTTP y conteos de base de datos antes y después de ráfagas concurrentes para adjuntar al PR. | `qa_concurrency_engineer` | **Disponible** |
| **`calendar-port-adapter`** | Existente / Repo | `CalendarPort` y `GoogleCalendarAdapter` implementados y aceptados en Sprint 2 (`apps/api/src/modules/calendar`). Métodos `createEvent`, `updateEvent`, `deleteEvent`, `refreshAccessToken`. | `backend_confirmation_engineer` | **Disponible** |
| **`idempotency`** | Existente / Skill | Skills `.agents/skills/stripe-webhook-idempotency` y `.agents/skills/sent-webhook-engineer`. Clave `appointmentId + conversationId` y guard en base de datos para reentradas seguras. | `backend_confirmation_engineer` | **Disponible** |
| **`partial-failure-handling`** | Existente / RNF-006 | Si commit en Postgres OK y Google Calendar falla → cita queda `CONFIRMADA` con `calendarSyncStatus = PENDING`, registro de job en `scheduled_jobs` con reintento y backoff. No se aborta la confirmación al paciente. | `backend_confirmation_engineer` | **Disponible** |
| **`meta-template-compliance`** | Existente / RF-024 | Ventana de 24h WhatsApp. La confirmación tras interacción del paciente es respuesta directa (no requiere plantilla). Notificaciones proactivas fuera de ventana sí requieren plantilla aprobada. | `backend_confirmation_engineer` | **Disponible** |
| **`structured-logging`** | Existente / Repo | `StructuredLoggerService` en `apps/api/src/infrastructure/logging`, propagación de `traceId`, `clinicId`, `conversationId`, `appointmentId`. | Transversal (todos) | **Disponible** |
| **`tenant-isolation-testing`** | Existente / Repo | Suite `apps/api/test/tenant-isolation.e2e-spec.ts` y doc `docs/models-with-clinic-id.md`. Extensión obligatoria a nuevos modelos (`Conversation`, `ScheduledJob`). | `qa_tenant_isolation_engineer` | **Disponible** |
| **`fixture-management`** | Existente / Repo | Creación y teardown idempotente de clínicas, doctores, horarios y pacientes en base de datos de test (`apps/api/test/setup-e2e.ts`). | `qa_tenant_isolation_engineer`, `qa_concurrency_engineer` | **Disponible** |
| **`github-actions` & `service-containers`** | Existente / Repo | `.github/workflows/ci-staging.yml` con servicios `postgres:16-alpine` y `redis:7-alpine`. Configuración de nuevo job bloqueante de concurrencia. | `devops_ci_engineer` | **Disponible** |
| **`hexagonal-pragmatic` & `code-review`** | Existente / Guía §38 | Revisión estricta de límites arquitectónicos: dominio no conoce infraestructura, casos de uso usan puertos, no librerías directas en core. | `reviewer_architect` | **Disponible** |

---

## 2. Planes de Adquisición Ejecutados (Spikes & Verificaciones)

### 2.1 `redis-lua-atomicity` (E2.2b)
- **Desafío:** Ejecutar de forma atómica: 1) Verificación de límite de holds activos por doctor (`current_holds < max`), 2) Colocación de lock con TTL sobre el slot (`SET {clinic}:{doctor}:{slot} {conversationId} NX EX {ttl}`), 3) Incremento del contador `INCR {clinic}:{doctor}:holds_count`.
- **Solución Lua validada:**
  ```lua
  -- KEYS[1]: slot key (e.g. hold:slot:clinicId:doctorId:slotTime)
  -- KEYS[2]: doctor hold counter key (e.g. hold:count:clinicId:doctorId)
  -- ARGV[1]: conversationId
  -- ARGV[2]: ttlSeconds (e.g. 900)
  -- ARGV[3]: maxConcurrentHolds (e.g. 3)

  local currentHolds = tonumber(redis.call('GET', KEYS[2]) or '0')
  if currentHolds >= tonumber(ARGV[3]) then
    return {0, 'MAX_HOLDS_EXCEEDED'}
  end

  local acquired = redis.call('SET', KEYS[1], ARGV[1], 'NX', 'EX', tonumber(ARGV[2]))
  if not acquired then
    return {0, 'SLOT_ALREADY_LOCKED'}
  end

  redis.call('INCR', KEYS[2])
  return {1, 'OK'}
  ```
- **Liberación atómica en Lua (Release / Expire / Confirm):**
  ```lua
  -- KEYS[1]: slot key
  -- KEYS[2]: doctor hold counter key
  -- ARGV[1]: conversationId

  local owner = redis.call('GET', KEYS[1])
  if owner == ARGV[1] then
    redis.call('DEL', KEYS[1])
    local c = redis.call('DECR', KEYS[2])
    if c < 0 then redis.call('SET', KEYS[2], '0') end
    return 1
  else
    return 0
  end
  ```
- **Estado:** Adquirida y documentada para implementación directa en `RedisService` / `HoldService`.

### 2.2 `postgres-exclusion-constraints` (E2.2c)
- **Desafío:** Bloquear a nivel de motor relacional cualquier posibilidad de doble reserva física sobre el mismo doctor y rango de tiempo en estados `SOLICITADA` o `CONFIRMADA`.
- **Solución SQL validada:**
  ```sql
  CREATE EXTENSION IF NOT EXISTS btree_gist;

  ALTER TABLE appointments 
  ADD CONSTRAINT appointment_no_overlapping_active_slots 
  EXCLUDE USING gist (
    doctor_id WITH =,
    tstzrange(start_at, end_at) WITH &&
  ) 
  WHERE (status IN ('SOLICITADA', 'CONFIRMADA'));
  ```
- **Estado:** Adquirida y lista para integrarse vía migración Prisma SQL raw.

---

## 3. Mini-Protocolo Skill-First para Subagentes

Cada subagente invocado debe incluir en su primer paso:
1. **Declaración:** Enunciar formalmente las habilidades requeridas para su ticket.
2. **Chequeo:** Confirmar disponibilidad de herramientas y tipos antes de modificar archivos.
3. **Ejecución:** Desarrollar siguiendo el estándar sin saltar dependencias ni mockear resultados críticos.
4. **Evidencia:** Adjuntar salida de ejecución reproducible que demuestre el criterio de aceptación.
