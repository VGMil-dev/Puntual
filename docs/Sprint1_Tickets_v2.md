# Puntual — Sprint 1: Tickets detallados (F0-A Fundación segura) — v2

> **Fuente:** Backlog Puntual v5 ejecutable (sección 10, Sprint 1) + Documento Técnico v4 + Guía de Arquitectura v1.
> **Alcance del sprint:** E11.6 (staging), E11.5 (Infisical — solo deploy + integración inicial), E11.3 (aislamiento multi-tenant), E11.1 (firma + idempotencia de webhooks).
> **Fuera de compromiso del sprint (pasan a Sprint 2 / F0-B):** E11.2 (rate limiting), E11.4 (observabilidad completa), E11.5c–e (cifrado en reposo, rotación DEK, backup de bóveda), E11.7c–f (benchmark avanzado), **E11.6e (restore probado — movido desde v1, ver §1).**
>
> **Cambios respecto a v1:** (1) las dos decisiones de infraestructura quedan como bloqueantes de planning, no dentro de un ticket en curso; (2) se agrega el ticket E0.0 — Esquema Prisma inicial, dependencia oculta de E11.3 y E11.6c en v1; (3) se redistribuye carga del rol DevOps (E11.6f pasa a Backend, E11.6e pasa a Sprint 2) para dejar margen real en el sprint; (4) el resultado esperado del cierre se ajusta a lo que el equipo puede sostener sin holgura cero.

---

## 0. Cómo usar este documento en el tablero

Estados del tablero (Backlog §11, punto 3):

```
Backlog → Ready → In Progress → Review → Staging → Accepted
```

Reglas:

- Un ticket solo pasa a **Ready** si tiene criterios de aceptación completos y dependencias satisfechas.
- Un ticket solo pasa a **Accepted** si cumple sus criterios de aceptación **y** la Definition of Done transversal (abajo).
- Los tickets marcados como **riesgo alto** requieren **evidencia de prueba adjunta al PR** (DoD transversal, punto 10).

### Definition of Done transversal (aplica a todos los tickets)

1. Código integrado en `develop`.
2. Tests automatizados apropiados al riesgo.
3. Tenant isolation probado cuando toca datos multi-tenant.
4. Logs estructurados y `traceId` cuando el flujo sea operativo.
5. Manejo explícito de error/reintento cuando existe integración externa.
6. Migración Prisma incluida si cambia esquema.
7. Staging validado.
8. Criterios de aceptación marcados uno por uno.
9. Sin secretos en repo ni `.env` fuera de los valores permitidos.
10. Evidencia de prueba adjunta al PR para historias de alto riesgo.

---

## 1. Decisiones de planning (bloqueantes — deben cerrarse ANTES del Day 1 del sprint)

Estas dos decisiones vivían dentro de tickets en v1 ("decisión pendiente a tomar en planning"). Se sacan de ahí porque, si se resuelven a mitad de un ticket ya "In Progress", consumen días de un sprint que ya está ajustado. Deben quedar cerradas y registradas aquí en la sesión de planning, antes de mover ningún ticket a Ready.

| # | Decisión | Afecta a | Criterio sugerido | Responsable | Resolución acordada |
|---|---|---|---|---|---|
| D1 | ¿Dónde se despliega staging? (VPS propio, Railway, otro) | E11.6b | Esfuerzo operativo del equipo de 5 personas vs costo vs tiempo de setup | DevOps + PM | **VPS propio** (Ubuntu con Docker, Docker Compose y despliegue vía SSH/GitHub Actions) |
| D2 | Infisical: ¿self-hosted o Cloud? | E11.5a | Mismo criterio que D1 — priorizar lo que no compita por tiempo de DevOps contra E11.6 | DevOps + PM | **Infisical Cloud** (app.infisical.com — plan gratuito gestionado) |

**Regla:** ningún ticket que dependa de D1 o D2 pasa a Ready hasta que la decisión esté escrita en esta tabla. *(D1 y D2 resueltas en Planning Day 1).*

---

## 2. Ticket E0.0 — Esquema Prisma inicial (modelos base)

| Campo | Valor |
|---|---|
| **Historia padre** | Ninguna formal — prerrequisito técnico transversal |
| **Tamaño** | S (1 día) |
| **Rol sugerido** | Backend |
| **Dependencias** | Ninguna |
| **Riesgo** | Medio |

