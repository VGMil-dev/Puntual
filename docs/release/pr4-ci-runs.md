# Registro Consolidado de Ejecuciones CI en GitHub Actions — PR #4

**Repositorio:** `VGMil-dev/Puntual`  
**Rama:** `feat/sprint-3-walking-skeleton`  
**Workflow:** `CI / CD Staging Pipeline (E11.6b & E11.6c)` (`.github/workflows/ci-staging.yml`)  
**Fecha:** 2026-09-18  

---

## 1. Progresión Histórica de Runs en el PR #4

| Run | Database ID | Commit SHA | Disparador | Estado | Conclusión | Duración | Hito / Descripción |
|---|---|---|---|---|---|---|---|
| **#1** | `35381885302` | `e7f4a19` | Push fix YAML syntax | completed | **failure** | 82s | Primer run en instanciar runners tras fix YAML. Falló en Escenario 1 por `ECONNRESET`. |
| **#2** | `35396336923` | `839515e` | Push fix HTTP socket | completed | **success** | 141s | **Primer run verde en la historia del repositorio Puntual**. 8/8 concurrencia y 72/72 E2E verdes. |
| **#3** | `35396822456` | `bc15a09` | Push docs reporte CI | completed | **success** | 108s | Segundo run verde consecutivo. Estabilidad demostrada en CI sin variabilidad ni flakiness. |

---

## 2. Detalle de los Runs

### Run #1 (`35381885302`) — Causa del Fallo
- **Fecha:** 2026-09-18T18:43:58Z — 2026-09-18T18:45:20Z
- **Commit:** `e7f4a19` (*fix(ci): quote step name in ci-staging.yml and add PR #4 validation reports*)
- **Contexto:** Se corrigió el error sintáctico de YAML preexistente desde Sprint 1 (`Deploy to Staging VPS via SSH: (D1: VPS Propio)` sin comillas) que hacía fallar los runs en el segundo 0 sin crear jobs.
- **Resultado:** El runner ejecutó lint, build y migraciones exitosamente. Sin embargo, en el step de concurrencia se produjo un error `ECONNRESET` en el Escenario 1 (`20 Reqs Same Slot`). 
- **Causa raíz:** En `apps/api/test/concurrency-holds.e2e-spec.ts`, múltiples instancias efímeras de servidor HTTP abrieron y cerraron conexiones simultáneas compitiendo por sockets locales sin un listener persistente compartido, provocando el reseteo abrupto del socket TCP bajo carga en el entorno de GitHub Actions.

---

### Run #2 (`35396336923`) — Primer Run Verde del Repositorio
- **Fecha:** 2026-09-18T21:21:16Z — 2026-09-18T21:23:37Z (Duración: 141s)
- **Commit:** `839515e` (*fix(test): start HTTP server once in beforeAll to prevent ECONNRESET on CI*)
- **Fix aplicado:** Inicialización única y compartida del listener HTTP en `beforeAll` (`await app.init(); server = app.getHttpServer();`) y cierre coordinado en `afterAll`.
- **Jobs:**
  1. `Quality, Lint & Multi-Tenant Tests` (`105765911586`): **success** (101s)
  2. `Deploy to Staging (VPS + Migrations Job)` (`105766534329`): **skipped** (0s, solo aplica en merge a `develop`)

#### Aclaración Crítica de Métricas de Tests en Run #2:
Para evitar confusiones en auditoría, se distingue claramente entre los dos steps de prueba del workflow:
- **Step 11 — `Run Concurrency Hold Tests (RF-025, RNF-011, DoD §10)`**:
  - Suite: 1 suite (`concurrency-holds.e2e-spec.ts`).
  - Total tests: **8 tests (los 8 escenarios de concurrencia)** pasando al 100% (`Tests: 8 passed, 8 total`).
- **Step 12 — `Run E2E Test Suite (Health, Webhooks, Tenant Isolation)`**:
  - Suites: 7 suites E2E completas del proyecto (incluye `health.e2e-spec.ts`, `webhooks.e2e-spec.ts`, `tenant-isolation.e2e-spec.ts`, `walking-skeleton.e2e-spec.ts` y re-verificación de concurrencia).
  - Total tests: **72 tests pasando al 100%** (`Test Suites: 7 passed, 7 total`, `Tests: 72 passed, 72 total`).

#### Tabla de los 8 Escenarios de Concurrencia (Ejecutados y Verificados en CI):
| # | Escenario | Peticiones | Resultado | Comportamiento Verificado |
|---|---|---|---|---|
| 1 | 20 Reqs Same Slot | 20 simultáneas | **PASS** | 1 ganador (201), 19 rechazados (409 ConflictException) |
| 2 | 5 Reqs MaxHolds=3 | 5 simultáneas | **PASS** | 3 ganadores, 2 rechazados (409 MAX_HOLDS_EXCEEDED) |
| 3 | Hold Expiration Race | 3 peticiones | **PASS** | Hold expirado en Redis no permite confirmación |
| 4 | Idempotent Re-entry | 2 simultáneas | **PASS** | Sin duplicación de fila ni desbalance de contador |
| 5 | 20 Book Reqs Same Slot | 20 simultáneas | **PASS** | 1 cita persistida en Postgres, 19 conflictos |
| 6 | Postgres Compensation | 2 peticiones | **PASS** | Compensación libera hold en Redis ante fallo de BD |
| 7 | Idempotent Book Re-entry | 3 simultáneas | **PASS** | 1 creación, repeticiones retornan cita existente |
| 8 | Tenant Isolation in Book | 5 peticiones | **PASS** | Rechazo 403/404 ante cruce de `clinicId` |

---

### Run #3 (`35396822456`) — Confirmación de Estabilidad
- **Fecha:** 2026-09-18T21:27:01Z — 2026-09-18T21:28:49Z (Duración: 108s)
- **Commit:** `bc15a09` (*docs(release): add CI run #2 report (post ECONNRESET fix)*)
- **Jobs:**
  1. `Quality, Lint & Multi-Tenant Tests` (`105767463975`): **success** (96s)
  2. `Deploy to Staging (VPS + Migrations Job)` (`105767924659`): **skipped** (0s)
- **Conclusión:** Segunda ejecución verde consecutiva, demostrando cero flakiness y reproducibilidad completa del pipeline.
