# Backlog Puntual — versión ejecutable para equipo de 5 personas

## Propósito

Esta versión no cambia el alcance funcional definido en el Backlog v5. Lo reorganiza para que el equipo pueda ejecutarlo con dependencias explícitas, tamaños relativos, Definition of Done y una frontera clara entre:

- **MVP técnico:** flujo end-to-end funcionando en staging.
- **MVP piloto:** todo lo necesario para meter tráfico real de una clínica.
- **Fase 2:** mejoras que no bloquean el piloto.

> Base: Backlog Puntual v5 + Documento Técnico + Decisiones Puntual v2. La clasificación de prioridad y esfuerzo aquí es una propuesta de ejecución; no sustituye los RF/CU/RNF originales.

---

## 1. Regla principal de ejecución

No trabajar por “épicas completas” de principio a fin. Trabajar por **rebanadas verticales**, dejando cada rebanada demostrable en staging.

Orden objetivo:

**Infraestructura segura → Tenant/Auth/Canales → Doctores/Calendar → Intent + disponibilidad → Hold → Confirmación → Vista Doctor → Completar → Encuesta → Handoff → Reconfirmación/No-show → Checklist piloto → Piloto real**

La razón es que E2 depende de E1.5 y de varias capacidades transversales de E11, mientras E3/E4 dependen de que E2 produzca citas y cambios de estado.

---

## 2. Definición de tamaños

| Tamaño | Regla práctica | Referencia |
|---|---|---|
| XS | 0.5 día | configuración/tests simples |
| S | 1 día | historia acotada |
| M | 2–3 días | integración o lógica relevante |
| L | 4–5 días | historia grande / integración multi-sistema |
| XL | >5 días | **dividir antes de sprint** |

> Para el equipo asumido de ~5 personas, una historia **XL no debería entrar al sprint tal cual**.

---

## 3. Fases de entrega

### F0 — Fundación segura
**Objetivo:** poder desplegar staging y operar con aislamiento, secretos y observabilidad mínima.

Historias principales:

| Orden | Historia | Tamaño | Dependencias | Salida |
|---|---|---:|---|---|
| 1 | E11.6 Staging separado | L | — | staging desplegable y aislado |
| 2 | E11.5 Infisical | L | E11.6 parcial | secretos centralizados |
| 3 | E11.3 Test aislamiento multi-tenant | M | E11.6 | CI protege tenant boundary |
| 4 | E11.1 Firma + idempotencia webhook | M | E11.5 | entrada de canales segura |
| 5 | E11.2 Rate limiting | M | E11.1 | protección de colas/endpoints |
| 6 | E11.4 Observabilidad mínima | L | E11.5, E11.6 | trazabilidad de E2 |
| 7 | E11.7 Benchmark LLM | L | E11.4, E11.5 | proveedores comparables |

**Definition of Done F0**

- CI ejecuta tests de aislamiento.
- staging usa DB/Redis/Infisical separados.
- backup + restore probado en staging.
- firma de webhook validada antes de lógica de negocio.
- logs incluyen tenant, conversación, latencia y proveedor LLM.
- healthcheck operativo.

---

### F1 — Tenant operativo
**Objetivo:** crear una clínica que pueda entrar a staging y quedar configurada sin intervención técnica continua.

| Orden | Historia | Tamaño | Dependencias | Salida |
|---|---|---:|---|---|
| 8 | E1.1 Alta clínica | S | F0 | tenant creado |
| 9 | E1.2 Admin inicial + auth | M | E1.1 | login recuperable |
| 10 | E1.3 Credenciales canales | L | E1.2, E11.5 | WhatsApp/Telegram configurables |
| 11 | E1.4 Calendar doctor | M | E1.2, E11.5 | OAuth individual |
| 12 | E1.5 Doctores/especialidades/horarios | L | E1.2 | datos suficientes para agendar |

**Gate F1:** una clínica de prueba puede existir, crear admin, crear doctor, conectar Calendar y quedar lista para probar E2.

---

### F2 — Walking Skeleton de agendamiento
**Objetivo:** una conversación real consigue un slot, lo retiene, lo confirma y crea la cita.

| Orden | Historia | Tamaño | Dependencias | Salida |
|---|---|---:|---|---|
| 13 | E2.1 Intent + motivo + especialidad | L | E1.5, E11.4, E11.7 | intención utilizable |
| 14 | E2.2 Disponibilidad + hold | L | E1.4, E1.5, E2.1 | slot protegido |
| 15 | E2.3 Confirmación + notificación | L | E2.2 | cita Confirmada |
| 16 | E2.4 Expiración hold | S | E2.2 | slot liberado |
| 17 | E2.5 Cancelación paciente | M | E2.3 | cancelación end-to-end |

**Gate F2:** desde WhatsApp/Telegram, un paciente puede llegar hasta una cita Confirmada sin intervención humana, y no existe doble reserva en pruebas concurrentes.

---

### F3 — Operación clínica mínima
**Objetivo:** la clínica puede ver y completar las citas generadas por el bot.

