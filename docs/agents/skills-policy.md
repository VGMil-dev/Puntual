# Política de Skills — Puntual

## Ubicaciones canónicas

| Tipo de skill | Ubicación | Versionado |
|---|---|---|
| Skills genéricos del proyecto (nestjs, prisma, docker, ci-cd) | `.agents/skills/` (relativo al repo) | ✅ Sí (commiteado) |
| Skills personales con info sensible (servidor-ops, deploys, credenciales) | `~/.gemini/config/skills/` | ❌ No (nunca al repo) |
| Skills built-in de Antigravity | `~/.gemini/antigravity/builtin/skills/` | ❌ No tocar |

## Reglas estrictas

1. **NUNCA commitear skills con:**
   - IPs de servidores (públicas o privadas)
   - Hostnames internos
   - Usuarios SSH
   - Credenciales (passwords, API keys, tokens, JWT, secrets)
   - URLs internas o subdominios privados
   - Claves SSH, archivos `.pem`, `.key`, `.pfx`

2. **Si un skill necesita referenciar info del servidor:**
   - Usar placeholders genéricos: `<HOST>`, `<USER>`, `<CLINIC_ID>`
   - O referenciar variables de entorno: `${STAGING_HOST}`, `${SSH_USER}`
   - Nunca hardcodear valores reales en el skill

3. **Antes de añadir un skill nuevo a `.agents/skills/`:**
   - Verificar manualmente que no contiene IPs, hostnames, usuarios, credenciales
   - Ante duda: mover el skill a `~/.gemini/config/skills/` en lugar del repo
   - Los skills con info operativa **siempre** van a la ruta global, nunca al repo

4. **Red de seguridad recomendada:**
   - Configurar un pre-commit hook que corra `scripts/check-skills-patterns.ps1` (a crear fuera del repo)
   - Ese script verifica patrones sensibles contra una lista que NO está versionada
   - Si hay match, el commit se bloquea

## Por qué esta política

Puntual es un repositorio **público** en GitHub. Cualquier archivo commiteado es visible
para el mundo. Los skills genéricos (nestjs, prisma, docker) son útiles para el equipo y
no representan riesgo. Los skills operativos (como `servidor-ops`) contienen la topología
de infraestructura (IPs, hostnames, usuarios SSH, credenciales) y deben permanecer en la
ruta global de skills personales, fuera del control de versiones.
