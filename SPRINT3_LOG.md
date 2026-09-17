# SPRINT 3 — Bitácora de Ejecución (SPRINT3_LOG.md)

> **Regla rectora:** Ningún ticket se marca como `Staging` o `Accepted` sin evidencia verificable (salida de suite, logs estructurados, capturas de prueba concurrente). "Pasó en mi máquina" no es aceptable.

---

## 1. Registro de Estados de Tickets

| Ticket | Subagente Asignado | Habilidades Declaradas | Evidencia | Timestamp | Estado |
|---|---|---|---|---|---|
| **E2.2a** (Cálculo disponibilidad) | `backend_availability_engineer` | `availability-calculation`, `timezone-handling`, `slot-duration-hierarchy` | 17 unit tests pasando (100% pass), suite completa 21/21 tests, build exitoso | 2026-09-17 09:31 | `Staging` |
| **E2.2b** (Lock Redis + Hold atómico) | `backend_redis_locking_engineer` | `redis-lua-atomicity`, `hold-lifecycle`, `reconciliation-after-restart` | 19 tests unitarios/concurrencia pasando (100% pass), suite completa 40/40 tests verdes, tenant linter 0 violaciones, build exitoso | 2026-09-17 09:41 | `Staging` |
| **E2.2c** (Defensa Postgres + Expiración) | `backend_postgres_defense_engineer` | `postgres-exclusion-constraints`, `prisma-migrations`, `scheduled-jobs`, `lazy-expiration` | Migración exclusion constraint btree_gist aplicada, modelos Conversation y ScheduledJob creados, ExpirationService (lazy check + scheduled sweeper) implementado, 12 tests unitarios pasando, suite completa 52/52 tests verdes, tenant linter 0 violaciones, build exitoso | 2026-09-17 09:55 | `Staging` |
| **E2.2d** (Pruebas de concurrencia real) | `qa_concurrency_engineer` (+ `devops_ci_engineer`) | `concurrency-testing`, `load-generation`, `evidence-capture`, `github-actions` | *Pendiente* | 2026-09-17 09:25 | `Ready` |
| **E2.3** (Confirmación + Calendar + Notificación) | `backend_confirmation_engineer` | `calendar-port-adapter`, `idempotency`, `partial-failure-handling`, `structured-logging` | *Pendiente* | 2026-09-17 09:25 | `Blocked (E2.2 completo)` |

---

## 2. Definiciones de Estados
- **`Ready`**: Requisitos claros, dependencias satisfechas, habilidades disponibles en `SPRINT3_SKILLS.md`.
- **`In Progress`**: Subagente instanciado con su mini-protocolo Skill-First declarado y verificado.
- **`In Review`**: Implementación concluida y tests ejecutados; en revisión por `reviewer_architect`.
- **`Staging`**: Validado localmente y en staging con suite automatizada.
- **`Accepted`**: Cumple los 10 puntos del DoD transversal con evidencia adjunta y trazabilidad de RF/RNF.

---

## 3. Registro de Eventos y Entregas
- **2026-09-17 09:25:00 UTC-5**: Inicio formal de Sprint 3. Rama `feat/sprint-3-walking-skeleton` creada. `SPRINT3_SKILLS.md` y `SPRINT3_DECISIONS.md` formalizados.
- **2026-09-17 09:31:00 UTC-5**: E2.2a completado por `backend_availability_engineer`. Módulo `availability` (`AvailabilityService`, `AvailabilityController`, DTOs y 17 tests unitarios) implementado con cálculo exacto en America/Guayaquil (UTC-5), jerarquía de duración y exclusión de solapamientos/holds. Suite total 21/21 tests verdes. Desbloquea E2.2b.
- **2026-09-17 09:41:00 UTC-5**: E2.2b completado por `backend_redis_locking_engineer`. Módulo `holds` (`HoldService`, `HoldController`, DTOs y 19 tests unitarios/concurrencia) implementado con scripts Lua atómicos (`ACQUIRE_HOLD_LUA`, `RELEASE_HOLD_LUA`), lock distribuido por slot (`hold:slot:clinicId:doctorId:startAtIso`), contador concurrente (`hold:count:clinicId:doctorId`), jerarquía de límite de holds (Doctor > Clinic > 3) y reconciliación en arranque `OnApplicationBootstrap`. Suite total 40/40 tests verdes, tenant linter 0 violaciones, build limpio. Desbloquea E2.2c y E2.2d.
- **2026-09-17 09:55:00 UTC-5**: E2.2c completado por `backend_postgres_defense_engineer`. Modelos `Conversation` y `ScheduledJob` creados en `schema.prisma` y documentados en `docs/models-with-clinic-id.md` (Regla §4.1). Migración `20260917095000_add_conversation_scheduled_job_and_exclusion_constraint` creada con extensión `btree_gist` y partial exclusion constraint `appointment_no_overlapping_active_slots`. Módulo `expiration` (`ExpirationModule`, `ExpirationService`) implementado con verificación perezosa (`checkAndExpireAppointment`), barrido periódico (`sweepExpiredHolds`) con registro idempotente en `ScheduledJob` (`expiracion_hold:${clinicId}:${appointmentId}:${dateStr}`) y reconciliación de contadores Redis. 12 tests unitarios pasando, suite completa 52/52 tests verdes, tenant linter 0 violaciones, build limpio. Desbloquea E2.2d.
