# Puntual — Sprint 2: Tickets detallados (F1 Tenant Operativo + slice mínimo de E2.1) — v1

> **Fuente:** Backlog Puntual v5 ejecutable (§3 fases F1/F2, §10 sección de sprints) + Documento Técnico v4 + Guía de Arquitectura v1 + `Sprint1_Tickets_v2.md` (cierre de Sprint 1, Accepted el 2026-09-14, PR #2 mergeado a `develop`).
> **Alcance del sprint:** F1 completo (E1.1–E1.5) + slice mínimo de F0-B necesario para desbloquear E2.1 (E11.4 observabilidad mínima en base de datos, y E11.7a/b abstracción hexagonal `AiPort` con fallback multi-modelo) + E2.1 (Detección de intención + motivo cerrado + recomendación de doctores por especialidad).
> **Fuera de compromiso del sprint (pasan a Sprint 3+):** E11.2 (rate limiting), E11.6e (restore de staging probado), E11.7c–f (benchmark avanzado), y todo lo de F2 en adelante salvo E2.1 (E2.2 Hold de slots con locks en Redis, E2.3 Confirmación de cita, etc.).

---

## 0. Decisiones de Planning (Bloqueantes)

Estas decisiones se formalizan para ordenar la ejecución de Sprint 2:

| # | Decisión | Afecta a | Criterio de Resolución | Responsable | Resolución Acordada |
|---|---|---|---|---|---|
| **D3** | ¿Cómo secuenciar E2.1 respecto a F1 y F0-B? | E2.1, E1.5, E11.4, E11.7a/b | Minimizar bloqueo: E2.1 no necesita todo F0-B completo (rate limiting no bloquea clasificación de intención; benchmark de 4 proveedores tampoco bloquea mientras haya abstracción hexagonal con fallback de 2 proveedores). | Backend + PM | **Secuenciar en vertical slice:** Construir la base de F1 (E1.1 a E1.5), implementar el slice mínimo de F0-B (E11.4 logs/métricas y E11.7a/b `AiPort`), e implementar E2.1 (intención + motivo cerrado sin texto clínico libre por LOPDP) al final del sprint como walking skeleton conversacional. |
| **D4** | ¿Cómo repartir la carga de Backend en Sprint 2? | E1.1 a E1.5, E11.4, E11.7, E2.1 | La carga total de Backend es de 8 historias. Requiere mitigar el riesgo de commits monolíticos y asegurar que cada vertical slice mantenga Definition of Done y trazabilidad exacta con el Documento Técnico v4. | Backend Lead + PM | **Estrategia por rebanadas verticales acopladas:** Asignar trabajo con subagentes especializados (`backend_engineer`, `devops_engineer`, `qa_engineer`, `ai_prompt_engineer`), implementar primero contratos de datos y migraciones Prisma, seguido de servicios de dominio con ports/adapters, y verificar cada historia con suites E2E dedicadas antes de consolidación en PR. |

---

## 1. Definition of Done Transversal (aplica a todos los tickets)

1. Código integrado en la rama del sprint (`feat/sprint-2-tenant-operativo`).
2. Tests automatizados apropiados al riesgo (suites E2E dedicadas).
3. Tenant isolation probado cuando toca datos multi-tenant (verificación de `clinicId`).
4. Logs estructurados JSON y `traceId` propagado en interceptor global.
5. Manejo explícito de error/reintento cuando existe integración externa (Google Calendar, Meta, OpenAI/Gemini).
6. Migración Prisma incluida (`20260915015034_add_sprint2_f1_models`).
7. Staging validado (variables de entorno sin secretos hardcodeados en el repo).
8. Criterios de aceptación marcados uno por uno citando el RF/RNF correcto del Documento Técnico v4.
9. Cero secretos en repo ni en `.env` fuera de los valores permitidos (RNF-012).
10. Evidencia de prueba adjunta al PR para historias de alto riesgo.

---

## 2. Tickets del Sprint 2

### E1.1 — Alta de clínica y suscripción
- **Trazabilidad:** RF-014 (Alta del tenant por Super Admin), RF-020 (Plan de prueba gratuito sin pasarela), RNF-001 (Aislamiento).
- **Criterios de Aceptación:**
  1. Endpoint `POST /clinics` accesible solo por `SUPER_ADMIN`.
  2. Creación atómica en `$transaction` de `Clinic`, `Subscription` (`TRIAL` 15 días o comercial) y primer `CLINIC_ADMIN`.
  3. Plan `TRIAL` no invoca pasarela de pago.
  4. Consulta de clínica previene BOLA (un admin no puede ver datos de otra clínica).

### E1.2 — Admin inicial y autenticación JWT
- **Trazabilidad:** RF-026 (Autenticación dashboard, JWT + refresh, recuperación por correo), RNF-001 (Aislamiento).
- **Criterios de Aceptación:**
  1. Login mediante email y contraseña con `bcrypt` (cost 12).
  2. Access Token JWT (15 min) + Refresh Token rotativo en BD con detección y revocación de familia ante replay attack (`revokedAt`).
  3. Despacho real de correo de invitación al crear `CLINIC_ADMIN` mediante `EmailPort`.
  4. Despacho real de correo de recuperación de contraseña con token seguro de 1 hora mediante `EmailPort`.
  5. Guardias `JwtAuthGuard` y `RolesGuard` protegiendo endpoints según `UserRole`.

### E1.3 — Credenciales de canal y Channel Gateway
- **Trazabilidad:** RF-011 (Credenciales BYOC por clínica), RF-027 (Firma webhook por app_secret de clínica), RNF-003 (Cifrado AES-256-GCM), RNF-010 (Channel Gateway), RNF-012 (Gestión segura de claves).
- **Criterios de Aceptación:**
  1. Guardado de credenciales WhatsApp y Telegram cifradas en reposo con AES-256-GCM.
  2. Fallo explícito al inicio si `ENCRYPTION_KEY` falta o es menor a 32 caracteres (cero hardcodeos en código).
  3. `ChannelGatewayService` resuelve `phone_number_id -> clinicId` y `telegramToken -> clinicId` con caché Redis (300s).
  4. Invalidación de caché atómica con claves alineadas (`gateway:whatsapp:${id}:clinicId` y `gateway:telegram:${id}:clinicId`).
  5. Verificación de webhooks entrantes previa al procesamiento utilizando el `appSecret` específico de la clínica (RF-027).

### E1.4 — Google Calendar OAuth por Doctor
- **Trazabilidad:** RF-010 (Eventos write-only en Calendar), RF-011 (Credenciales de canal), RNF-010 (Channel Gateway).
- **Criterios de Aceptación:**
  1. Generación de URL OAuth 2.0 individual por doctor con scope de solo escritura (`calendar.events`).
  2. Método `verifyWritePermissions` para validar permisos reales de inserción y borrado.
  3. Refresco automático de tokens OAuth expirados sin interrumpir la operación.
  4. Fallo de conexión de Google Calendar no bloquea el onboarding ni la creación del doctor en la plataforma.

### E1.5 — Doctores, especialidades y horarios
- **Trazabilidad:** RF-016 (Doctores y especialidades N:M), RF-029 (Duración de slot jerárquica), RNF-001 (Aislamiento).
- **Criterios de Aceptación:**
  1. CRUD de especialidades y doctores por clínica con relación N:M (`DoctorSpecialty`).
  2. Horarios recurrentes semanales (días 0–6) validados en zona `America/Guayaquil` con `startTime < endTime`.
  3. Jerarquía de duración de slot resuelta correctamente: `Doctor > Specialty > Clinic default (30 min)`.

### E11.4 — Observabilidad mínima del MVP
- **Trazabilidad:** RNF-009 (Métricas de desempeño y observabilidad consultable), RF-004 (Métricas globales de Super Admin).
- **Criterios de Aceptación:**
  1. `StructuredLoggerService` produciendo logs JSON estándar con IDs contextuales (`traceId`, `requestId`, `clinicId`).
  2. Interceptor global `TraceIdInterceptor` midiendo latencia en milisegundos.
  3. Persistencia en base de datos en tabla `operational_logs`.
  4. Endpoint `GET /metrics/operational` protegido por rol y con aislamiento multi-tenant estricto.

### E11.7a/b — Abstracción Hexagonal de IA
- **Trazabilidad:** RNF-008 (Configurabilidad de modelo de IA sin redeploy de código).
- **Criterios de Aceptación:**
  1. Puerto `AiPort` desacoplado del framework.
  2. Adaptador `VercelAiAdapter` con soporte multi-modelo (`google/gemini-1.5-flash` -> `openai/gpt-4o-mini` -> fallback heurístico determinista).

### E2.1 — Intención, motivo cerrado y recomendación de doctor
- **Trazabilidad:** RF-017 (Sugerencia de doctores según motivo y especialidad), RNF-005 (Protección de datos de salud LOPDP sin texto clínico libre).
- **Criterios de Aceptación:**
  1. Detección de intenciones operativas y mapeo a motivos cerrados odontológicos.
  2. Recomendación de doctores habilitados en la clínica según la especialidad del motivo.
  3. Detección de mensajes ambiguos con pregunta de clarificación.
  4. Cero almacenamiento o log de texto libre clínico.
