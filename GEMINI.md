# AGENTS.md — Puntual (GAVANTI)

> Este archivo es la **constitución operativa** para cualquier agente de IA (Claude Code, Cursor, Codex, Copilot, etc.) que trabaje en este repositorio. No reemplaza al Documento Técnico, la Guía de Arquitectura ni el Backlog — los resume en reglas accionables y define **cómo debe comportarse un agente**, no solo qué debe construir.

**Documentos fuente (orden de precedencia ante conflicto):** todos viven en `docs/` en la raíz del repo. Un agente debe leerlos desde ahí, no asumir su contenido de memoria ni de este resumen.
1. `docs/Documento_Tecnico_Puntual_v4.md` — qué debe hacer el sistema (RF/RNF/CU), reglas de negocio y de dominio.
2. `docs/Guia_Arquitectura_Puntual_v1.md` — cómo debe estructurarse el código.
3. `docs/Backlog_Puntual_v5_Ejecutable_Sprint1_Actualizado.md` — en qué orden se construye y qué entra en el sprint actual.

> Si alguno de estos archivos no existe en `docs/` al momento de trabajar (renombrado, movido, o aún no versionado), el agente debe detenerse y preguntar antes de asumir contenido — no debe operar solo con el resumen de este `AGENTS.md`, que es una guía rápida, no la fuente de verdad.

Si un agente detecta una contradicción entre estos documentos (ya existe una pendiente conocida: el Backlog v5 referencia "Documento Técnico v6" mientras el disponible es v4), **debe detenerse y preguntar antes de asumir**, no resolver la ambigüedad por su cuenta.

---

## 0. Regla cero: no expandir alcance

Un agente **nunca** debe:
- Implementar un RF/CU/RNF que no esté en el documento técnico.
- Adelantar trabajo de una fase futura del backlog (ver §4) sin que se le pida explícitamente.
- Introducir una tecnología, librería o patrón que no esté en la tabla de decisiones de la Guía de Arquitectura (§2 de ese documento) sin justificarlo y preguntar primero.
- Inventar un endpoint, tabla o campo que no se derive de un caso de uso documentado.

Si algo "sería una buena idea" pero no está en el alcance, el agente lo **propone en texto**, no lo codifica.

---

## 1. Identidad del proyecto (resumen para no releer todo cada vez)

- **Producto:** agente conversacional (WhatsApp/Telegram) para agendamiento de citas odontológicas + dashboard multi-rol (Super Admin GAVANTI / Admin de Clínica / Doctor).
- **Modelo:** multi-tenant SaaS por suscripción mensual. Cada clínica = un tenant con sus propias credenciales de canal.
- **Stack fijo (no se cambia sin decisión explícita):** NestJS · Next.js · PostgreSQL · Prisma · Redis · Meta Cloud API (WhatsApp) · Telegraf (Telegram) · Google Calendar API (solo escritura) · Vercel AI SDK · Infisical · pnpm workspaces **sin Turbo**.
- **Zona horaria de todo el negocio:** `America/Guayaquil` (UTC-5, sin DST). Timestamps se guardan en UTC.
- **Regulación aplicable:** LOPDP Ecuador (datos de salud = dato sensible). GAVANTI es *encargado del tratamiento*, la clínica es *responsable*.

---

## 2. Reglas de negocio no negociables (Documento Técnico v4)

Un agente que toque estas áreas debe respetar literalmente estas reglas, citando el RF/CU correspondiente en el commit o PR:

- **Ciclo de vida de cita:** `Solicitada → Confirmada → Completada | Cancelada | No-show | Expirada`. Completada y No-show **solo** son alcanzables desde Confirmada. Solo Completada dispara encuesta (RF-009).
- **Hold de agendamiento (RF-025):** 15 minutos por defecto, lock distribuido en Redis, límite de holds concurrentes por doctor configurable (default 3). Una cita Solicitada **nunca** crea evento visible en Google Calendar.
- **Reconfirmación (RF-018/019):** ≥2 días de antelación → recordatorio a las 9:00 local, 2 días antes, ventana de 24h de respuesta. <1 día de antelación → confirmación explícita en ventana de 1 hora, si no llega pasa a Expirada (no a Cancelada).
- **No-show nocturno (RF-030):** transición automática a las 23:59 hora local para Confirmadas sin marcar.
- **Handoff (RF-023/CU-009):** al escalar, el bot deja de responder en el hilo. Estados: `Escalada → En atención humana → Resuelta → (opcional) Reactivada al bot`. El primer mensaje humano fuera de ventana de 24h usa plantilla `handoff`.
- **Plantillas Meta (RF-024):** tipos cerrados = `reconfirmacion`, `encuesta`, `aviso_pago`, `handoff`. Sin plantilla aprobada, la notificación no sale — se alerta, no se falla en silencio. Telegram no tiene esta restricción.
- **Google Calendar:** integración **unidireccional** (Puntual → Calendar). Nunca se implementan webhooks de Google para sync inversa.
- **Channel Gateway (RNF-010):** ningún módulo (agente IA, dashboard, casos de uso) llama directamente a Meta, Telegram o Google. Todo pasa por el Channel Gateway interno, que es el único que ve credenciales cifradas.
- **Verificación de webhooks (RF-027):** rechazo de cualquier webhook sin firma válida (`X-Hub-Signature-256` para Meta, secret token para Telegram) **antes** de encolar o procesar.
- **Idempotencia (RNF-011):** clave `tipo:clinicaId:entidadId:fechaEjecucion` para jobs programados; deduplicación por `message_id`/`event_id` en webhooks.
- **Multi-tenant (RNF-001):** aislamiento estricto por `clinicId`. Ninguna query sin filtro de tenant cuando el dato pertenece a una clínica.
- **Suscripción:** `Prueba → Pago pendiente → Activa/Suspendida`, plazo de gracia configurable (default 5 días). PayPhone es la pasarela del MVP; Kushki es evolución futura, no se implementa en Sprint 1 ni se necesita mientras la clínica esté en prueba.
- **Datos clínicos:** Puntual **no** almacena historia clínica ni diagnósticos, solo datos de agendamiento. Esto es una regla de diseño, no solo de negocio — ningún campo debe habilitar texto clínico libre.

---

## 3. Reglas de arquitectura no negociables (Guía v1)

- **Monolito modular** (no microservicios), **Hexagonal pragmática** (no hexagonal académica), **Vertical Slices** por caso de uso, **pnpm workspaces sin Turbo**.
- Flujo de dependencia obligatorio:
  `endpoint → controller → use case → domain → port → adapter → external system`
- El **dominio no conoce** NestJS, Prisma, Redis, Meta, Google ni el Vercel AI SDK. Si un agente escribe `import { PrismaClient }` dentro de `domain/` o `application/`, está violando la arquitectura.
- **Ports solo donde hay frontera real:** `ChannelPort`, `CalendarPort`, `AiPort`, `SecretStorePort`, `JobSchedulerPort` (opcional). No crear `LoggerPort`, `DateFormatterPort`, etc. "porque sí" (§10 de la Guía). Antes de crear una abstracción nueva, responder las 5 preguntas de la §34 de la Guía; si la respuesta es no a todas, no se crea.
- **Scheduler del MVP:** cron + tabla `scheduled_jobs` en Postgres. BullMQ **no** entra todavía.
- **Observabilidad del MVP:** logs estructurados JSON + métricas agregadas consultables. OpenObserve es fase 2.
- **Todo log/evento operativo debe propagar** los IDs disponibles: `traceId`, `requestId`, `clinicId`, `conversationId`, `patientId`, `appointmentId`, `jobId`.
- **Lo que NO se construye todavía** (Guía §33): microservicios, Kubernetes, Turbo, BullMQ sin necesidad, event bus genérico, CQRS completo, Event Sourcing, repositorios genéricos, plugins internos, observabilidad compleja, sync bidireccional con Google Calendar.
- Un agente que proponga cualquiera de estos ítems debe primero señalar que está fuera del alcance del MVP y pedir confirmación explícita.

---

## 4. Dónde estamos (Backlog v5 — no trabajar fuera de fase sin permiso)

Orden de fases: **F0 (fundación segura) → F1 (tenant operativo) → F2 (walking skeleton de agendamiento) → F3 (operación clínica) → F4 (handoff) → F5 (checklist piloto)**.

**Sprint 1 = F0-A únicamente.** Historias comprometidas:
- E11.6 — Staging separado (a–f)
- E11.5 — Infisical (solo deploy + integración inicial; rotación/restore quedan para después)
- E11.3 — Test de aislamiento multi-tenant
- E11.1 — Firma + idempotencia de webhooks

**Explícitamente fuera de Sprint 1:** E11.2 (rate limiting), E11.4 (observabilidad completa), E11.7c–f (benchmark LLM avanzado), y cualquier cosa de F1 en adelante (E1.x, E2.x...).

Un agente que reciba un ticket debe:
1. Confirmar que el ticket pertenece a la fase/sprint activo.
2. Si no lo pertenece, avisar y preguntar si se debe adelantar antes de tocar código.
3. Revisar la tabla de dependencias (Backlog §5) antes de empezar — no implementar algo cuya dependencia declarada no esté lista.

---

## 5. Política de uso de Skills (prioridad alta)

