// Ejecutar con: node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluar, validarOrden, compararProteccion, perdidaHastaStop, presupuesto, ESTADOS } from "../src/risk-engine.js";

const base = JSON.parse(readFileSync(new URL("../data/ejemplo-estado.json", import.meta.url)));
const conP = (p) => ({ ...base, parametros: { ...base.parametros, p } });
const cerca = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≠ ${b}`);

test("equipo en +50 con p = 70%: piso 35, presupuesto 15, disponible 6,5, advertencia", () => {
  const { equipo } = evaluar(base);
  cerca(equipo.D, 15); cerca(equipo.F, 35); cerca(equipo.Q, 15); cerca(equipo.L, 8.5); cerca(equipo.A, 6.5);
  assert.equal(equipo.estado, ESTADOS.ADVERTENCIA);
});

test("comparación 50/70/80 coincide con la tabla de la política", () => {
  const [a, b, c] = compararProteccion(base);
  cerca(a.F, 25); cerca(a.A, 16.5); assert.equal(a.estado, ESTADOS.NORMAL);
  cerca(b.F, 35); cerca(b.A, 6.5);
  cerca(c.F, 40); cerca(c.A, 1.5); assert.equal(c.estado, ESTADOS.RESTRICCION);
  assert.equal(c.incumplimientos, 2); // T3 y metales largo
});

test("orden de T4 en ETH con riesgo 3: aceptada con p=50, reducida al 75% con p=70, rechazada con p=80", () => {
  const orden = { trader_id: "T4", instrumento: "ETH", direccion: "Largo", perdida_hasta_stop: 3 };
  assert.equal(validarOrden(conP(0.5), orden).resultado, "ACEPTAR");
  const r = validarOrden(conP(0.7), orden);
  assert.equal(r.resultado, "REDUCIR"); cerca(r.maximo, 2.25); cerca(r.fraccion, 0.75);
  assert.equal(validarOrden(conP(0.8), orden).resultado, "RECHAZAR");
});

test("T1 no puede sumar 6 en oro con p=70: queda bajo el mínimo oficial", () => {
  const r = validarOrden(base, { trader_id: "T1", instrumento: "XAUUSD", direccion: "Largo", perdida_hasta_stop: 6 });
  assert.equal(r.resultado, "RECHAZAR");
});

test("orden sin stop se rechaza; reducir riesgo siempre se acepta", () => {
  assert.equal(validarOrden(base, { trader_id: "T4", instrumento: "ETH", direccion: "Largo", precio_entrada: 100, cantidad: 1 }).resultado, "RECHAZAR");
  assert.equal(validarOrden(conP(0.8), { trader_id: "T1", reduce_riesgo: true }).resultado, "ACEPTAR");
});

test("sube a +80 y retrocede a +60 con p=70: restricción; con p=80 bloqueo", () => {
  const d = (p) => ({ ...base, posiciones: [], pnl: { realizado: 60, no_realizado: 0, h_previo: 80 }, parametros: { ...base.parametros, p } });
  const a = evaluar(d(0.7)).equipo; cerca(a.F, 56); cerca(a.Q, 4); assert.equal(a.estado, ESTADOS.RESTRICCION);
  assert.equal(evaluar(d(0.8)).equipo.estado, ESTADOS.BLOQUEO);
});

test("ganancia no realizada se reconoce al 50% y una pérdida no realizada completa", () => {
  const P = { B: 10, p: 0.7, lambda: 0.5 };
  cerca(presupuesto({ realizado: 50, no_realizado: 20 }, P).R, 60);
  cerca(presupuesto({ realizado: 50, no_realizado: -20 }, P).R, 30);
});

test("pérdida hasta stop desde precios, largo y corto, con deslizamiento y costo", () => {
  cerca(perdidaHastaStop({ direccion: "Largo", precio_actual: 100, stop: 98, deslizamiento: 0.5, cantidad: 2, multiplicador: 1, costo_salida: 0.1 }), 5.1);
  cerca(perdidaHastaStop({ direccion: "Corto", precio_actual: 100, stop: 103, cantidad: 1 }), 3);
  cerca(perdidaHastaStop({ direccion: "Largo", precio_actual: 100, stop: 101, cantidad: 1 }), 0); // stop en ganancia
  assert.equal(perdidaHastaStop({ direccion: "Largo", precio_actual: 100, cantidad: 1 }), null);
});

test("datos desactualizados pasan a restricción y luego a bloqueo", () => {
  assert.equal(evaluar({ ...conP(0.5), datos_edad_seg: 90 }).equipo.estado, ESTADOS.RESTRICCION);
  assert.equal(evaluar({ ...conP(0.5), datos_edad_seg: 400 }).equipo.estado, ESTADOS.BLOQUEO);
});
