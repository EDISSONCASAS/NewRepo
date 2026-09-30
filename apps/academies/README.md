# Paddock · Gestión de academias

Aplicación web privada para administrar academias de automovilismo, alumnos y trámites. Es un servicio independiente del dashboard Hermes: usa su propia sesión, API y base de datos.

## Requisitos

- Node.js 24 o superior (`node:sqlite` forma parte del runtime).
- npm.

## Instalación local en Windows

Desde la raíz del repositorio, instala el workspace web y las dependencias de la API:

```powershell
npm install --workspace apps/academies
npm install --prefix apps/academies/backend
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
npm --workspace apps/academies run dev
```

Abre <http://127.0.0.1:5180>. Vite reenvía `/api` al backend local en `127.0.0.1:5181`. El backend no crea cuentas predeterminadas: el bootstrap anterior es obligatorio en una base vacía.

## Uso

- El administrador global crea academias y cuentas viewer; también puede cambiar las academias asignadas, reiniciar contraseñas y revocar/reactivar accesos.
- Los viewers solo consultan las academias asignadas. El servidor filtra los resultados y rechaza operaciones de escritura aunque se invoquen directamente por API.
- Los formularios incluyen fecha, orden, asesor, identificación, nombre, trámite, categoría, forma/estado de pago, costos médicos y observaciones.
- El importador acepta CSV y XLSX de hasta 5 MB. Selecciona primero la academia, revisa filas válidas/duplicadas/con errores y confirma la importación. Los duplicados no se sobrescriben.
- Se reconocen encabezados como `FECHA`, `NUMERO DE ORDEN`, `ASESOR`, `TIPO DE DOCUMENTO`, `NOMBRES COMPLETOS`, `NUMERO DE DOCUMENTO`, `TIPO DE TRAMITE`, `CATEGORIA`, `FORMA DE PAGO ALUMNO`, `ESTADO PAGO CRC`, `QPL`, `COSTO LAMINA`, `COSTO QPL`, `VALOR A CONSIGNAR`, `COSTO EXAM. MEDICO` y `OBSERVACION`. Las columnas no reconocidas se ignoran; las fórmulas XLSX no se importan.

El enlace compartido de Google Sheets es legible públicamente y contiene identificaciones e información financiera. No se importa automáticamente ni se precarga en esta aplicación. Antes de importar datos reales, el responsable debe quitar el acceso público a la hoja y usar un archivo autorizado y revisado, separado por academia.

## Verificación

```powershell
npm --workspace apps/academies run check
npm --workspace apps/academies run build
npm --prefix apps/academies/backend run build
npm --prefix apps/academies/backend test
npm audit --prefix apps/academies/backend --omit=dev
```

## Despliegue

El repositorio incluye un `Dockerfile` para empaquetar frontend y API bajo el mismo origen, y un `render.yaml` para Render. Desde Render, crea un Blueprint apuntando a este repositorio y confirma el servicio `paddock-academias`; requiere un plan con disco persistente (Starter o superior), que tiene costo. La base se guarda en `/var/data`, fuera de los archivos públicos.

Configura `INITIAL_ADMIN_USERNAME` y `INITIAL_ADMIN_PASSWORD` como secretos del servicio antes del primer despliegue. El primer arranque crea al administrador solo si la base está vacía; usa una contraseña de al menos 12 caracteres. Cuando `/api/health` responda correctamente, elimina ambos secretos del entorno de Render. No se crean cuentas predeterminadas y un reinicio no restablece contraseñas.

Render asigna `PORT` automáticamente. La aplicación escucha en `0.0.0.0`, usa HTTPS y marca la cookie de sesión como `Secure` en producción. Mantén el disco persistente y configura copias de seguridad protegidas antes de importar datos reales. No publiques la base ni las credenciales de bootstrap. La aplicación no sincroniza Google Sheets ni envía los datos a otros servicios.