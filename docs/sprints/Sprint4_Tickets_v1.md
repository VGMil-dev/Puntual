# Puntual — Sprint 4: Tickets detallados (F2 cierre + F3 inicio + deuda técnica) — v1

> **Fuente:** Backlog v5 §10 (Sprint 4), Documento Técnico v4, Guía de Arquitectura v1, cierre del Sprint 3 (PR #4).
> **Alcance:** E2.4 + E2.5 + E3.1 + E3.2 + E11.6g (deploy pendiente) + TD-01 (deuda técnica H2).
> **Fuera de compromiso:** E4, E5, E6, E7, E8, E9, E10 — Sprint 5+.

## 0. Decisiones de Planning (Bloqueantes)

| # | Decisión | Afecta a | Responsable | Resolución |
|---|---|---|---|---|
| D5 | ¿Provisionar VPS staging en Sprint 4 o delegar a DevOps externo? | E11.6g | DevOps + PM | [Pendiente] |
| D6 | ¿Incluir CONV-01 (conversation handler) en Sprint 4 o Sprint 5? | Sprint 5 critical path | PM | [Pendiente] |

## 1. Definition of Done Transversal

1. Código integrado (rama correspondiente, no solo local).
2. Tests automatizados apropiados al riesgo de la historia.
3. Tenant isolation probado cuando la historia toca datos multi-tenant.
4. Logs estructurados y `traceId` propagado cuando el flujo es operativo.
5. Manejo explícito de error/reintento cuando hay integración externa.
6. Migración Prisma incluida si cambia el esquema.
7. Staging validado (no solo `localhost`).
8. Criterios de aceptación del backlog marcados uno por uno, citando el RF/CU/RNF.
9. Cero secretos en el repo o en `.env` fuera de los valores permitidos.
10. Evidencia de prueba adjunta al PR en historias de alto riesgo (concurrencia, aislamiento tenant, webhooks).

## 2. Tickets del Sprint 4

### TD-01 — Deuda técnica: conversationId NOT NULL + remove fallback

- **Origen:** Anexo A §A.3 y Anexo B §B.1 del PR #4.
- **Trazabilidad:** RNF-001, RNF-011.
- **Tamaño:** S (1 día).
- **Rol:** Backend.
- **Dependencias:** Ninguna.
- **Riesgo:** Medio.

**Descripción:** Endurecer `Appointment.conversationId` a `NOT NULL` y eliminar el fallback `|| appt.id` en `HoldService.reconcileHoldsOnStartup`.

**Criterios de aceptación:**
1. Migración Prisma con backfill: asignar `id` de la cita como `conversationId` a registros legacy con `null`.
2. `HoldService.reconcileHoldsOnStartup` sin fallback: `const conversationId = appt.conversationId;`.
3. Test unitario que verifica rechazo cuando `conversationId === null`.
4. Suite E2E walking skeleton sigue pasando (5/5).
5. Suite E2E concurrency sigue pasando (8/8).

**Evidencia esperada:** migración aplicada + tests verdes + git commit.

### E2.4 — Expiración hold

- **Trazabilidad:** RF-025, CU-001 (Flujo Alterno), RNF-011.
- **Tamaño:** S (1 día).
- **Rol:** Backend.
- **Dependencias:** TD-01 (recomendado hacerlo primero).
- **Riesgo:** Medio.

**Descripción:** Proceso de expiración automática de holds vencidos. Barrido periódico + lazy check en lecturas.

**Criterios de aceptación:**
1. Job programado (`scheduled_jobs` tipo `expiracion_hold`) que barre holds vencidos cada N minutos.
2. Lazy check en `getAppointment` y `confirmAppointment` que marca como `EXPIRADA` si el hold venció.
3. Notificación al paciente vía canal cuando su hold expira (si hay conversationId).
4. Idempotencia del barrido con clave `expiracion_hold:${clinicId}:${appointmentId}:${date}`.
5. Tests unitarios + E2E.

### E2.5 — Cancelación de cita por paciente

- **Trazabilidad:** RF-001, RF-013, RF-025.
- **Tamaño:** M (2 días).
- **Rol:** Backend.
- **Dependencias:** E2.4 (lógica de expiración reutilizable).
- **Riesgo:** Medio.

**Descripción:** Use case `CancelAppointment`. El paciente puede cancelar una cita vía chat.

**Criterios de aceptación:**
1. Endpoint interno `POST /internal/appointments/cancel`.
2. Solo cancelable desde `SOLICITADA` o `CONFIRMADA`.
3. Libera hold en Redis si existía.
4. Elimina evento en Google Calendar si la cita estaba `CONFIRMADA` y tenía `googleCalendarEventId`.
5. Idempotencia: doble cancelación no falla, retorna estado final.
6. Tests unitarios + E2E.

### E3.1 — Vista doctor del día

- **Trazabilidad:** RF-007, CU-003.
- **Tamaño:** M (2-3 días).
- **Rol:** Backend + Frontend.
- **Dependencias:** E1.2 (auth JWT), E2.3 (citas confirmadas).
- **Riesgo:** Medio.

**Descripción:** Endpoint + vista dashboard que muestra al doctor sus citas del día actual (timezone America/Guayaquil).

**Criterios de aceptación:**
1. Endpoint `GET /appointments/today` protegido por rol `DOCTOR`.
2. Filtra por `doctorId` del usuario autenticado + `clinicId` del tenant.
3. Devuelve citas en estado `CONFIRMADA` ordenadas por `startAt`.
4. Página Next.js `/doctor/agenda` que consume el endpoint.
5. Tests E2E de aislamiento (doctor de clínica A no ve citas de clínica B).

### E3.2 — Completar cita

- **Trazabilidad:** RF-008, RF-009, CU-003, CU-010.
- **Tamaño:** M (2 días).
- **Rol:** Backend.
- **Dependencias:** E3.1.
- **Riesgo:** Medio.

**Descripción:** Use case `CompleteAppointment`. El doctor marca la cita como completada.

**Criterios de aceptación:**
1. Endpoint `PATCH /appointments/:id/complete` protegido por rol `DOCTOR`.
2. Solo completable desde `CONFIRMADA`.
3. Libera el slot en Google Calendar (elimina evento).
4. Dispara encuesta de satisfacción (job programado, no envío inmediato).
5. Idempotencia: doble complete no duplica encuesta.
6. Tests unitarios + E2E.

### E11.6g — Provisionar VPS staging + secrets + validar deploy end-to-end

- **Origen:** Deuda del Sprint 1 (E11.6b) que el CI roto ocultó. El job `deploy-staging` existe en el workflow pero nunca se ejecutó con éxito.
- **Trazabilidad:** DoD §7 (staging validado), RNF-004.
- **Tamaño:** M (2-3 días, dependiendo de si el VPS existe).
- **Rol:** DevOps.
- **Dependencias:** Ninguna.
- **Riesgo:** Alto (infraestructura).

**Descripción:** Provisionar el VPS de staging, configurar los secrets en GitHub, y validar que el job `deploy-staging` corre exitosamente end-to-end en un push real a `develop`.

**Criterios de aceptación:**
1. VPS Ubuntu provisionado con Docker + Docker Compose.
2. Clave SSH generada y configurada.
3. Secrets configurados en `Settings → Secrets → Actions` del repo:
   - `STAGING_HOST` (IP o hostname del VPS)
   - `STAGING_USER` (usuario SSH, ej. `deploy`)
   - `STAGING_SSH_KEY` (clave privada SSH)
   - `STAGING_DATABASE_URL` (connection string a Postgres de staging)
4. `docker-compose.staging.yml` funcional en el VPS.
5. Push a `develop` dispara el workflow y `deploy-staging` termina en `success`.
6. El endpoint `GET /health` del VPS responde 200.

**Evidencia esperada:** URL del run verde + screenshot/curl del `/health` + captura de `gh secret list` con los 4 secrets.

**Nota:** este ticket es prioritario para no arrastrar más deuda del Sprint 1.

### [OPCIONAL — decidir en planning] CONV-01 — Conversation handler

- **Origen:** Sin este componente, el bot no puede operar end-to-end con WhatsApp/Telegram real. Los use cases existen pero nadie los llama desde el canal.
- **Trazabilidad:** CU-001, RF-001, RNF-010, RNF-011.
- **Tamaño:** L (4-5 días) — dividir en subtickets si entra.
- **Rol:** Backend + IA.
- **Dependencias:** E2.1 (detección de intención), E1.3 (credenciales de canal), todos los use cases de citas.
- **Riesgo:** Muy alto.

**Descripción:** Orquestador conversacional que:
1. Recibe mensaje normalizado del webhook.
2. Consulta/actualiza estado de la conversación (`Conversation`).
3. Llama a `AiPort` para clasificar intención.
4. Despacha al use case correspondiente.
5. Envía respuesta al paciente vía `ChannelPort`.

**Criterios de aceptación:**
1. Endpoint `/internal/conversations/:id/messages` funcional.
2. Máquina de estados de conversación (IDLE → COLLECTING_MOTIVO → SUGGESTING_SLOT → AWAITING_CONFIRM → CONFIRMED).
3. Envío de mensajes salientes por WhatsApp/Telegram (adaptadores `ChannelPort`).
4. Manejo de errores y fallback a escalación (E5, fuera de scope).
5. Tests E2E con sandbox de Meta.

**Decisión:** [Incluir en Sprint 4 / Mover a Sprint 5] — decidir en planning.

## 3. Resumen del Sprint 4

| Orden | Ticket | Tamaño | Rol | Riesgo | Depende de | Estado |
|---|---|---|---|---|---|---|
| 1 | TD-01 | S | Backend | Medio | — | Backlog |
| 2 | E11.6g | M | DevOps | Alto | — | Backlog |
| 3 | E2.4 | S | Backend | Medio | TD-01 | Backlog |
| 4 | E2.5 | M | Backend | Medio | E2.4 | Backlog |
| 5 | E3.1 | M | Backend + Frontend | Medio | — | Backlog |
| 6 | E3.2 | M | Backend | Medio | E3.1 | Backlog |
| — | CONV-01 | L | Backend + IA | Muy alto | E2.1, E1.3 | Por decidir |

**Carga por rol:**
- Backend: TD-01(1) + E2.4(1) + E2.5(2) + E3.1(1) + E3.2(2) = 7 días
- Frontend: E3.1(2) = 2 días
- DevOps: E11.6g(2-3) = 2-3 días
- IA: (si CONV-01 entra) +2 días

## 4. Resultado esperado del sprint

Al cierre:
1. Deuda técnica H2 cerrada (`conversationId NOT NULL`).
2. VPS de staging operativo con primer deploy verde.
3. Ciclo de vida de cita completo: book → confirm → cancel → complete.
4. Dashboard mínimo para el doctor (vista del día + completar).
5. [Si CONV-01 entra] Bot funcional end-to-end con WhatsApp real.

## 5. Fuera del compromiso del sprint

- E4 (Encuestas), E5 (Handoff), E6 (Gestión manual), E7 (Reconfirmación/No-show), E8 (Plantillas Meta), E9 (Cobros), E10 (Dashboard Super Admin).
- Benchmark LLM (E11.7c-f).
- OpenObserve / OpenTelemetry.
