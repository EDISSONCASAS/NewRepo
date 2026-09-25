# ⚡ Prisma TI — Sistema Freelance de Gestión & Facturación

Aplicación web cliente (*Single Page Application*) para profesionales independientes de tecnología y soporte técnico. Permite registrar horas/servicios por calendario, gestionar un catálogo de tarifas, ver métricas mensuales y emitir facturas/cuentas de cobro protegidas por cifrado de extremo a extremo.

## 🔒 Privacidad y Seguridad

* **Cifrado local AES-256-GCM:** Todos los datos registrados en el navegador se cifran localmente utilizando la Web Crypto API nativa mediante derivación de clave PBKDF2 (310.000 iteraciones con SHA-256).
* **Sin base de datos central:** Ningún dato viaja a servidores externos; todo permanece en tu navegador (`localStorage`).
* **Copias de seguridad portátiles:** Exporta e importa respaldos cifrados en archivos `.json` en cualquier momento.

## 🚀 Características principales

* 📅 **Calendario interactivo:** Agendamiento y registro diario de servicios con totales automáticos.
* 📊 **Métricas y Resumen:** Resumen mensual con conteo de servicios, ingresos totales y promedio diario.
* 📈 **Exportación a Excel:** Descarga de reportes detallados en formato `.xlsx` listos para contabilidad.
* 🛠️ **Catálogo de servicios:** Plantillas de servicios con tarifas base configurables.
* 🧾 **Emisor de facturas:** Cuenta de cobro con cálculo de IVA y Retención, impresión limpia a PDF y exportación en HTML independiente para clientes.

## 🌐 Despliegue en GitHub Pages

1. Sube este repositorio a tu cuenta de GitHub.
2. Dirígete a **Settings** > **Pages**.
3. En **Build and deployment**, selecciona:
   * **Source:** `Deploy from a branch`
   * **Branch:** `main` (o `master`) / `/ (root)`
4. Haz clic en **Save**. En un par de minutos tu aplicación estará online con HTTPS automático.

> ⚠️ **Importante:** La Web Crypto API requiere un contexto seguro (`https://` o `http://localhost`). No abras el archivo directamente haciendo doble clic (`file:///`).

## 🛠️ Ejecución Local

Si prefieres usarla de manera local y offline:

```bash
# Con Python:
python -m http.server 8080

# Luego abre: http://localhost:8080