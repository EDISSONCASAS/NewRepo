# Paddock · Gestión de academias

Aplicación web privada para administrar academias de automovilismo, alumnos y trámites. Es un servicio independiente del dashboard Hermes: usa su propia sesión, API y base de datos.

## Requisitos

- Node.js 24 o superior (`node:sqlite` forma parte del runtime).
- npm.

## Instalación local en Windows

Desde la raíz del repositorio, instala el workspace web y las dependencias de la API:

```powershell
npm ci --prefix apps/academies
npm ci --prefix apps/academies/backend
```

Crea el primer administrador. La contraseña se pide como entrada segura y no se guarda en el repositorio:

```powershell
$env:INITIAL_ADMIN_USERNAME = Read-Host "Usuario administrador"
$securePassword = Read-Host "Contraseña de 12 caracteres o más" -AsSecureString
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
try {
  $env:INITIAL_ADMIN_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
  npm --prefix apps/academies/backend run create-admin
} finally {
  Remove-Item Env:INITIAL_ADMIN_USERNAME -ErrorAction SilentlyContinue
  Remove-Item Env:INITIAL_ADMIN_PASSWORD -ErrorAction SilentlyContinue
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
}
```

La base se crea por defecto en `apps/academies/backend/data/academies.sqlite`. Para cambiarla, define `ACADEMIES_DB_PATH` antes del bootstrap y usa exactamente la misma ruta al iniciar la API. También puedes definir `ACADEMIES_DATA_DIR` para elegir su carpeta.

Abre dos terminales en la raíz del repositorio:

```powershell
npm --prefix apps/academies/backend run dev
```

```powershell
npm --prefix apps/academies run dev
```

Abre <http://127.0.0.1:5180>. Vite reenvía `/api` al backend local en `127.0.0.1:5181`. El backend no crea cuentas predeterminadas: el bootstrap anterior es obligatorio en una base vacía.

## Uso

- El administrador global crea academias y cuentas viewer; también puede cambiar las academias asignadas, reiniciar contraseñas y revocar/reactivar accesos.
- Los viewers solo consultan las academias asignadas. El servidor filtra los resultados y rechaza operaciones de escritura aunque se invoquen directamente por API.
- Los formularios incluyen fecha, orden, asesor, identificación, nombre, trámite, categoría, forma/estado de pago, costos médicos y observaciones.
- El importador acepta CSV y XLSX de hasta 5 MB. Los XLSX se convierten a CSV en el navegador para no agotar el límite de CPU del plan gratuito; las fórmulas no se importan. Selecciona primero la academia, revisa filas válidas/duplicadas/con errores y confirma la importación. Los duplicados no se sobrescriben.
- Se reconocen encabezados como `FECHA`, `NUMERO DE ORDEN`, `ASESOR`, `TIPO DE DOCUMENTO`, `NOMBRES COMPLETOS`, `NUMERO DE DOCUMENTO`, `TIPO DE TRAMITE`, `CATEGORIA`, `FORMA DE PAGO ALUMNO`, `ESTADO PAGO CRC`, `QPL`, `COSTO LAMINA`, `COSTO QPL`, `VALOR A CONSIGNAR`, `COSTO EXAM. MEDICO` y `OBSERVACION`. Las columnas no reconocidas se ignoran; las fórmulas XLSX no se importan.

El enlace compartido de Google Sheets es legible públicamente y contiene identificaciones e información financiera. No se importa automáticamente ni se precarga en esta aplicación. Antes de importar datos reales, el responsable debe quitar el acceso público a la hoja y usar un archivo autorizado y revisado, separado por academia.

## Verificación

```powershell
npm --prefix apps/academies run check
npm --prefix apps/academies run build
npm --prefix apps/academies/backend run build
npm --prefix apps/academies/backend test
npm audit --prefix apps/academies/backend --omit=dev
```

## Despliegue gratuito en Cloudflare

El Worker sirve el frontend y la API bajo el mismo origen; D1 conserva usuarios, academias, sesiones y registros aunque el Worker se reinicie. La configuración está en `worker/wrangler.jsonc`. Necesitas una cuenta de Cloudflare y Wrangler autenticado (`npx wrangler login`). Desde la raíz del repositorio:

