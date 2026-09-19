# generate-example-clinic

Carpeta para generar una clínica de prueba en la DB local con credenciales
de sandbox de Meta WhatsApp y opcionalmente Google Calendar.

## Uso

1. Copia el archivo de plantilla:
   ```bash
   cp .env.example .env
   ```

2. Rellena `.env` con:
   - `ENCRYPTION_KEY`: cópiala del `.env` raíz del repo (debe ser LA MISMA).
   - `META_SANDBOX_*`: obtenidas en https://developers.facebook.com/apps.
   - Opcionalmente `GOOGLE_TEST_*`.

3. Ejecuta el seed:
   ```bash
   pnpm --filter @puntual/generate-example-clinic seed
   ```

4. Verifica en Postgres:
   ```bash
   pnpm --filter @puntual/api exec prisma studio
   ```
   Y busca la clínica con id `test-clinic-sandbox`.

## ⚠️ Seguridad

- El archivo `.env` **nunca** debe commitearse. Está en `.gitignore`.
- El `ENCRYPTION_KEY` debe ser el mismo que usa la API. Si lo cambias aquí
  pero no en la API (o viceversa), los secretos cifrados en el seed no
  podrán descifrarse al vuelo.
- Los tokens de Meta sandbox caducan (24h si son temporales). Si expiran,
  el seed sigue siendo válido, pero el `ChannelPort` fallará al intentar
  enviar mensajes. Regenera el token y vuelve a correr el seed (es idempotente).

## Dónde viven las credenciales

| Tipo | Local | Staging/Production |
|---|---|---|
| Secretos de plataforma (`ENCRYPTION_KEY`, `DATABASE_URL`, `JWT_SECRET`) | `.env` raíz del monorepo | **Infisical** (proyecto `puntual`) |
| Credenciales de canal (Meta, Google, Telegram) | Este `.env` para el seed de prueba | **DB cifrada** (`channel_credentials`), insertadas por cada clínica desde el dashboard |

**Nunca commitees** valores reales en `.env.example`. Si necesitas compartir
configuración con otro dev, usa Infisical, no el repo.

### Obtener la `ENCRYPTION_KEY` local

1. Mira el `.env` raíz del monorepo (`d:\Puntual\.env`).
2. Copia el valor de `ENCRYPTION_KEY` a este `.env`.
3. Si no existe, pídesela al admin del proyecto (o genérala y avisa a todos
   los devs, porque debe ser idéntica en API y seed).

## Cómo obtener las credenciales de Meta

1. Ve a https://developers.facebook.com/apps
2. Crea o selecciona tu app → Agrega el producto "WhatsApp"
3. En "API Setup":
   - `Phone number ID` → `META_SANDBOX_PHONE_NUMBER_ID`
   - `Temporary access token` → `META_SANDBOX_ACCESS_TOKEN`
   - `WhatsApp Business Account ID` → `META_SANDBOX_BUSINESS_ACCOUNT_ID`
4. En "App Settings → Basic":
   - `App Secret` → `META_SANDBOX_APP_SECRET`
5. Inventa un `META_SANDBOX_VERIFY_TOKEN` (string aleatorio, lo usarás al
   configurar el webhook en Meta Developers).

## Cómo verificar que la clínica fue creada

```bash
pnpm --filter @puntual/api exec prisma studio
# Busca la tabla clinics, filtra por id = test-clinic-sandbox
```
