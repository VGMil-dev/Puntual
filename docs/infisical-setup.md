# Infisical Cloud Setup & Configuration (E11.5a)

> **Decisión de Planning (D2):** Se utiliza **Infisical Cloud** (`https://app.infisical.com`) para evitar sobrecargar al rol DevOps con mantenimiento de infraestructura de bóveda durante el MVP.

## 1. Organización y Proyecto
- **Organización:** `GAVANTI`
- **Proyecto:** `puntual`
- **Entornos configurados:**
  - `development` (opcional — desarrollo local usa `.env` como fallback sin tocar la nube)
  - `staging` (utilizado por el VPS de staging)
  - `production` (preparado para producción)

## 2. Autenticación de Máquinas (Machine Identity — Universal Auth)
Siguiendo las mejores prácticas de seguridad de Infisical (los *service tokens* están obsoletos; se utiliza **Universal Auth**):

1. En el dashboard de Infisical (`Access Control` > `Machine Identities`):
   - Crear identidad: `puntual-staging-api`
   - Asignar rol: `Member` con permisos de solo lectura (`Viewer`) sobre el entorno `staging` en la ruta `/`.
2. Configurar método de autenticación:
   - Tipo: **Universal Auth**
   - Generar `Client ID` y `Client Secret`.
3. Guardar las credenciales en los Secrets del repositorio GitHub / VPS:
   - `INFISICAL_PROJECT_ID`: ID del proyecto en Infisical.
   - `INFISICAL_CLIENT_ID`: Client ID de la Machine Identity.
   - `INFISICAL_CLIENT_SECRET`: Client Secret de la Machine Identity.
   - `INFISICAL_ENVIRONMENT`: `staging`

## 3. Secretos gestionados en Staging
En la ruta `/` del entorno `staging` se configuran:
- `DATABASE_URL`: `postgresql://puntual_staging:<pass>@<host>:5433/puntual_staging?schema=public`
- `REDIS_URL`: `redis://:<pass>@<host>:6380`
- `PORT`: `3000`
- `NODE_ENV`: `staging`

## 4. Política de Acceso y Auditoría (DoD §4 y §9)
- **Acceso a la consola Cloud:** Exclusivo para Super Admin (Milton) y DevOps.
- **Auditoría de Logs:** `InfisicalAdapter` en el backend registra structured logs (`{ action: 'getSecret', key, environment }`) y **nunca** imprime los valores de los secretos en logs ni en consola.
