# Puntual (GAVANTI)

> **Puntual** es una plataforma SaaS multi-tenant diseñada para el agendamiento automatizado de citas odontológicas mediante agentes conversacionales (WhatsApp con Meta Cloud API y Telegram) con dashboard multi-rol (Super Admin GAVANTI, Administrador de Clínica, Odontólogo).

---

## 🏛️ Arquitectura y Stack Tecnológico

El proyecto sigue una **arquitectura hexagonal pragmática** organizada como un monolito modular con **vertical slices** por caso de uso:

- **Backend:** NestJS (Node.js + TypeScript) en `apps/api`
- **Frontend Dashboard:** Next.js (App Router) en `apps/web` *(Fase 1)*
- **Base de Datos:** PostgreSQL con Prisma ORM
- **Caché y Locks:** Redis (idempotencia de webhooks, holds de agendamiento)
- **Gestión de Secretos:** Infisical Cloud con fallback local seguro (`SecretStorePort`)
- **Canales:** Meta Cloud API (WhatsApp) y Telegraf (Telegram) vía Channel Gateway
- **Monorepo:** `pnpm workspaces` (sin Turborepo)
- **Zona horaria de negocio:** `America/Guayaquil` (UTC-5)

---

## 📁 Estructura del Repositorio

```text
Puntual/
├── apps/
│   └── api/                  # Backend NestJS (Health, Webhooks, Integraciones)
├── prisma/                   # Esquema Prisma multi-tenant y migraciones SQL
├── scripts/                  # Utilidades de backup, alertas de salud y linters
├── docs/                     # Especificaciones, arquitectura y backlog del sistema
│   ├── Documento_Tecnico_Puntual_v4.md
│   ├── Guia_Arquitectura_Puntual_v1.md
│   ├── Backlog_Puntual_v5_Ejecutable_Sprint1_Actualizado.md
│   ├── Sprint1_Tickets_v2.md
│   ├── infisical-setup.md
│   └── models-with-clinic-id.md
├── docker-compose.yml        # Entorno de desarrollo local (Postgres 5434, Redis 6381)
├── docker-compose.staging.yml # Entorno de Staging aislado
├── .github/workflows/        # Pipelines de CI/CD para Staging
├── AGENTS.md                 # Constitución operativa para agentes de IA
└── GEMINI.md
```

---

## 🚀 Inicio Rápido (Desarrollo Local)

### 1. Prerrequisitos
- Node.js >= 20.x
- pnpm >= 10.x
- Docker y Docker Compose

### 2. Instalación de Dependencias
```bash
pnpm install
```

### 3. Levantar Infraestructura Local (PostgreSQL + Redis)
```bash
docker-compose up -d
```

### 4. Configurar Variables de Entorno
```bash
cp .env.example .env
```

### 5. Ejecutar Migraciones de Base de Datos
```bash
pnpm --filter api db:migrate
```

### 6. Iniciar Servidor de Desarrollo
```bash
pnpm --filter api start:dev
```
El API estará disponible en `http://localhost:3001` (Healthcheck en `http://localhost:3001/health`).

---

## 🧪 Pruebas Automatizadas

```bash
# Tests unitarios e integración (Infisical)
pnpm --filter api test

# Tests E2E (Health, Aislamiento Multi-Tenant, Webhooks HMAC Meta/Telegram)
pnpm --filter api test:e2e

# Verificación estática de frontera multi-tenant (clinicId)
pnpm check:tenants
```

---

## 🔒 Seguridad y Multi-Tenancy

- **Aislamiento Multi-Tenant:** Todas las tablas y consultas que almacenan datos pertenecientes a una clínica requieren obligatoriamente el campo `clinicId`.
- **Canales y Webhooks:** Verificación obligatoria de firma HMAC-SHA256 (`X-Hub-Signature-256`) en Meta WhatsApp y `secret_token` en Telegram antes de cualquier procesamiento.
- **Idempotencia:** Deduplicación distribuida con Redis TTL de 24 horas (`SET NX EX 86400`).
- **Cero Secretos:** Cero llaves o tokens en el código fuente. Gestión centralizada mediante Infisical.

---

## 📜 Licencia y Confidencialidad
Propiedad exclusiva de **GAVANTI**. Todos los derechos reservados.