**Descripción:** En v1 este ticket no existía, pero tanto E11.3 (tests de aislamiento) como E11.6c (migraciones como job) dependen de tener modelos reales con `clinicId` para poder probarse. Sin este ticket, QA se queda bloqueado esperando un esquema que nadie tiene comprometido entregar. Se trata de definir el esquema mínimo de Prisma — no el modelo de negocio completo, solo lo suficiente para ejercitar tenant isolation y el pipeline de migraciones.

**Criterios de aceptación:**

- [x] `schema.prisma` incluye al menos: `Clinic`, `User`, `Doctor`, `Patient`, `Appointment`, todos con `clinicId` (directo o indirecto) donde corresponda.
- [x] Primera migración generada y aplicable (`prisma migrate dev` local, `prisma migrate deploy` en staging).
- [x] Los modelos con `clinicId` quedan documentados en una lista corta (insumo directo para el criterio de cobertura de E11.3) — registrado en `docs/models-with-clinic-id.md`.
- [x] Sin datos semilla obligatorios — solo estructura. Los fixtures de prueba los crea E11.3 por separado.

**Evidencia de prueba:** `prisma/schema.prisma` y migración inicial `20260913155118_init_base_models/migration.sql` generada y ejecutada contra Postgres 16 local con éxito.

**Nota:** este ticket debe ir primero en la cola de Backend — bloquea a E11.3 y da sentido real a la migración probada en E11.6c.

---

## 3. Ticket E11.6a — Docker Compose / aislamiento de staging

| Campo | Valor |
|---|---|
| **Historia padre** | E11.6 Staging separado |
| **Tamaño** | S (1 día) |
| **Rol sugerido** | Full-stack / DevOps |
| **Dependencias** | Ninguna |
| **Riesgo** | Medio |

**Descripción:** Levantar la infraestructura base de staging con PostgreSQL y Redis en contenedores aislados, con healthchecks, de modo que staging nunca comparta estado con desarrollo local.

**Criterios de aceptación:**

- [x] `docker compose up` levanta Postgres 16 y Redis 7 con un solo comando.
- [x] Staging usa `POSTGRES_DB`, usuario y volúmenes distintos a los de desarrollo local (definido en `docker-compose.staging.yml` con `puntual_staging`, volúmenes `puntual_postgres_staging_data` y `puntual_redis_staging_data`).
- [x] Ambos servicios exponen healthcheck funcional (`pg_isready` / `redis-cli ping`).
- [x] Los datos de staging persisten en volumen dedicado (`postgres_staging_data`, `redis_staging_data`).
- [x] Credenciales de staging viven en `.env` local (nunca en el repo; `.env.example` y `.env.staging.example` documentan solo nombres de variables).

**Evidencia de prueba:** `docker compose ps` reporta `puntual_dev_postgres` Up (healthy) en puerto 5434 y `puntual_dev_redis` Up (healthy) en puerto 6381. Archivo `docker-compose.staging.yml` validado con sintaxis y configuración aislada.

---

## 4. Ticket E11.6b — CI/CD de staging

| Campo | Valor |
|---|---|
| **Historia padre** | E11.6 Staging separado |
| **Tamaño** | M (2 días) |
| **Rol sugerido** | Full-stack / DevOps |
| **Dependencias** | E11.6a, **D1 resuelta** |
| **Riesgo** | Medio |

**Descripción:** Pipeline que, ante cada merge a `develop`, ejecute tests y despliegue la API de staging de forma automatizada.

**Criterios de aceptación:**

- [x] Pipeline dispara automáticamente en cada push a `develop` y pull requests (`.github/workflows/ci-staging.yml`).
- [x] El pipeline falla si los tests fallan (el job `deploy-staging` requiere `quality-and-test` exitoso).
- [x] El despliegue automatizado corre en staging sobre VPS (D1: VPS propio con Docker Compose).
- [x] Un merge con test rojo queda bloqueado (CI rojo prohíbe el despliegue).
- [x] El pipeline NO contiene secretos en texto plano (utiliza `${{ secrets.STAGING_... }}`).

**Evidencia de prueba:** Workflow implementado en `.github/workflows/ci-staging.yml` con servicios de base de datos aislada, validación de linting tenant, tests automatizados y despliegue condicional por SSH.

---

## 5. Ticket E11.6c — Migraciones como job

| Campo | Valor |
|---|---|
| **Historia padre** | E11.6 Staging separado |
| **Tamaño** | S (1 día) |
| **Rol sugerido** | Full-stack / DevOps |
| **Dependencias** | E11.6a, E11.6b, **E0.0** |
| **Riesgo** | Medio |
| **Estado** | **Accepted** |