| Orden | Historia | Tamaño | Dependencias |
|---|---|---:|---|
| 18 | E3.1 Vista doctor del día | M | E2.3 |
| 19 | E3.2 Completar cita | M | E3.1, E2.3 |
| 20 | E4.1 Envío encuesta | M | E3.2 |
| 21 | E4.2 Registro respuesta | M | E4.1 |

**Gate F3:** flujo completo paciente → cita → doctor → completada → encuesta → métrica de satisfacción.

---

### F4 — Handoff y continuidad operativa
**Objetivo:** cuando el bot no puede resolver, una persona puede continuar la conversación.

| Orden | Historia | Tamaño | Dependencias |
|---|---|---:|---|
| 22 | E5 / CU-002 Escalación | M | E2.1, E11.4 |
| 23 | E5 / CU-009 Buzón + atención humana | L | escalación |
| 24 | E6 Gestión manual agenda | L | E3.1 + modelo de citas |

**Gate F4:** una conversación escalada no recibe respuestas del bot, el Admin la atiende desde dashboard y puede resolverla.

---

### F5 — Antes del piloto real
**Objetivo:** cerrar los comportamientos que hacen que una cita realmente llegue viva al día de atención.

| Orden | Historia / trabajo | Tamaño | Dependencias |
|---|---|---:|---|
| 25 | E8 Plantillas Meta | M | canales activos |
| 26 | E7 Reconfirmación | L | scheduler + E8 |
| 27 | E7 No-show | M | estados de cita + scheduler |
| 28 | E10 Dashboard mínimo Super Admin | L | E11.4 + E2/E3/E4 |
| 29 | Checklist operativo piloto | M | E8 + infraestructura |
| 30 | DPA / prerequisitos legales externos | externo | antes de primer cobro / según alcance |

**Gate piloto:** no se activa tráfico real hasta completar el checklist operativo y los prerequisitos externos definidos en el Documento Técnico.

---

## 4. Épicas que NO deben absorber al equipo en el MVP

### E9 — Suscripción y Cobros

Mantener fuera del walking skeleton porque el propio backlog define el piloto gratuito como viable sin pasarela de pago. Entraría cuando la primera clínica vaya a convertirse a pago.

**Orden recomendado:** modelo de suscripción → estados → PayPhone → webhooks/pago confirmado → suspensión → recordatorios.

### E10 — Dashboard Super Admin

No debe intentar ser un “observability platform”. Para MVP, entregar únicamente las métricas necesarias para operar:

- fallas;
- latencia p50/p95;
- resolución autónoma;
- citas;
- satisfacción;
- embudo hold → confirmada;
- costo y benchmark LLM.

OpenTelemetry/OpenObserve quedan fuera del walking skeleton, tal como ya está planteado.

### E11.7 — Benchmark LLM

Construir la capacidad de medición desde el inicio, pero **no bloquear la salida por haber elegido el proveedor definitivo**. El propio diseño prevé que la elección definitiva ocurra al cierre del piloto.

---

## 5. Dependencias críticas

| Capacidad | Depende de | Riesgo |
|---|---|---|
| Agendamiento | E1.5 + E1.4 + E11.x | Muy alto |
| Hold atómico | Redis + Postgres | Muy alto |
| WhatsApp real | Meta + plantillas + firma | Muy alto |
| Handoff | Channel Gateway + dashboard | Alto |
| Encuesta | cita Completada + scheduler + plantilla | Medio-Alto |
| Reconfirmación | scheduler + Meta templates | Alto |
| No-show nocturno | scheduler + timezone | Medio |
| Métricas | observabilidad desde E2 | Alto |
| Seguridad | Infisical + tenant isolation | Muy alto |

---

## 6. Historias que conviene dividir antes de sprint

### E11.5 — Infisical
Dividir en:

- E11.5a Deploy de Infisical.
- E11.5b Integración NestJS → Infisical.
- E11.5c Cifrado de credenciales en reposo.
- E11.5d Rotación de DEK + rollback.
- E11.5e Backup/restore de bóveda.

### E11.6 — Staging
Dividir en:

- E11.6a Docker Compose / aislamiento.
- E11.6b CI/CD staging.
- E11.6c Migraciones como job.
- E11.6d Backups.
- E11.6e Restore.
- E11.6f Healthchecks/alertas.

### E11.7 — Benchmark LLM
Dividir en:

- E11.7a Abstracción de provider.
- E11.7b Configuración por secreto.
- E11.7c Registro de `llm_requests`.
- E11.7d Endpoint comparativo.
- E11.7e Dashboard comparativo.
- E11.7f Dataset sintético de ~50 conversaciones.

### E2.2 — Hold
Dividir como mínimo en:

- cálculo de disponibilidad;
- lock/hold Redis;
- límite de holds por doctor;
- índice de defensa en Postgres;
- expiración;
- pruebas concurrentes.

---

## 7. Definition of Done transversal

Una historia no está “Done” solo porque funciona manualmente.

