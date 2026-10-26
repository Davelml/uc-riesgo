/**
 * Motor de riesgo — Urban Capital, política v0.1 (borrador).
 *
 * Funciones puras, sin DOM ni red: sirven igual en el navegador (ES module)
 * y en el servidor (Node >= 18). Todas las cifras van en la moneda base.
 *
 * Modelo:
 *   R = realizado + λ·max(U,0) + min(U,0)        P&L reconocido
 *   H = max(0, H previo, R)                       máximo del período
 *   D = max(B, (1 − p)·H)                         devolución máxima
 *   F = H − D                                     piso
 *   Q = R − F                                     presupuesto restante
 *   L = Σ pérdida adicional hasta stops           riesgo comprometido
 *   A = Q − L                                     disponible
 *   u = (H − R + L) / D                           consumo
 */

export const ESTADOS = Object.freeze({
  NORMAL: "NORMAL",
  ADVERTENCIA: "ADVERTENCIA",
  RESTRICCION: "RESTRICCION",
  BLOQUEO: "BLOQUEO",
});

export const PARAMETROS_POR_DEFECTO = Object.freeze({
  B: 10,                 // presupuesto base del mes, en moneda base
  p: 0.70,               // fracción protegida del máximo
  lambda: 0.50,          // reconocimiento de ganancia no realizada
  alpha: 0.30,           // tope por trader, fracción de Q
  beta: 0.15,            // tope por operación nueva, fracción de Q
  grupo: 0.40,           // tope por grupo correlacionado y dirección, fracción de Q
  departamento: 0.60,    // tope por departamento, fracción de Q
  max_op_pct: 0.01,      // regla oficial: riesgo al stop <= 1% del capital del trader
  min_op_pct: 0.005,     // regla oficial: riesgo al stop >= 0,5% del capital del trader
  b_trader_pct: 0.04,    // presupuesto base propio del trader, fracción de su capital
  umbral_advertencia: 0.50,
  umbral_restriccion: 0.75,
  umbral_bloqueo: 0.90,
  max_datos_seg_restriccion: 60,
  max_datos_seg_bloqueo: 300,
});

export const GRUPOS_POR_DEFECTO = Object.freeze({
  XAUUSD: "Metales", XAGUSD: "Metales",
  SPOTBRENT: "Energía", NATGAS: "Energía",
  BTC: "Cripto", ETH: "Cripto", XRP: "Cripto", SOL: "Cripto", BNB: "Cripto", LINK: "Cripto",
});

const EPS = 1e-9;
const n = (x) => (Number.isFinite(+x) ? +x : 0);

/** Grupo de correlación de un instrumento. Acepta sufijos como BTCUSDT. */
export function grupoDe(instrumento, mapa = GRUPOS_POR_DEFECTO) {
  if (!instrumento) return null;
  const s = String(instrumento).toUpperCase();
  if (mapa[s]) return mapa[s];
  const clave = Object.keys(mapa).find((k) => s.startsWith(k));
  return clave ? mapa[clave] : null;
}

/**
 * Pérdida adicional si la posición sale en su stop, medida desde el precio actual
 * (o desde la entrada si es una orden pendiente).
 * Si la posición trae `perdida_hasta_stop`, se usa ese valor (modo manual).
 * Devuelve null si no hay stop: la posición queda marcada como incumplimiento.
 */
export function perdidaHastaStop(pos) {
  if (pos.perdida_hasta_stop != null) return Math.max(0, n(pos.perdida_hasta_stop));
  if (pos.stop == null) return null;
  const base = pos.pendiente ? n(pos.precio_entrada) : n(pos.precio_actual);
  const dir = pos.direccion === "Corto" ? -1 : 1;
  // distancia en contra hasta el stop; si el stop ya está en ganancia, no suma pérdida
  const distancia = Math.max(0, dir * (base - n(pos.stop)));
  const desliz = n(pos.deslizamiento);
  const mult = pos.multiplicador == null ? 1 : n(pos.multiplicador);
  return (distancia + desliz) * Math.abs(n(pos.cantidad)) * mult + n(pos.costo_salida);
}

/** P&L reconocido, máximo, piso y presupuesto para un P&L dado. */
export function presupuesto({ realizado = 0, no_realizado = 0, h_previo = 0 }, { B, p, lambda }) {
  const U = n(no_realizado);
  const R = n(realizado) + lambda * Math.max(U, 0) + Math.min(U, 0);
  const H = Math.max(0, n(h_previo), R);
  const D = Math.max(B, (1 - p) * H);
  const F = H - D;
  const Q = R - F;
  return { R, H, D, F, Q };
}

function sumar(lista, filtro) {
  return lista.filter(filtro).reduce((s, x) => s + (x.L ?? 0), 0);
}

/**
 * Evalúa el estado completo.
 * @param {object} data  { parametros, pnl, traders, posiciones, mapa_grupos?, datos_edad_seg? }
 */
