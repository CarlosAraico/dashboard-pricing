# Dashboard Pricing (READ-ONLY)
Dashboard estático (sin backend). La UI carga datos derivados desde ./exports/derived_jan_may_2025_2026.json. Reglas: READ_ONLY_MODE=true, sin endpoints ni POST/PUT/DELETE, exporta solo vistas derivadas.

## Estructura
```
dashboard_pricing/
  index.html
  app.js
  server.ps1
  exports/derived_jan_may_2025_2026.json
```

## Ejecutar local (PowerShell)
Importante: no abrir index.html con doble click (file://).
```powershell
cd "RUTA\dashboard_pricing"
Set-ExecutionPolicy -Scope Process Bypass
./server.ps1 -Port 8000
```
Abrir http://localhost:8000

## Publicar en GitHub
UI: Source Control → Initialize Repository → Commit → Publish Branch (repo dashboard-pricing)
CLI:
```
git init
git add .
git commit -m "init dashboard pricing read-only"
git branch -M main
git remote add origin https://github.com/USER/dashboard-pricing.git
git push -u origin main
```

## Cloudflare Pages
- Create Pages → Connect to GitHub → repo
- Framework preset: None | Build command: (vacío) | Output directory: "/" (o subcarpeta si aplica) | Branch: main
- Custom domain recomendado: dashboard.TU_DOMINIO (Pages → Custom domains)

## Checklist prod
- GET /exports/derived_jan_may_2025_2026.json → 200
- app.js usa DATA_URL = "./exports/derived_jan_may_2025_2026.json"
- READ_ONLY_MODE = true
- Sin fetch POST/PUT/DELETE

## DEPLOY_CHECK.ps1
Valida archivos y flags antes de subir.