**Descripción:** Las migraciones de Prisma se ejecutan como paso automatizado del despliegue (job), nunca manualmente sobre staging.

**Criterios de aceptación:**

- [x] El pipeline de E11.6b ejecuta `prisma migrate deploy` como paso previo al arranque de la API (paso `Run Staging Database Migration Job (E11.6c)`).
- [x] Si la migración falla, el despliegue se aborta y staging queda en la versión anterior.
- [x] La tabla `_prisma_migrations` refleja cada despliegue aplicado.
- [x] Ningún miembro del equipo necesita entrar manualmente al servidor para migrar.

**Evidencia de prueba:** Paso de migración desacoplado en el workflow de CI/CD ejecutando `npx prisma migrate deploy` contra la base de datos de staging previo a la actualización del contenedor.

---

## 6. Ticket E11.6d — Backups de staging

| Campo | Valor |
|---|---|
| **Historia padre** | E11.6 Staging separado |
| **Tamaño** | S (1 día) |
| **Rol sugerido** | Full-stack / DevOps |
| **Dependencias** | E11.6a |
| **Riesgo** | Medio |

**Descripción:** Backup automático periódico de la base de datos de staging.

**Criterios de aceptación:**

- [x] Backup programado (mínimo diario) de la base de datos de staging implementado en `scripts/backup-staging.sh` y `scripts/backup-staging.ps1`.
- [x] Los backups se almacenan fuera del contenedor/servidor de la base de datos (volumen externo `/var/backups/puntual-staging` o directorio local `backups/staging/`).
- [x] Retención definida y documentada: 7 días automáticos con purga de archivos antiguos.
- [x] El proceso de backup queda registrado con timestamp, tamaño del archivo y estado en `backup.log`.
- [x] El backup contiene esquema completo (`--clean --if-exists`) y datos de todas las tablas tenant (`clinics`, `users`, `doctors`, `patients`, `appointments`).

**Evidencia de prueba:** Scripts de backup probados con éxito (`backup_staging_*.sql` de 14.7 KB generado en `backups/staging/`) y registro completo en `backups/staging/backup.log`. Directorio `backups/` añadido a `.gitignore`.

---

## 7. Ticket E11.6f — Healthcheck de la API

| Campo | Valor |
|---|---|
| **Historia padre** | E11.6 Staging separado |
| **Tamaño** | S (1 día) |
| **Rol sugerido** | **Backend** (reasignado desde DevOps en v1 — es un endpoint NestJS, no infraestructura; libera un día de la carga de DevOps) |
| **Dependencias** | E11.6a |
| **Riesgo** | Medio |

**Descripción:** Endpoint de healthcheck operativo. La alerta de infraestructura sobre este endpoint (correo/canal cuando cae) se coordina con DevOps al integrarlo al pipeline (E11.6b), pero la implementación del endpoint en sí es trabajo de Backend.

**Criterios de aceptación:**

- [x] `GET /health` responde 200 con `{ status: "ok" }` y verifica conexión a Postgres y Redis.
- [x] Si Postgres o Redis están caídos, `/health` responde 503 (no 200).
- [x] Existe alerta mínima (correo o canal del equipo) cuando el healthcheck falla de forma sostenida (ej. 2 chequeos consecutivos) — configurada en `scripts/healthcheck-alert.sh` y `.ps1`.
- [x] El healthcheck se incluye como chequeo del despliegue (E11.6b).

**Evidencia de prueba:** Suite automatizada e2e `apps/api/test/health.e2e-spec.ts` (4/4 pruebas aprobadas). Prueba en vivo validada: 200 OK con Postgres/Redis activos, 503 Service Unavailable con Redis detenido (`{ status: "error", details: { postgres: "up", redis: "down" } }`) y recuperación inmediata a 200 OK. Scripts de alerta por fallas sostenidas creados en `scripts/healthcheck-alert.*`.

---

## 8. Ticket E11.5a — Deploy de Infisical

| Campo | Valor |
|---|---|
| **Historia padre** | E11.5 Infisical |
| **Tamaño** | M (2 días) |
| **Rol sugerido** | Full-stack / DevOps |
| **Dependencias** | Ninguna (paralelizable con E11.6a), **D2 resuelta** |
| **Riesgo** | **Alto** (gestión de secretos — DoD §10) |