1. Instala dependencias y compila el frontend:

   ```powershell
   npm ci --prefix apps/academies
   npm ci --prefix apps/academies/worker
   npm --prefix apps/academies run build
   ```

2. Crea una base D1 y copia el identificador que Wrangler imprime:

   ```powershell
   Set-Location apps/academies/worker
   npx wrangler d1 create paddock-academias
   ```

   Sustituye `REPLACE_WITH_CLOUDFLARE_D1_DATABASE_ID` por ese identificador en `wrangler.jsonc`.

3. Aplica el esquema y configura las credenciales iniciales como secretos:

   ```powershell
   npx wrangler d1 migrations apply paddock-academias --remote
   ```

   El nombre debe tener entre 3 y 100 caracteres válidos. Para no gastar el límite de CPU gratuito en el servidor, el hash PBKDF2 se calcula en tu equipo y se pega a Wrangler por entrada estándar:

   ```powershell
   $env:PASSWORD_PEPPER = node scripts/generate-password-pepper.mjs
   try {
     $env:PASSWORD_PEPPER | npx wrangler secret put PASSWORD_PEPPER
   } finally {
     Remove-Item Env:PASSWORD_PEPPER -ErrorAction SilentlyContinue
   }
   npx wrangler secret put INITIAL_ADMIN_USERNAME
   $env:INITIAL_ADMIN_PASSWORD_HASH = node scripts/hash-admin-password.mjs
   try {
     $env:INITIAL_ADMIN_PASSWORD_HASH | npx wrangler secret put INITIAL_ADMIN_PASSWORD_HASH
   } finally {
     Remove-Item Env:INITIAL_ADMIN_PASSWORD_HASH -ErrorAction SilentlyContinue
   }
   ```

   El generador solicita la contraseña sin mostrarla; debe tener entre 12 y 256 bytes. Conserva una copia segura de `PASSWORD_PEPPER`: protege los hashes de la base y no se debe borrar ni regenerar después del bootstrap. El navegador deriva los hashes de contraseñas nuevas con PBKDF2; el Worker los protege con ese pepper antes de guardarlos.

4. Despliega:

   ```powershell
   npx wrangler deploy
   ```

   Wrangler mostrará la URL pública `*.workers.dev`. Entra, inicia sesión y confirma `/api/health`; después elimina los secretos de bootstrap:

   ```powershell
   npx wrangler secret delete INITIAL_ADMIN_USERNAME
   npx wrangler secret delete INITIAL_ADMIN_PASSWORD_HASH
   ```

El plan gratuito de Workers limita cada petición a 10 ms de CPU y 100.000 solicitudes diarias; por eso el navegador calcula las contraseñas y convierte XLSX a CSV antes de llamar a la API. D1 Free limita cada base a 500 MB. Consulta los [límites de Workers](https://developers.cloudflare.com/workers/platform/limits/) y [límites de D1](https://developers.cloudflare.com/d1/platform/limits/) vigentes antes de cargar datos. La importación admite hasta 400 registros por archivo y 5 MB. D1 es persistente, pero no sustituye copias de seguridad: exporta y protege respaldos antes de operar con información real. No guardes datos sensibles en Git ni expongas la base. La aplicación no sincroniza Google Sheets ni envía registros a otros servicios.

### Desarrollo y prueba del Worker

```powershell
Set-Location apps/academies/worker
npx wrangler d1 migrations apply paddock-academias --local
npm run dev
```

Para el primer acceso local, crea `worker/.dev.vars` con `INITIAL_ADMIN_USERNAME`, `INITIAL_ADMIN_PASSWORD_HASH` y `PASSWORD_PEPPER`. Genera los secretos localmente con `node scripts/hash-admin-password.mjs` y `node scripts/generate-password-pepper.mjs`; no publiques el archivo (está ignorado por Git). El frontend debe estar compilado en `apps/academies/dist` para probar la entrega de assets.

### Alternativa de pago: Render

El repositorio también mantiene un `Dockerfile` y `render.yaml`. Render requiere un plan con disco persistente para conservar SQLite; un plan gratuito con almacenamiento efímero no es adecuado para los datos de esta aplicación. Usa `INITIAL_ADMIN_USERNAME` y `INITIAL_ADMIN_PASSWORD` solo para el primer arranque, y elimínalos tras crear el administrador.