**Regla general: antes de escribir código o configuración para un ticket, el agente debe verificar si existe una skill relevante instalada o disponible en el catálogo del proyecto (`skills.sh` u otro registro configurado) y usarla en vez de reinventar el patrón desde cero.**

Orden de verificación por agente/ticket:

1. **¿Hay una skill ya instalada en este entorno que cubra esta tarea?** (buscar en el catálogo de skills disponible — `search_skills` / directorio local). Si existe, se usa. No se ignora una skill instalada solo por preferencia de estilo.
2. **¿Hay una skill recomendada para este rol/ticket en la tabla de abajo?** Si sí y no está instalada, el agente debe señalarlo explícitamente ("esta tarea tiene una skill recomendada sin instalar: X — ¿la agrego?") antes de escribir la solución manualmente.
3. Si no hay skill aplicable, se procede con el conocimiento del agente, pero se documenta en el PR que se buscó y no se encontró (para que quede trazable qué se resolvió "a mano").

### Mapa de skills recomendadas → agente/rol → ticket (Sprint 1)

| Rol / Agente | Ticket(s) | Skills recomendadas |
|---|---|---|
| DevOps / Full-stack | E11.6a–f (staging, CI/CD, migraciones, backups) | `docker-compose`, `docker-development`, `ci-cd`, `ci-cd-pipeline-patterns`, `github-actions-debugger` |
| Backend | E11.5b (SecretStorePort), E11.1 (webhooks) | `nestjs-best-practices`, `nestjs-expert`, `sent-webhook-engineer` (patrón firma/replay), `stripe-webhook-idempotency` (patrón dedup por event_id, transferible a `message_id`), `prisma-cli`, `prisma-client-api`, `prisma-database-setup` |
| QA / Tests | E11.3 (aislamiento multi-tenant) | `testing-api-for-broken-object-level-authorization`, `testing-for-broken-access-control`, `nestjs-testing-expert` |
| Infra / Secrets | E11.5a (Infisical) | `infisical-setup` (adapter `SecretStorePort`), `infisical-agent` (si se usa el daemon) |
| Frontend (preparación, fuera de compromiso) | Shell Next.js + auth | `nextjs-app-router-patterns` o `web-meta-framework-nextjs`, `vercel-react-best-practices` |
| IA / Prompt (preparación) | Spike abstracción LLM (E11.7a/b) | evaluar skills de abstracción de providers cuando se investiguen; no bloquea Sprint 1 |
| Redis (transversal) | Locks, TTL dedup, holds | `redis-development`, `redis-core`, `redis-security`, `redis-observability` |

> **Nota:** esta tabla se actualiza cada vez que se re-investiguen skills (ver §7, "Mantenimiento"). No es una lista cerrada — es el estado conocido a la fecha de la última revisión indicada en el pie del archivo.

**Excepción explícita conocida:** no hay skills de calidad identificadas para backup/restore de Postgres (E11.6d/e) ni para healthchecks/alertas genéricos (E11.6f). Estos tickets se resuelven con documentación directa (`pg_dump`/`pg_restore`, herramientas de healthcheck como Uptime Kuma) — un agente no debe forzar una skill irrelevante solo por cumplir la política.

---

## 6. Definition of Done (aplica a toda historia, sin excepción)

Copiado y vinculante desde el Backlog §7 — un agente no debe marcar una tarea como terminada si falta alguno de estos puntos:

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

---

## 7. Cómo debe comportarse el agente (meta-reglas)

- **Cita siempre la fuente:** cualquier decisión de diseño debe poder trazarse a un RF/RNF/CU del Documento Técnico o a una sección de la Guía de Arquitectura. Si no puede citarse, es una suposición y debe marcarse como tal.
- **Pregunta antes de asumir** cuando: (a) hay conflicto entre documentos, (b) el ticket no especifica un detalle necesario para implementar, (c) implementar requeriría salirse de la fase activa del backlog.
- **No optimiza prematuramente:** si la Guía dice "no crear X hasta que haya necesidad demostrada" (§33, §34), el agente no lo crea aunque le parezca "mejor práctica" en abstracto.
- **Mantenimiento de este archivo:** cuando el Documento Técnico, la Guía o el Backlog suban de versión (ya han tenido v1→v4, v1, v1→v5 respectivamente) dentro de `docs/`, este `AGENTS.md` debe revisarse y actualizarse en el mismo PR que actualiza esos documentos — no debe quedar desincronizado. Igual para la tabla de skills (§5): se revisa cuando se re-audite `skills.sh` u otro catálogo.

---

*Última actualización de este archivo: basado en Documento Técnico v4 (2026-09-14), Guía de Arquitectura v1.0, Backlog v5 Ejecutable Sprint1 Actualizado, y la investigación de skills reportada el 2026-09-13.*