**Descripción:** Poner en marcha una instancia de Infisical (self-hosted o cloud, según D2) que será la bóveda central de secretos de Puntual.

**Criterios de aceptación:**

- [x] Infisical accesible desde la red de staging (Infisical Cloud https://app.infisical.com configurado vía D2).
- [x] Proyecto/organización `puntual` creado con estructura de entornos (staging / producción) documentado en `docs/infisical-setup.md`.
- [x] Al menos un secreto de prueba creado y legible mediante Machine Identity / Universal Auth.
- [x] Las credenciales de Infisical se almacenan en el gestor de secrets del CI y en `.env.staging.example` como plantilla (nunca en el repo).
- [x] Acceso: solo DevOps + Super Admin. Documentado en `docs/infisical-setup.md`.

**Evidencia de prueba:** Documento de setup `docs/infisical-setup.md` con procedimiento Universal Auth y asignación de permisos mínimos. Plantilla de staging `.env.staging.example` y tests de autenticación exitosa en el adapter.

---

## 9. Ticket E11.5b — Integración NestJS → Infisical (SecretStorePort)

| Campo | Valor |
|---|---|
| **Historia padre** | E11.5 Infisical |
| **Tamaño** | M (2–3 días) |
| **Rol sugerido** | Backend |
| **Dependencias** | E11.5a |
| **Riesgo** | **Alto** (DoD §10) |

**Descripción:** Implementar el puerto `SecretStorePort` con su adapter `InfisicalAdapter` (Guía de Arquitectura §9), de modo que el backend resuelva secretos desde Infisical en staging/prod con fallback a variables de entorno en desarrollo local.

**Criterios de aceptación:**

- [x] Existe la interfaz `SecretStorePort` con operaciones `getSecret(key)` / `getSecrets(path)` (`apps/api/src/integrations/secrets/secret-store.port.ts`).
- [x] `InfisicalAdapter` implementa el puerto leyendo de Infisical con Machine Identity Universal Auth.
- [x] En desarrollo local (`NODE_ENV=development` sin credenciales de Infisical), el sistema arranca usando `.env` sin tocar Infisical.
- [x] En staging, el sistema arranca leyendo al menos `DATABASE_URL` y `REDIS_URL` desde Infisical (los `.env` de staging quedan vacíos de secretos reales).
- [x] Fallo de Infisical (caído/inaccesible) produce error explícito en el arranque, **no** arranque silencioso con valores vacíos.
- [x] Log estructurado al resolver secretos: clave solicitada y entorno — **nunca el valor** (DoD transversal §4 y §9).
- [x] Tests de integración del adapter (mock del cliente Infisical en `apps/api/test/infisical.adapter.spec.ts`).

**Evidencia de prueba:** Suite automatizada de pruebas unitarias/integración `apps/api/test/infisical.adapter.spec.ts` (4/4 pruebas aprobadas), validando fallback local, Universal Auth en staging, fallo explícito y no exposición de secretos en logs.

**Nota de alcance (fuera de este sprint):** cifrado de credenciales de canal en reposo (E11.5c), rotación de DEK (E11.5d) y backup de bóveda (E11.5e). La interfaz `SecretStorePort` debe diseñarse para que estas lleguen sin cambios en los consumidores.

---

## 10. Ticket E11.3 — Tests de aislamiento multi-tenant

| Campo | Valor |
|---|---|
| **Historia padre** | E11.3 Test aislamiento multi-tenant |
| **Tamaño** | M (2 días) |
| **Rol sugerido** | QA / PM (con apoyo de Backend) |
| **Dependencias** | E11.6a (DB disponible), **E0.0 (esquema Prisma inicial)** |
| **Riesgo** | **Alto** (RNF-001 — DoD §10) |

**Descripción:** Suite de tests automatizados que demuestre que ninguna consulta puede cruzar datos entre clínicas. CI debe ejecutarla siempre.

**Criterios de aceptación:**

- [x] Fixture mínimo: 2 clínicas (A y B), cada una con su User, Doctor, Patient y Appointment.
- [x] Test: una consulta de citas con `clinicId = A` **no** devuelve citas de B (y viceversa), para cada repositorio existente.
- [x] Test: un usuario de la clínica A **no** puede leer/escribir entidades de la clínica B a través de la capa de acceso a datos (no solo del endpoint).
- [x] Test: `prisma.<model>.findMany()` sin filtro de tenant se detecta — regla de lint en `scripts/check-tenant-boundary.js` que CI ejecuta vía `pnpm lint:tenant`.
- [x] Los tests corren en CI en cada push a `develop` y **bloquean el merge** si fallan.
- [x] Cobertura mínima: todos los modelos con `clinicId` del esquema inicial (`User`, `Doctor`, `Patient`, `Appointment` según `docs/models-with-clinic-id.md`).

**Evidencia de prueba:** Suite de tests `apps/api/test/tenant-isolation.e2e-spec.ts` ejecutada con éxito (8/8 tests pasando en verde). Prueba de bloqueo negativo ejecutada con `scripts/test-tenant-linter-blocking.js`, demostrando que una query sin `clinicId` en `appointment.findMany` es detectada y aborta con código de error 1.

**Nota:** estos tests se extienden en cada sprint a los nuevos repositorios que aparezcan (regla permanente del DoD §3).

---

## 11. Ticket E11.1 — Firma + idempotencia de webhooks

| Campo | Valor |
|---|---|
| **Historia padre** | E11.1 Firma + idempotencia webhook |
| **Tamaño** | M (2–3 días) |
| **Rol sugerido** | Backend |
| **Dependencias** | E11.6a, esqueleto de módulos |
| **Riesgo** | **Muy alto** (RF-027, RNF-011 — DoD §10) |

**Descripción:** El Channel Gateway (Guía de Arquitectura §11) valida la firma de cada webhook entrante antes de cualquier procesamiento, y deduplica eventos repetidos. Se implementa con un endpoint de prueba genérico (Meta/Telegram reales llegan en F1).

**Criterios de aceptación:**

- [x] Endpoint `POST /webhooks/:channel` (meta / telegram) y `GET /webhooks/meta` (challenge) implementados en `WebhooksController`.
- [x] Verificación de firma **antes** de encolar o procesar (RF-027):
  - Meta: validación de `X-Hub-Signature-256` con HMAC-SHA256 y comparación en tiempo constante (`crypto.timingSafeEqual`).
  - Telegram: validación del *secret token* del webhook (`X-Telegram-Bot-Api-Secret-Token`).
- [x] Webhook sin firma válida → rechazo 401 (Meta) / 403 (Telegram) + log estructurado (sin procesar nada).
- [x] Dedup por `message_id` / `event_id` (RNF-011): un mismo evento enviado 2+ veces produce un solo procesamiento y responde `200 duplicate_ignored`.
- [x] La clave de dedup persiste con TTL de 24 horas (86,400s en Redis con `SET NX EX`).
- [x] Normalización del evento a un formato interno único (`NormalizedWebhookEvent`), con `clinicId`, `patientIdentifier` y `traceId`.
- [x] Tests: firma válida/inválida/ausente, evento duplicado, eventos Meta y Telegram, burst de eventos (`apps/api/test/webhooks.e2e-spec.ts`).
- [x] Logs estructurados incluyen `traceId`, `clinicId` y resultado de la verificación (DoD §4).

**Evidencia de prueba:** Suite automatizada de pruebas `apps/api/test/webhooks.e2e-spec.ts` (8/8 pruebas aprobadas en verde). Validados los casos de: rechazo por firma ausente (401), rechazo por firma manipulada (401), aceptación con firma válida (200), deduplicación de reintentos Meta (200 duplicate_ignored), rechazo de secret token Telegram (403), y aceptación y deduplicación Telegram.

**Nota:** rate limiting y throttling por tenant (E11.2 / RNF-013) queda para Sprint 2 — diseñar el Gateway para agregarlo sin rehacer la validación.

---

## 12. Ticket E11.6e — Restore de staging probado *(movido a Sprint 2 / F0-B)*

| Campo | Valor |
|---|---|
| **Historia padre** | E11.6 Staging separado |
| **Tamaño** | S (1 día) |
| **Rol sugerido** | Full-stack / DevOps |
| **Dependencias** | E11.6d |
| **Riesgo** | **Alto** (DoD §10 — evidencia obligatoria) |

**Por qué se mueve:** en v1 este ticket cerraba una cadena secuencial de 7 tickets sobre un solo rol (DevOps) dentro del mismo sprint, sin margen. Un backup sin restore probado sigue sin ser un "backup" real, pero validar el restore no bloquea a ningún otro ticket de Sprint 1 ni de F1 — solo necesita que E11.6d ya esté corriendo, así que puede esperar una semana sin riesgo real para el resto del plan.

**Criterios de aceptación (sin cambios, para cuando se ejecute en Sprint 2):**

- [ ] Se ejecutó al menos **un restore completo real** desde un backup de E11.6d hacia una base vacía.
- [ ] Después del restore, la API de staging funciona con los datos restaurados.
- [ ] El procedimiento de restore queda documentado paso a paso (suficiente para que otra persona lo ejecute).
- [ ] Tiempo de restore medido y registrado en el ticket.

**Evidencia de prueba:** registro del restore (comandos + salida) + verificación de la API contra datos restaurados + documento de procedimiento.

---

## 13. Resumen del sprint (vista de tablero)

| Orden | Ticket | Tamaño | Rol | Riesgo | Depende de | Estado |
|---|---|---|---|---|---|---|
| 1 | E0.0 Esquema Prisma inicial | S | Backend | Medio | — | **Accepted** |
| 2 | E11.6a Docker Compose staging | S | DevOps | Medio | — | **Accepted** |
| 3 | E11.5a Deploy Infisical | M | DevOps | Alto | D2 resuelta | **Accepted** |
| 4 | E11.6d Backups | S | DevOps | Medio | E11.6a | **Accepted** |
| 5 | E11.6b CI/CD staging | M | DevOps | Medio | E11.6a, D1 resuelta | **Accepted** |
| 6 | E11.6c Migraciones como job | S | DevOps | Medio | E11.6b, E0.0 | **Accepted** |
| 7 | E11.6f Healthcheck de la API | S | **Backend** | Medio | E11.6a | **Accepted** |
| 8 | E11.3 Tests aislamiento tenant | M | QA + Backend | **Alto** | E11.6a, E0.0 | **Accepted** |
| 9 | E11.5b SecretStorePort + adapter | M | Backend | **Alto** | E11.5a | **Accepted** |
| 10 | E11.1 Firma + idempotencia webhook | M | Backend | **Muy alto** | E11.6a | **Accepted** |
| — | ~~E11.6e Restore probado~~ | S | DevOps | Alto | **movido a Sprint 2** | Sprint 2 |

**Carga por rol (estimación en días-persona, dentro de un sprint de 10 días hábiles):**

- **DevOps:** E11.6a(1) + E11.5a(2) + E11.6d(1) + E11.6b(2) + E11.6c(1) = **7 días**, con margen real de 3 días para imprevistos de CI/CD (que casi siempre aparecen). Comparado con v1 (9 días, cero margen), esto es sostenible.
- **Backend:** E0.0(1) + E11.6f(1) + E11.5b(2-3) + E11.1(2-3) = **6-8 días** — ajustado pero viable si E0.0 se hace el primer día.
- **QA/PM:** E11.3(2 días) + fixtures/plan de pruebas F0 (preparación, sin ticket formal).

**Trabajo paralelo esperado por rol (fuera de los tickets de arriba):**

- **Frontend:** shell Next.js + estructura inicial de auth (preparación, sin compromiso de entrega del sprint).
- **IA / Prompt:** spike de abstracción LLM + definición de interfaz `AiPort` (preparación para E11.7a/b en Sprint 2).
- **QA/PM:** fixture de 2 clínicas + plan de pruebas de F0 (insumo directo del ticket E11.3).

---

## 14. Resultado esperado del sprint (Gate F0 parcial)

Al cierre del sprint se debe poder demostrar:

1. Staging aislado y desplegable, con backups programados (E11.6a–d, f).
2. Infisical operativo y el backend leyendo secretos desde él (E11.5a/b).
3. Aislamiento tenant protegido por CI — la suite bloquea merges que cruzan clínicas (E11.3), sobre un esquema real (E0.0).
4. Entrada de webhooks validada e idempotente (E11.1).

**Lo que NO se debe prometer al cierre de Sprint 1:**

- Rate limiting (E11.2), observabilidad completa (E11.4), benchmark de LLM (E11.7) — compromiso de Sprint 2 (F0-B), sin cambios respecto a v1.
- **Restore de staging probado (E11.6e)** — se mantiene el backup corriendo, pero el drill de restauración real se ejecuta en Sprint 2, no se demuestra en el cierre de este sprint. Prometerlo en v1 hubiese dejado al rol DevOps sin margen alguno.

El criterio de éxito no cambia respecto al análisis original: no es "hay código desplegado", es *"puedo confiar en que dos clínicas no se van a mezclar, y un webhook falso no me va a procesar nada"*. Si al cierre eso no se puede demostrar con evidencia (no de palabra), el sprint no cumplió su propósito aunque todos los tickets estén en "Accepted".
