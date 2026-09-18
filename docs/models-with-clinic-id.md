# Modelos con `clinicId` (Tenant Boundary) — Sprint 1 (E0.0 / E11.3)

> **Propósito:** Insumo vinculante para la suite de pruebas de aislamiento multi-tenant (E11.3, RNF-001). Todo modelo listado aquí DEBE estar cubierto por los tests automatizados que aseguran que ninguna consulta o mutación cruce datos entre clínicas.

## Entidad Raíz de Tenant
- **`Clinic`** (tabla `clinics`): Representa el tenant. Su clave primaria `id` es el identificador de aislamiento (`clinicId`).

## Entidades aisladas por `clinicId`

| Modelo Prisma | Tabla SQL | Campo de Tenant | Nullable | Relación / Comportamiento ante borrado | Cobertura en E11.3 |
|---|---|---|---|---|---|
| **`User`** | `users` | `clinicId` | Sí (solo para `SUPER_ADMIN` Milton/GAVANTI; obligatorio para `CLINIC_ADMIN` y `DOCTOR`) | `onDelete: Cascade` con `Clinic` | Obligatoria (acceso y consulta) |
| **`Doctor`** | `doctors` | `clinicId` | No (estricto) | `onDelete: Cascade` con `Clinic` | Obligatoria |
| **`Patient`** | `patients` | `clinicId` | No (estricto, clave única compuesta `[clinicId, phone]`) | `onDelete: Cascade` con `Clinic` | Obligatoria |
| **`Appointment`** | `appointments` | `clinicId` | No (estricto, indexado junto a `status` y `startAt`) | `onDelete: Cascade` con `Clinic` | Obligatoria (consultas de agenda, estados y holds) |
| **`Subscription`** | `subscriptions` | `clinicId` | No (estricto, unique) | `onDelete: Cascade` con `Clinic` | Obligatoria (suscripción y plan) |
| **`Specialty`** | `specialties` | `clinicId` | No (estricto, indexado junto a `name`) | `onDelete: Cascade` con `Clinic` | Obligatoria (catálogo de especialidades) |
| **`DoctorSchedule`** | `doctor_schedules` | `clinicId` | No (estricto, indexado junto a `doctorId`) | `onDelete: Cascade` con `Clinic` | Obligatoria (horarios de atención) |
| **`ChannelCredential`** | `channel_credentials` | `clinicId` | No (estricto, indexado junto a `channelType`) | `onDelete: Cascade` con `Clinic` | Obligatoria (credenciales de canales) |
| **`OperationalLog`** | `operational_logs` | `clinicId` | Sí (solo nulo en logs a nivel plataforma; obligatorio en flujos tenant) | `onDelete: SetNull` con `Clinic` | Obligatoria (trazabilidad y métricas) |
| **`Conversation`** | `conversations` | `clinicId` | No (estricto, clave única compuesta `[clinicId, channelType, channelThreadId]`) | `onDelete: Cascade` con `Clinic` | Obligatoria (hilos de mensajería omnicanal) |
| **`ScheduledJob`** | `scheduled_jobs` | `clinicId` | No (estricto, indexado junto a `status` y `type`) | `onDelete: Cascade` con `Clinic` | Obligatoria (trabajos en background e idempotencia) |

## Regla de evolución
Cada vez que se introduzca un nuevo modelo en `schema.prisma` durante fases posteriores (ej. `SurveyResponse`), este documento debe actualizarse y los tests de E11.3 deben extenderse para mantener el 100% de cobertura de aislamiento.
