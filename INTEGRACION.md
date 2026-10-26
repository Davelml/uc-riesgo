# Integración al Backoffice — guía para Rafa

La integración tiene dos fases. La fase 1 deja la sección funcionando con datos cargados a mano o desde lo que el Backoffice ya tiene; la fase 2 la conecta a posiciones y stops en vivo.

## Fase 1 — sección Riesgo en el Backoffice

1. Copiar `src/risk-engine.js`, `src/riesgo-ui.js` y `src/riesgo.css` a los assets del Backoffice.
2. Crear la ruta `/riesgo` y el ítem **Riesgo** en el menú lateral, entre *Rendimiento* y *Movimientos de Capital*.
3. En esa vista, montar el componente:

   ```html
   <link rel="stylesheet" href="/assets/riesgo.css">
   <div id="uc-riesgo"></div>
   <script type="module">
     import { montarRiesgo } from "/assets/riesgo-ui.js";
     montarRiesgo(document.getElementById("uc-riesgo"), {
       endpoint: "/api/riesgo/estado",
       validarEndpoint: "/api/riesgo/validar-orden", // o null para validar en el navegador
       puedeEditar: USUARIO_ES_ADMIN_O_RIESGO,       // el servidor decide el rol, no el navegador
       refrescoSeg: 15,
     });
   </script>
   ```

   Si el Backoffice usa React, Vue u otro framework, se monta igual dentro de un `useEffect`/`onMounted` sobre un `div`, y se llama a `desmontar()` al salir de la vista.
4. Ajustar las variables `--uc-*` al inicio de `riesgo.css` a los colores y fuentes del tema.
5. Implementar `GET /api/riesgo/estado` (contrato abajo). Para partir puede devolver `data/ejemplo-estado.json` o armar el JSON con capital y P&L reales y posiciones con `perdida_hasta_stop` ingresada por Mexe.
6. Permisos: la ruta es visible para ADMIN y Riesgo. Un trader solo ve su propia fila (filtrar en el servidor, no en el navegador). Nadie edita parámetros desde esta pantalla: el panel de simulación no guarda nada.

## Contrato de datos — `GET /api/riesgo/estado`

Montos en la moneda base (USD). Porcentajes como fracción (0,70 = 70%).

```json
{
  "periodo": "2026-10",
  "actualizado": "2026-10-26T12:00:00-03:00",
  "datos_edad_seg": 5,
  "parametros": { "B": 10, "p": 0.70, "lambda": 0.50, "alpha": 0.30, "beta": 0.15,
                  "grupo": 0.40, "departamento": 0.60, "max_op_pct": 0.01, "min_op_pct": 0.005 },
  "pnl": { "realizado": 50, "no_realizado": 0, "h_previo": 50 },
  "traders": [ { "id": "T1", "nombre": "Trader 1", "departamento": "Commodities", "capital": 350,
                 "pnl": { "realizado": 12, "no_realizado": 0, "h_previo": 15 } } ],
  "posiciones": [
    { "id": "P1", "trader_id": "T1", "instrumento": "XAUUSD", "direccion": "Largo",
      "cantidad": 0.05, "multiplicador": 100, "precio_actual": 2400.5, "stop": 2394.5,
      "deslizamiento": 0.3, "costo_salida": 0.1, "pendiente": false }
  ],
  "mapa_grupos": { "XAUUSD": "Metales" }
}
```

| Campo | Origen | Nota |
| --- | --- | --- |
| `pnl.realizado` | Mismo cálculo que "PnL realizado" del Dashboard, pero **del mes en curso** y **sin aportes ni retiros** | El piso es mensual aunque el Dashboard filtre por trimestre |
| `pnl.no_realizado` | Suma del P&L abierto de todas las cuentas | Ganancias se reconocen al λ; pérdidas completas |
| `pnl.h_previo` | Tabla `riesgo_maximo_mes` | Máximo de P&L reconocido del mes; nunca baja dentro del mes |
| `traders[].capital` | Gestión de Capital Manual | E_i de cada cuenta |
| `traders[].pnl` | Opcional | Si viene, aplica también el presupuesto propio del trader (4% de su capital) |
| `posiciones[]` | cTrader: posiciones abiertas y órdenes pendientes de todas las cuentas | Sin `stop` → incumplimiento "sin stop" |
| `perdida_hasta_stop` | Opcional, modo manual | Si viene, reemplaza el cálculo por precios |
| `deslizamiento` | Por instrumento, en unidades de precio | Propuesta: 0,25 × ATR diario |
| `datos_edad_seg` | Segundos desde la última lectura de cTrader | > 60 s restricción; > 300 s bloqueo |

Cálculo de la pérdida hasta stop por posición: `(distancia en contra desde el precio actual —o la entrada si es pendiente— hasta el stop + deslizamiento) × |cantidad| × multiplicador + costo de salida`. Confirmar con el bróker el multiplicador de cada símbolo (tamaño de contrato).

## `POST /api/riesgo/validar-orden` (recomendado)

Cuerpo: `{ trader_id, instrumento, direccion, precio_entrada, stop, cantidad, multiplicador? }` o `{ ..., perdida_hasta_stop }`.

Respuesta: `{ resultado: "ACEPTAR" | "REDUCIR" | "RECHAZAR", motivo, maximo?, fraccion?, limita? }`.

En el servidor basta con:

```js
import { validarOrden } from "./risk-engine.js";
const estado = await armarEstado();          // la misma función que alimenta GET /estado
res.json(validarOrden(estado, req.body));
```

Validar en el servidor evita que el resultado dependa de lo que el navegador muestre. Este endpoint es el que después consultaría el cBot de cTrader o el panel que envíe órdenes.

## Fase 2 — datos en vivo

1. Crear las tablas de `db/schema.sql` (sintaxis MySQL; ajustar si usan otro motor).
2. Guardar el stop de cada posición y orden pendiente al leerlas desde cTrader. Las cerradas también, para el Score UC.
3. Un proceso cada minuto (o al cerrar cada operación) recalcula R y actualiza `riesgo_maximo_mes` si R supera el máximo guardado.
4. `GET /api/riesgo/estado` lee parámetros vigentes, máximo del mes, capital, P&L y posiciones, y devuelve el JSON.
5. Registrar cada incumplimiento en `riesgo_incumplimientos` con la misma clasificación del pilar Disciplina del Score UC, para no llevar dos registros.
6. Reemplazar el semáforo Normal / Atención / Crítico del Dashboard por los cuatro estados de `evaluar(...).equipo.estado`, y agregar una tarjeta resumen que enlace a `/riesgo`.
7. Cambiar el período: la sección Riesgo usa siempre el mes en curso, independiente del filtro Mensual / Trimestral / Anual.

## Qué queda fuera de esta versión

Pérdida bajo estrés por escenarios, topes diarios y semanales, apalancamiento y margen, y el rechazo automático en cTrader. Están en la política; se suman cuando existan los datos.

## Funciones del motor

| Función | Devuelve |
| --- | --- |
| `evaluar(estado)` | `{ equipo, traders, grupos, departamentos, posiciones, incumplimientos, parametros }` |
| `validarOrden(estado, orden)` | Veredicto de una orden nueva |
| `compararProteccion(estado, [0.5, 0.7, 0.8])` | El mismo momento con distintos p |
| `perdidaHastaStop(posicion)` | Pérdida adicional hasta el stop, o `null` si no hay stop |
| `presupuesto(pnl, parametros)` | `{ R, H, D, F, Q }` |