export function evaluar(data) {
  const P = { ...PARAMETROS_POR_DEFECTO, ...(data.parametros || {}) };
  const mapa = { ...GRUPOS_POR_DEFECTO, ...(data.mapa_grupos || {}) };
  const traders = data.traders || [];
  const deptoDe = Object.fromEntries(traders.map((t) => [t.id, t.departamento]));

  const posiciones = (data.posiciones || []).map((x) => ({
    ...x,
    grupo: x.grupo || grupoDe(x.instrumento, mapa),
    departamento: deptoDe[x.trader_id] ?? null,
    L: perdidaHastaStop(x),
  }));

  const eq = presupuesto(data.pnl || {}, P);
  const L = posiciones.reduce((s, x) => s + (x.L ?? 0), 0);
  const A = eq.Q - L;
  const u = eq.D > 0 ? (eq.H - eq.R + L) / eq.D : 1;

  const topes = {
    trader: P.alpha * eq.Q,
    operacion: P.beta * eq.Q,
    grupo: P.grupo * eq.Q,
    departamento: P.departamento * eq.Q,
  };

  const incumplimientos = [];
  posiciones.forEach((x) => {
    if (x.L == null) incumplimientos.push({ tipo: "SIN_STOP", ref: x.id, trader_id: x.trader_id, detalle: `${x.instrumento} sin stop` });
    if (!x.grupo) incumplimientos.push({ tipo: "SIN_GRUPO", ref: x.id, trader_id: x.trader_id, detalle: `${x.instrumento} no está mapeado a un grupo` });
  });

  // por trader
  const filasTraders = traders.map((t) => {
    const Li = sumar(posiciones, (x) => x.trader_id === t.id);
    let Qi = null;
    if (t.pnl) {
      const propio = presupuesto(t.pnl, { ...P, B: P.b_trader_pct * n(t.capital) });
      Qi = propio.Q;
    }
    const tope = Qi == null ? topes.trader : Math.min(topes.trader, Qi);
    if (Li > tope + EPS) incumplimientos.push({ tipo: "TOPE_TRADER", ref: t.id, trader_id: t.id, detalle: `${t.nombre} excede su tope en ${redondear(Li - tope)}`, exceso: Li - tope });
    return { id: t.id, nombre: t.nombre, departamento: t.departamento, capital: n(t.capital), L: Li, tope, Q_propio: Qi };
  });

  // por grupo y dirección
  const claves = new Set(posiciones.filter((x) => x.grupo).map((x) => `${x.grupo}|${x.direccion}`));
  const grupos = [...claves].map((k) => {
    const [grupo, direccion] = k.split("|");
    const v = sumar(posiciones, (x) => x.grupo === grupo && x.direccion === direccion);
    if (v > topes.grupo + EPS) incumplimientos.push({ tipo: "TOPE_GRUPO", ref: k, detalle: `${grupo} ${direccion.toLowerCase()} excede su tope en ${redondear(v - topes.grupo)}`, exceso: v - topes.grupo });
    return { grupo, direccion, L: v, tope: topes.grupo };
  });

  const deptos = [...new Set(traders.map((t) => t.departamento))].map((d) => {
    const v = sumar(posiciones, (x) => x.departamento === d);
    if (v > topes.departamento + EPS) incumplimientos.push({ tipo: "TOPE_DEPARTAMENTO", ref: d, detalle: `${d} excede su tope en ${redondear(v - topes.departamento)}`, exceso: v - topes.departamento });
    return { departamento: d, L: v, tope: topes.departamento };
  });

  if (L > eq.Q + EPS) incumplimientos.push({ tipo: "TOPE_EQUIPO", ref: "equipo", detalle: `El riesgo hasta stops supera el presupuesto en ${redondear(L - eq.Q)}`, exceso: L - eq.Q });

  const edad = data.datos_edad_seg == null ? 0 : n(data.datos_edad_seg);
  let estado = ESTADOS.NORMAL;
  const motivos = [];
  if (eq.R <= eq.F + EPS) motivos.push("P&L en o bajo el piso");
  if (u >= P.umbral_bloqueo) motivos.push(`consumo ${Math.round(u * 100)}%`);
  if (edad > P.max_datos_seg_bloqueo) motivos.push(`datos con ${edad} s de atraso`);
  if (motivos.length) estado = ESTADOS.BLOQUEO;
  else if (u >= P.umbral_restriccion || incumplimientos.length || edad > P.max_datos_seg_restriccion) {
    estado = ESTADOS.RESTRICCION;
    if (u >= P.umbral_restriccion) motivos.push(`consumo ${Math.round(u * 100)}%`);
    if (incumplimientos.length) motivos.push(`${incumplimientos.length} incumplimiento(s)`);
    if (edad > P.max_datos_seg_restriccion) motivos.push(`datos con ${edad} s de atraso`);
  } else if (u >= P.umbral_advertencia) {
    estado = ESTADOS.ADVERTENCIA;
    motivos.push(`consumo ${Math.round(u * 100)}%`);
  }

  const bloqueaNuevo = estado === ESTADOS.RESTRICCION || estado === ESTADOS.BLOQUEO;

  // máximo de la próxima orden por trader (sin considerar el grupo, que depende de la orden)
  filasTraders.forEach((f) => {
    const m = maximoOrden({ P, eq: { ...eq, A }, topes, posiciones, trader: f });
    const conIncumplimiento = f.L > f.tope + EPS;
    f.maximo_orden = bloqueaNuevo || conIncumplimiento ? 0 : m.maximo;
    f.limita = bloqueaNuevo ? "estado del equipo" : conIncumplimiento ? "tope del trader" : m.limita;
    f.minimo_oficial = P.min_op_pct * f.capital;
    f.estado = conIncumplimiento ? "REDUCIR" : bloqueaNuevo ? "SIN_RIESGO_NUEVO" : f.maximo_orden < f.minimo_oficial ? "BAJO_MINIMO" : "PUEDE_OPERAR";
  });

  return {
    parametros: P,
    equipo: { ...eq, L, A, u, estado, motivos, topes },
    traders: filasTraders,
    grupos,
    departamentos: deptos,
    posiciones,
    incumplimientos,
  };
}

