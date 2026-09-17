# SPRINT 3 — Decisiones de Planning y Arquitectura (SPRINT3_DECISIONS.md)

> **Estatus:** Cerradas y vinculantes antes de mover el primer ticket a `In Progress`.  
> **Fecha:** 2026-09-17  
> **Rama:** `feat/sprint-3-walking-skeleton`

---

## 1. Decisiones Registradas

### Decisión D5 — Alcance Comprometido de Sprint 3
- **Contexto:** Evaluación de capacidad y prioridades del Backlog v5 tras el cierre y squash-merge de Sprint 2 (PR #3).
- **Resolución:** El alcance de Sprint 3 es estrictamente **F2 parcial: E2.2 (Disponibilidad + Hold atómico en Redis + Defensa en Postgres + Concurrencia) y E2.3 (Confirmación + Notificación + Google Calendar)**.
- **Exclusiones explícitas:**
  - E11.2 (Rate limiting por IP y teléfono): Permanece en backlog sin fecha comprometida.
  - E11.6e (Restore de staging probado): Permanece diferido en backlog sin fecha comprometida.
  - E2.4 (Notificación de cancelación/expiración al paciente) y E2.5 (Cancelación iniciada por paciente): Corresponden a Sprint 4.
  - E3.x / E4.x (Vista doctor, completar cita, encuesta, handoff): Corresponden a Sprint 4 y 5.
- **Justificación:** Enfocar 100% de la energía en el walking skeleton transaccional crítico (reserva y confirmación sin dobles reservas).

---

### Decisión D6 — Resolución de Brecha de Capacidad de Backend (~13 días vs ~10 días)
- **Contexto:** Las estimaciones preliminares de backend para E2.2 (a–c) + E2.3 totalizan ~13 días-hombre frente a un sprint objetivo de 10 días.
- **Resolución Acordada (Recomendación del Orquestador - Opción A con Reordenamiento):**
  1. **Descarga de Backend en Concurrencia:** `qa_concurrency_engineer` y `devops_ci_engineer` absorben **E2.2d por completo** (construcción de fixtures, scripts de carga concurrente con `Promise.all` / `autocannon`, e integración en `.github/workflows/ci-staging.yml`). Backend únicamente revisa los contratos. Esto libera 1.5 días de Backend.
  2. **Paralelización de E2.3:** E2.3 (`ConfirmAppointment`) arranca en paralelo con E2.2d en cuanto E2.2b y E2.2c alcancen estado `Staging`, sin esperar el cierre total de la suite de concurrencia.
  3. **Válvula de Contingencia (Day 5):** Si al quinto día de ejecución la ruta crítica de E2.2b o E2.2c sufre retrasos, E2.3 se reduce a un slice mínimo mergeado (contrato + tests unitarios desacoplados) y su integración completa se mueve a Sprint 4, cerrando Sprint 3 con E2.2 (a–d) validado en staging con evidencia irrefutable.
- **Justificación:** Permite cerrar el core de concurrencia y hold sin comprometer la calidad ni relajar el Definition of Done transversal.

---

### Decisión D7 — Modelos Nuevos y Tenant Boundary para Sprint 3
- **Contexto:** E2.2c y E2.3 requieren persistencia estructurada para conversaciones (`Conversation`) y control de trabajos en segundo plano (`ScheduledJob`).
- **Resolución:**
  - Se definen en `schema.prisma`:
    - `Conversation`: Con `clinicId`, `patientId`, `channelType`, `channelThreadId`, `status` (`ACTIVA`, `ESCALADA`, `RESUELTA`, `CERRADA`), `lastActivityAt`. Relación directa `onDelete: Cascade` con `Clinic`.
    - `ScheduledJob`: Con `clinicId`, `type`, `entityId`, `executionDate`, `status` (`PENDING`, `PROCESSING`, `COMPLETED`, `FAILED`), `idempotencyKey` (`tipo:clinicaId:entidadId:fechaEjecucion`), `attempts`, `payload`, `lastError`. Relación `onDelete: Cascade` con `Clinic`.
  - Ambos modelos se incorporan inmediatamente a `docs/models-with-clinic-id.md` y se añade su verificación obligatoria en `apps/api/test/tenant-isolation.e2e-spec.ts`.
- **Justificación:** Cumplimiento estricto de RNF-001 (Multi-tenant isolation) y Regla §4.1 del orquestador.

---

### Decisión D8 — Arquitectura de Hold en Dos Niveles (Redis + Postgres)
- **Contexto:** RF-025 exige atomicidad de agendamiento y límite configurable de holds concurrentes por doctor (default 3).
- **Resolución:**
  - **Nivel 1 (Velocidad y Sección Crítica):** Script atómico Lua en Redis que evalúa límite de doctor, adquiere lock del slot (`SET NX EX 900`) e incrementa contador en una sola operación sin ventanas de carrera.
  - **Nivel 2 (Persistencia y Defensa Inquebrantable):** Partial Exclusion Constraint en PostgreSQL usando `btree_gist`:
    ```sql
    EXCLUDE USING gist (
      doctor_id WITH =,
      tstzrange(start_at, end_at) WITH &&
    ) WHERE (status IN ('SOLICITADA', 'CONFIRMADA'));
    ```
  - **Expiración:** Mecanismo dual: verificación perezosa (`lazy`) en lecturas/confirmaciones + barrido periódico de citas `SOLICITADA` con `holdExpiresAt < NOW()` vía `scheduled_jobs`. Cero dependencia exclusiva de Redis Keyspace Notifications.
  - **Reconciliación:** En arranque del servicio backend, se sincronizan los contadores de Redis leyendo los holds no expirados de PostgreSQL.
- **Justificación:** Garantiza que incluso ante reinicio de Redis o bugs de red, ninguna doble reserva puede persistirse en base de datos.
