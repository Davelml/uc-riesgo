# uc-riesgo

Sección **Riesgo** del Backoffice de Urban Capital: calcula, con la política de riesgo v0.1 (borrador), cuánto más puede perder el equipo y cada trader antes del piso protegido, y valida órdenes nuevas.

```
src/risk-engine.js   Motor de cálculo. Funciones puras; corre en navegador y en Node >= 18.
src/riesgo-ui.js     Componente de la sección (sin framework). montarRiesgo(el, opciones).
src/riesgo.css       Estilos acotados a .ucr, con variables --uc-* para el tema.
riesgo.html          Demo independiente con datos de ejemplo.
data/ejemplo-estado.json   Contrato de datos con el ejemplo de la política (equipo en +50).
test/                Pruebas del motor con los casos de la política.
db/schema.sql        Tablas para parámetros, stops, máximo del mes e incumplimientos.
INTEGRACION.md       Guía para integrarlo al Backoffice.
```

## Probar en local

```bash
npm test          # 9 pruebas del motor
npm run dev       # abre http://localhost:8080/riesgo.html
```

`riesgo.html` necesita servirse por HTTP (usa ES modules y `fetch`); abrirlo con doble clic no funciona.

Todos los parámetros son ilustrativos hasta que se aprueben. Las reglas oficiales de Riesgo (21-10-2026) prevalecen.