function maximoOrden({ P, eq, topes, posiciones, trader, grupo, direccion }) {
  const partes = {
    "operación": Math.min(topes.operacion, P.max_op_pct * trader.capital),
    "trader": trader.tope - sumar(posiciones, (x) => x.trader_id === trader.id),
    "departamento": topes.departamento - sumar(posiciones, (x) => x.departamento === trader.departamento),
    "equipo": eq.A,
  };
  if (grupo) partes["grupo"] = topes.grupo - sumar(posiciones, (x) => x.grupo === grupo && x.direccion === direccion);
  const limita = Object.keys(partes).reduce((a, b) => (partes[a] <= partes[b] ? a : b));
  return { maximo: Math.max(0, partes[limita]), limita, partes };
}

/**
 * Valida una orden nueva que aumenta riesgo.
 * orden: { trader_id, instrumento, direccion, stop?, perdida_hasta_stop? | precio_entrada, cantidad, ... , reduce_riesgo? }
 * Devuelve { resultado: "ACEPTAR" | "REDUCIR" | "RECHAZAR", motivo, maximo?, fraccion?, limita? }
 */
export function validarOrden(data, orden) {
  if (orden.reduce_riesgo) return { resultado: "ACEPTAR", motivo: "La orden reduce riesgo" };
  const ev = evaluar(data);
  const P = ev.parametros;
  const trader = ev.traders.find((t) => t.id === orden.trader_id);
  if (!trader) return { resultado: "RECHAZAR", motivo: "Trader desconocido" };
  const r = perdidaHastaStop({ ...orden, pendiente: true });
  if (r == null) return { resultado: "RECHAZAR", motivo: "Orden sin stop" };
  const grupo = orden.grupo || grupoDe(orden.instrumento, { ...GRUPOS_POR_DEFECTO, ...(data.mapa_grupos || {}) });
  if (!grupo) return { resultado: "RECHAZAR", motivo: "Instrumento no mapeado a un grupo" };
  if (ev.equipo.estado === ESTADOS.RESTRICCION || ev.equipo.estado === ESTADOS.BLOQUEO)
    return { resultado: "RECHAZAR", motivo: `Equipo en ${ev.equipo.estado.toLowerCase()}: solo se aceptan órdenes que reducen riesgo` };
  if (trader.L > trader.tope + EPS) return { resultado: "RECHAZAR", motivo: "El trader excede su tope; debe reducir antes de abrir" };

  const m = maximoOrden({ P, eq: ev.equipo, topes: ev.equipo.topes, posiciones: ev.posiciones, trader, grupo, direccion: orden.direccion });
  const minimo = P.min_op_pct * trader.capital;
  if (m.maximo < minimo - EPS)
    return { resultado: "RECHAZAR", motivo: `El máximo permitido (${redondear(m.maximo)}, limita ${m.limita}) queda bajo el mínimo oficial de ${redondear(minimo)}`, maximo: m.maximo, limita: m.limita };
  if (r > m.maximo + EPS)
    return { resultado: "REDUCIR", motivo: `Máximo ${redondear(m.maximo)} (limita ${m.limita})`, maximo: m.maximo, fraccion: m.maximo / r, limita: m.limita };
  if (r < minimo - EPS)
    return { resultado: "RECHAZAR", motivo: `Riesgo ${redondear(r)} bajo el mínimo oficial de ${redondear(minimo)}` };
  return { resultado: "ACEPTAR", motivo: `Quedan ${redondear(ev.equipo.A - r)} disponibles en el equipo`, maximo: m.maximo, limita: m.limita };
}

/** Mismo momento con distintas protecciones p (ej. [0.5, 0.7, 0.8]). */
export function compararProteccion(data, valores = [0.5, 0.7, 0.8]) {
  return valores.map((p) => {
    const ev = evaluar({ ...data, parametros: { ...(data.parametros || {}), p } });
    return { p, ...ev.equipo, incumplimientos: ev.incumplimientos.length };
  });
}

export function redondear(x, d = 2) {
  const f = 10 ** d;
  return Math.round(x * f) / f;
}
