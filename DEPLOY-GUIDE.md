# GHAGGA SaaS Deploy Guide

Seguí estos pasos en orden. Cuando termines, borrá este archivo.

---

## 1. Neon — Base de datos PostgreSQL

1. Andá a **https://console.neon.tech**
2. Creá un nuevo proyecto:
   - **Name**: `ghagga`
   - **Region**: `US East (Ohio)` (o la más cercana)
   - **Postgres version**: 17 (o la última)
3. En el dashboard del proyecto → **Connection Details**
4. Copiá el **Connection string** (el que dice `postgresql://...?sslmode=require`)
5. Guardalo, es tu `DATABASE_URL`

---

## 2. Inngest — Procesamiento async

1. Andá a **https://app.inngest.com**
2. Creá un workspace (o usá el que tenés)
3. Andá a **Manage → Keys** (o Settings → Keys)
4. Vas a ver dos keys:
   - **Event Key** → es tu `INNGEST_EVENT_KEY` (empieza con algo tipo `test_` o `prod_`)
   - **Signing Key** → es tu `INNGEST_SIGNING_KEY` (empieza con `signkey-...`)
5. Guardá ambas

---

## 3. GitHub App — Webhook receiver para SaaS

1. Andá a **https://github.com/settings/apps/new**
2. Completá:
   - **GitHub App name**: `GHAGGA Review` (o algo único)
   - **Homepage URL**: `https://jnzader.github.io/ghagga/`
   - **Webhook URL**: `https://TU-APP.onrender.com/webhook` (después lo actualizás con la URL real de Render)
   - **Webhook secret**: `4dc0ef681dff9b228b64185dc830d080f95565dc`
3. **Permissions** (Repository):
   - **Pull requests**: Read & write (para postear comentarios)
   - **Contents**: Read-only (para leer diffs)
   - **Metadata**: Read-only (obligatorio)
4. **Subscribe to events**:
   - ☑ Pull request
   - ☑ Installation
   - ☑ Installation repositories (si aparece como opción)
5. **Where can this GitHub App be installed?**: Any account
6. Click **Create GitHub App**
7. En la página de la App:
   - Copiá el **App ID** (número, arriba de todo) → es tu `GITHUB_APP_ID`
   - Bajá a **Private keys** → click **Generate a private key**
   - Se descarga un archivo `.pem` → es tu `GITHUB_PRIVATE_KEY`
8. El webhook secret ya lo tenés: `4dc0ef681dff9b228b64185dc830d080f95565dc`

---

## 4. Render — Deploy del server

1. Andá a **https://dashboard.render.com**
2. **New → Web Service**
3. Conectá el repo `JNZader/ghagga`
4. Configurá:
   - **Name**: `ghagga`
   - **Region**: `US East (Ohio)` (igual que Neon para baja latencia)
   - **Branch**: `main`
   - **Runtime**: `Docker`
   - **Dockerfile Path**: `apps/server/Dockerfile` (lo vamos a crear)
   - **Instance Type**: `Free`
5. **Environment Variables** → agregá todas:

| Key | Value |
|-----|-------|
| `DATABASE_URL` | El connection string de Neon |
| `ENCRYPTION_KEY` | `d9d02ac11351730ea3e1858053765758910cee0947bb14d9857a12e87ccb3df0` |
| `GITHUB_APP_ID` | El App ID del paso 3 |
| `GITHUB_PRIVATE_KEY` | El contenido del `.pem` (pegá todo, incluyendo BEGIN/END) |
| `GITHUB_WEBHOOK_SECRET` | `4dc0ef681dff9b228b64185dc830d080f95565dc` |
| `INNGEST_EVENT_KEY` | El event key del paso 2 |
| `INNGEST_SIGNING_KEY` | El signing key del paso 2 |
| `PORT` | `3000` |
| `NODE_ENV` | `production` |

6. Click **Create Web Service**
7. Esperá que buildee y deployee
8. Copiá la URL (algo como `https://ghagga.onrender.com`)
9. **Volvé a GitHub App settings** y actualizá el **Webhook URL** a: `https://ghagga.onrender.com/webhook`

---

## 5. Inngest — Conectar con el server

1. Volvé a **https://app.inngest.com**
2. Andá a **Apps** o **Syncs**
3. Agregá la URL de tu app: `https://ghagga.onrender.com/api/inngest`
4. Inngest va a detectar automáticamente la función `ghagga-review`

---

## 6. Verificar

1. Hacé `curl https://ghagga.onrender.com/health` → debería devolver `{"status":"ok"}`
2. Instalá la GitHub App en un repo de prueba
3. Abrí un PR → debería llegar el webhook, Inngest lo procesa, y aparece el review comment

---

## Resumen de credenciales

```env
DATABASE_URL=<de Neon, paso 1>
ENCRYPTION_KEY=d9d02ac11351730ea3e1858053765758910cee0947bb14d9857a12e87ccb3df0
GITHUB_APP_ID=<de GitHub, paso 3>
GITHUB_PRIVATE_KEY=<contenido del .pem, paso 3>
GITHUB_WEBHOOK_SECRET=4dc0ef681dff9b228b64185dc830d080f95565dc
INNGEST_EVENT_KEY=<de Inngest, paso 2>
INNGEST_SIGNING_KEY=<de Inngest, paso 2>
PORT=3000
NODE_ENV=production
```