Debe cumplir:

1. Código integrado en `develop`.
2. Tests automatizados apropiados al riesgo.
3. Tenant isolation probado cuando toca datos multi-tenant.
4. Logs estructurados y `traceId` cuando el flujo sea operativo.
5. Manejo explícito de error/reintento cuando existe integración externa.
6. Migración Prisma incluida si cambia esquema.
7. Staging validado.
8. Criterios de aceptación del backlog marcados uno por uno.
9. Sin secretos en repo ni `.env` fuera de los valores permitidos.
10. Evidencia de prueba adjunta al PR para historias de alto riesgo.

---

## 8. Gates de negocio

### Gate 1 — “Ya tenemos producto técnico”

Debe pasar E1 + E2 + E3 + E4 + E11 mínima.

**Demostración:** un paciente agenda, un doctor ve la cita, la completa y el paciente recibe/contesta encuesta.

### Gate 2 — “Ya podemos probar con clínica real”

Debe pasar E5 + E7 + E8 + observabilidad operativa + checklist piloto.

### Gate 3 — “Ya podemos cobrar”

Gate adicional para E9 + DPA y requisitos contractuales correspondientes.

---

## 9. Métrica de éxito del MVP técnico

El criterio más útil no es “historias terminadas”, sino que el equipo pueda demostrar repetidamente este flujo:

**Mensaje paciente → intención → doctor → disponibilidad → hold → confirmación → Calendar/notificación → agenda doctor → completada → encuesta → métricas**

Debe poder ejecutarse en staging de forma repetible, incluyendo fallos controlados de proveedor y duplicación de webhook.

---

## 10. Recomendación final de orden de sprints

### Sprint 1 — F0-A (primera mitad)
**Objetivo:** cerrar la fundación mínima de infraestructura y seguridad sin sobrecargar el sprint.

| Rol | Foco principal | Historias |
|---|---|---|
| Backend | Integración base de plataforma | E11.5b + E11.1 |
| Full-stack / DevOps | Infraestructura y despliegue | E11.6a–f + E11.5a |
| Frontend | Esqueleto del dashboard | Shell Next.js + estructura inicial de auth |
| IA / Prompt | Preparación de proveedores | Spike de abstracción LLM + definición de interfaz para E11.7a/b |
| QA / PM | Estrategia de pruebas y fixtures | Casos de tenant isolation + plan de pruebas de F0 |

**Historias comprometidas:**
- **E11.6 — Staging separado**
- **E11.5 — Infisical**, limitado a deploy + integración inicial; rotación y restore pueden completarse después.
- **E11.3 — Test de aislamiento multi-tenant**
- **E11.1 — Firma + idempotencia de webhooks**

**Fuera del compromiso de Sprint 1:** E11.2 (rate limiting), E11.4 (observabilidad completa) y E11.7c–f (benchmark avanzado). Estas pasan a Sprint 2/F0-B.

**Resultado esperado:** staging aislado y desplegable, Infisical operativo, aislamiento tenant protegido por CI y entrada de webhooks validada/idempotente. Frontend, IA y QA dejan preparados los contratos y bases necesarias para continuar F0-B/F1 sin quedar ociosos.

### Sprint 2
Completar F1 + E2.1.

**Resultado:** clínica y doctores configurables + bot entiende intención/motivo.

### Sprint 3
E2.2 + E2.3.

**Resultado:** primera cita Confirmada end-to-end con protección de concurrencia.

### Sprint 4
E2.4 + E2.5 + E3.1 + E3.2.

**Resultado:** ciclo de vida de cita completo.

### Sprint 5
E4 + E5.

**Resultado:** satisfacción + primera versión funcional de handoff.

### Sprint 6
E5.2 + E6 + E8.

**Resultado:** operación humana y plantillas Meta.

### Sprint 7
E7 + E10 mínimo + checklist piloto.

**Resultado:** sistema listo para tráfico real controlado.

> Nota: las duraciones reales deben validarse con estimación del equipo. El orden es la propuesta; no se deben convertir estos “sprints” en fechas rígidas sin estimación.

---

## 11. Puntos de control antes de empezar a desarrollar

1. Alinear la referencia de versión del Documento Técnico: el Backlog v5 declara “Documento Técnico v6”, mientras el archivo de base disponible en esta revisión está identificado como v4.
2. Decidir si E11.5/E11.6/E11.7 se dividen antes de meterlas al sprint.
3. Convertir los gates anteriores en columnas o estados reales del tablero: `Backlog → Ready → In Progress → Review → Staging → Accepted`.
4. Mantener E9 fuera del MVP técnico salvo que aparezca una necesidad comercial concreta.

---

## Conclusión

El backlog v5 ya tiene el contenido correcto. La mejora necesaria no es agregar funcionalidades: es **hacer explícito qué bloquea qué, qué se entrega primero, qué puede esperar y qué significa Done**.

La regla operativa queda así:

> **No cerrar una épica; cerrar una rebanada vertical demostrable y segura.**
