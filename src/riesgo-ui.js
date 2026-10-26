/**
 * Sección "Riesgo" del Backoffice — componente sin framework.
 *
 * Uso:
 *   import { montarRiesgo } from "./riesgo-ui.js";
 *   montarRiesgo(document.getElementById("uc-riesgo"), {
 *     endpoint: "/api/riesgo/estado",   // GET que devuelve el JSON de estado (ver INTEGRACION.md)
 *     validarEndpoint: null,             // opcional: POST /api/riesgo/validar-orden; si es null valida en el navegador
 *     puedeEditar: true,                 // solo ADMIN / Riesgo: muestra el panel de simulación de parámetros
 *     refrescoSeg: 15,
 *   });
 *
 * Los estilos usan variables --uc-* (ver riesgo.css) para calzar con el tema del Backoffice.
 */
import { evaluar, validarOrden, compararProteccion, redondear } from "./risk-engine.js";

const fmt = (x, d = 2) =>
  (x ?? 0).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const money = (x) => (x < 0 ? "-$" : "$") + fmt(Math.abs(x));
const pct = (x) => fmt(x * 100, 0) + "%";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const ETIQUETA = {
  NORMAL: ["Normal", "ok"], ADVERTENCIA: ["Advertencia", "warn"],
  RESTRICCION: ["Restricción", "rest"], BLOQUEO: ["Bloqueo", "stop"],
  PUEDE_OPERAR: ["Puede operar", "ok"], BAJO_MINIMO: ["Bajo mínimo oficial", "warn"],
  SIN_RIESGO_NUEVO: ["Sin riesgo nuevo", "rest"], REDUCIR: ["Debe reducir", "stop"],
};
const chip = (k) => { const [t, c] = ETIQUETA[k] || [k, "warn"]; return `<span class="ucr-chip ucr-${c}">${t}</span>`; };

export function montarRiesgo(el, opciones = {}) {
  const op = { endpoint: "./data/ejemplo-estado.json", validarEndpoint: null, puedeEditar: false, refrescoSeg: 15, ...opciones };
  let datos = null;        // último estado del servidor
  let simulados = null;    // parámetros editados localmente (no se guardan)
  let timer = null;

  el.classList.add("ucr");
  el.innerHTML = `<p class="ucr-muted">Cargando riesgo…</p>`;

  async function cargar() {
    try {
      const r = await fetch(op.endpoint, { credentials: "same-origin", cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      datos = await r.json();
      pintar();
    } catch (e) {
      el.innerHTML = `<div class="ucr-card ucr-error">No se pudo leer el estado de riesgo (${esc(e.message)}). Revisa la conexión con ${esc(op.endpoint)}; mientras tanto, el panel no debe usarse para autorizar órdenes.</div>`;
    }
  }

  function datosActivos() {
    return simulados ? { ...datos, parametros: { ...datos.parametros, ...simulados } } : datos;
  }

  function pintar() {
    const d = datosActivos();
    const ev = evaluar(d);
    const eq = ev.equipo;
    const [estTxt, estCls] = ETIQUETA[eq.estado];
    const usado = eq.D > 0 ? Math.min(1, Math.max(0, (eq.H - eq.R) / eq.D)) : 0;
    const abierto = eq.D > 0 ? Math.min(1 - usado, Math.max(0, eq.L / eq.D)) : 0;
    const comp = compararProteccion(d, [0.5, 0.7, 0.8]);
    const P = ev.parametros;

    el.innerHTML = `
    <section class="ucr-card ucr-hero ucr-b-${estCls}">
      <div class="ucr-head">
        <div>
          <p class="ucr-eyebrow">Riesgo del equipo · ${esc(d.periodo || "mes en curso")}</p>
          <h2 class="ucr-title">¿Cuánto más puede perder el equipo?</h2>
          <p class="ucr-muted">${simulados ? "<b class='ucr-sim'>Simulación:</b> parámetros editados en esta pantalla, no guardados. " : ""}Actualizado ${esc(fechaCorta(d.actualizado))}${d.datos_edad_seg != null ? ` · datos con ${esc(d.datos_edad_seg)} s` : ""}</p>
        </div>
        <span class="ucr-pill ucr-${estCls}">${estTxt}</span>
      </div>
      <p class="ucr-answer">${eq.Q > 0
        ? `Puede perder <b>${money(eq.Q)}</b> más antes del piso de <b>${money(eq.F)}</b>. Tiene <b>${money(eq.L)}</b> comprometido hasta stops; quedan <b>${money(Math.max(eq.A, 0))}</b> para riesgo nuevo.`
        : `El P&amp;L reconocido (${money(eq.R)}) está en o bajo el piso (${money(eq.F)}). Corresponde bloqueo y cierre ordenado.`}</p>
      ${eq.motivos.length ? `<p class="ucr-muted">Motivo del estado: ${esc(eq.motivos.join(" · "))}</p>` : ""}
      <div class="ucr-kpis">
        ${kpi("P&L reconocido", money(eq.R))}${kpi("Máximo del mes", money(eq.H))}${kpi("Piso", money(eq.F))}
        ${kpi("Presupuesto restante", money(eq.Q))}${kpi("Comprometido", money(eq.L))}${kpi("Disponible", money(eq.A), eq.A < 0 ? "neg" : "")}${kpi("Consumo", pct(eq.u))}
      </div>
      <div class="ucr-bar" role="img" aria-label="Devuelto ${pct(usado)}, comprometido ${pct(abierto)} de la devolución máxima">
        <i class="ucr-bar-used" style="width:${usado * 100}%"></i><i class="ucr-bar-open" style="left:${usado * 100}%;width:${abierto * 100}%"></i>
        <i class="ucr-tick" style="left:50%"></i><i class="ucr-tick" style="left:75%"></i><i class="ucr-tick" style="left:90%"></i>
      </div>
      <div class="ucr-ticks"><span>Máximo ${money(eq.H)}</span><span>Piso ${money(eq.F)}</span></div>
      <div class="ucr-legend"><span><i class="ucr-sw-used"></i>Devuelto desde el máximo</span><span><i class="ucr-sw-open"></i>Comprometido hasta stops</span><span><i class="ucr-sw-free"></i>Disponible</span><span class="ucr-muted">Marcas: 50% · 75% · 90%</span></div>
    </section>

    <section class="ucr-card">
      <p class="ucr-eyebrow">Por trader</p>
      <div class="ucr-scroll"><table class="ucr-table">
        <thead><tr><th>Trader</th><th>Departamento</th><th class="n">Capital</th><th class="n">Comprometido</th><th class="n">Tope</th><th class="n">Uso</th><th class="n">Máx. próxima orden</th><th>Estado</th></tr></thead>
        <tbody>${ev.traders.slice().sort((a, b) => b.L / (b.tope || 1) - a.L / (a.tope || 1)).map((t) => `
          <tr><td><b>${esc(t.nombre)}</b></td><td>${esc(t.departamento)}</td><td class="n">${money(t.capital)}</td>
          <td class="n">${money(t.L)}</td><td class="n">${money(t.tope)}</td><td class="n">${usoBar(t.tope > 0 ? t.L / t.tope : 1)}</td>
          <td class="n">${money(t.maximo_orden)}<small>limita: ${esc(t.limita)}</small></td><td>${chip(t.estado)}</td></tr>`).join("")}</tbody>
      </table></div>
    </section>

    <div class="ucr-two">
      <section class="ucr-card">
        <p class="ucr-eyebrow">Concentración</p>
        <table class="ucr-table">
          <thead><tr><th>Grupo / departamento</th><th class="n">Comprometido</th><th class="n">Tope</th><th class="n">Uso</th></tr></thead>
          <tbody>
          ${ev.grupos.map((g) => `<tr><td>${esc(g.grupo)} ${esc(g.direccion.toLowerCase())}</td><td class="n">${money(g.L)}</td><td class="n">${money(g.tope)}</td><td class="n">${usoBar(g.tope > 0 ? g.L / g.tope : 1)}</td></tr>`).join("")}
          ${ev.departamentos.map((g) => `<tr><td>Depto. ${esc(g.departamento)}</td><td class="n">${money(g.L)}</td><td class="n">${money(g.tope)}</td><td class="n">${usoBar(g.tope > 0 ? g.L / g.tope : 1)}</td></tr>`).join("")}
          </tbody>
        </table>
      </section>
      <section class="ucr-card">
        <p class="ucr-eyebrow">Incumplimientos</p>
        ${ev.incumplimientos.length
          ? `<ul class="ucr-list">${ev.incumplimientos.map((i) => `<li><span class="ucr-chip ucr-stop">${esc(i.tipo.replace(/_/g, " ").toLowerCase())}</span> ${esc(i.detalle)}</li>`).join("")}</ul>`
          : `<p class="ucr-muted">Sin incumplimientos.</p>`}
      </section>
    </div>

    <section class="ucr-card">
      <p class="ucr-eyebrow">Posiciones y órdenes pendientes</p>
      <div class="ucr-scroll"><table class="ucr-table">
        <thead><tr><th>Trader</th><th>Instrumento</th><th>Grupo</th><th>Dirección</th><th>Tipo</th><th class="n">Pérdida hasta stop</th></tr></thead>
        <tbody>${ev.posiciones.length ? ev.posiciones.map((x) => `<tr><td>${esc(nombreDe(ev, x.trader_id))}</td><td>${esc(x.instrumento)}</td><td>${esc(x.grupo || "Sin mapear")}</td><td>${esc(x.direccion)}</td><td>${x.pendiente ? "Pendiente" : "Abierta"}</td><td class="n">${x.L == null ? '<span class="ucr-chip ucr-stop">sin stop</span>' : money(x.L)}</td></tr>`).join("")
          : `<tr><td colspan="6" class="ucr-muted">Sin posiciones abiertas ni pendientes.</td></tr>`}</tbody>
      </table></div>
    </section>

    <div class="ucr-two">
      <section class="ucr-card">
        <p class="ucr-eyebrow">Probar una orden nueva</p>
        <form class="ucr-form" id="ucr-orden">
          <label>Trader<select id="ucr-o-tr">${ev.traders.map((t) => `<option value="${esc(t.id)}">${esc(t.nombre)}</option>`).join("")}</select></label>
          <label>Instrumento<input id="ucr-o-ins" value="ETH" autocomplete="off"></label>
          <label>Dirección<select id="ucr-o-dir"><option>Largo</option><option>Corto</option></select></label>
          <label>Pérdida hasta stop<input id="ucr-o-l" type="number" step="0.25" min="0" value="3"></label>
          <button class="ucr-btn ucr-btn-primary" type="submit">Validar</button>
        </form>
        <div id="ucr-veredicto" aria-live="polite"></div>
      </section>
      <section class="ucr-card">
        <p class="ucr-eyebrow">Mismo momento con 50% · 70% · 80% de protección</p>
        <table class="ucr-table">
          <thead><tr><th></th>${comp.map((c) => `<th class="n${Math.abs(c.p - P.p) < 1e-9 ? " ucr-cur" : ""}">p = ${pct(c.p)}</th>`).join("")}</tr></thead>
          <tbody>
            ${filaComp("Piso", comp.map((c) => money(c.F)))}${filaComp("Devolución máx.", comp.map((c) => money(c.D)))}
            ${filaComp("Presupuesto", comp.map((c) => money(c.Q)))}${filaComp("Disponible", comp.map((c) => money(c.A)))}
            ${filaComp("Estado", comp.map((c) => chip(c.estado)))}${filaComp("Incumplimientos", comp.map((c) => c.incumplimientos))}
          </tbody>
        </table>
      </section>
    </div>

    ${op.puedeEditar ? `
    <section class="ucr-card">
      <div class="ucr-head"><p class="ucr-eyebrow">Simular parámetros (solo ADMIN / Riesgo)</p>${simulados ? `<button class="ucr-btn" id="ucr-reset" type="button">Volver a los aprobados</button>` : ""}</div>
      <p class="ucr-muted">Los cambios recalculan esta pantalla y no se guardan. Los parámetros aprobados se cambian en la base de datos, con registro de quién y cuándo.</p>
      <form class="ucr-form ucr-params" id="ucr-params">
        ${param("B", "Presupuesto base B ($)", P.B, 1)}${param("p", "Protección p (%)", P.p * 100, 5, true)}
        ${param("lambda", "Reconocimiento λ (%)", P.lambda * 100, 5, true)}${param("alpha", "Tope trader α (%)", P.alpha * 100, 5, true)}
        ${param("beta", "Tope operación β (%)", P.beta * 100, 5, true)}${param("grupo", "Tope grupo (%)", P.grupo * 100, 5, true)}
        ${param("departamento", "Tope depto. (%)", P.departamento * 100, 5, true)}
      </form>
    </section>` : ""}

    <p class="ucr-foot">Política de riesgo v0.1 (borrador, parámetros ilustrativos). No incluye pérdida bajo estrés ni topes diarios y semanales. Un stop no garantiza la pérdida máxima ante gaps o falta de liquidez.</p>`;

    enlazar();
  }

  function enlazar() {
    const f = el.querySelector("#ucr-orden");
    f?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const orden = {
        trader_id: el.querySelector("#ucr-o-tr").value,
        instrumento: el.querySelector("#ucr-o-ins").value.trim(),
        direccion: el.querySelector("#ucr-o-dir").value,
        perdida_hasta_stop: parseFloat(el.querySelector("#ucr-o-l").value),
      };
      let r;
      if (op.validarEndpoint && !simulados) {
        try {
          const res = await fetch(op.validarEndpoint, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(orden) });
          r = await res.json();
        } catch (err) { r = { resultado: "RECHAZAR", motivo: "No se pudo validar en el servidor: " + err.message }; }
      } else {
        r = validarOrden(datosActivos(), orden);
      }
      const cls = { ACEPTAR: "ok", REDUCIR: "rest", RECHAZAR: "stop" }[r.resultado] || "warn";
      const extra = r.resultado === "REDUCIR" ? ` Tamaño permitido: ${fmt(r.fraccion * 100, 0)}% del pedido.` : "";
      el.querySelector("#ucr-veredicto").innerHTML = `<div class="ucr-verdict ucr-${cls}"><b>${esc(r.resultado)}</b> · ${esc(r.motivo)}.${esc(extra)}</div>`;
    });

    const pf = el.querySelector("#ucr-params");
    pf?.addEventListener("change", (e) => {
      const i = e.target; const k = i.dataset.k; let v = parseFloat(i.value);
      if (!Number.isFinite(v)) return;
      if (i.dataset.pct) v = v / 100;
      simulados = { ...(simulados || {}), [k]: v };
      const foco = i.id; pintar(); el.querySelector("#" + foco)?.focus();
    });
    el.querySelector("#ucr-reset")?.addEventListener("click", () => { simulados = null; pintar(); });
  }

  cargar();
  if (op.refrescoSeg > 0) timer = setInterval(() => { if (!simulados && !el.contains(document.activeElement)) cargar(); }, op.refrescoSeg * 1000);

  return { recargar: cargar, desmontar: () => { clearInterval(timer); el.innerHTML = ""; } };
}

function kpi(t, v, cls = "") { return `<div class="ucr-kpi"><span>${t}</span><b class="${cls ? "ucr-" + cls : ""}">${v}</b></div>`; }
function usoBar(x) {
  const c = x > 1 + 1e-9 ? "stop" : x >= 0.8 ? "warn" : "ok";
  return `<span class="ucr-uso"><i class="ucr-bg-${c}" style="width:${Math.min(1, Math.max(0, x)) * 100}%"></i></span><span class="ucr-${c}-t">${fmt(x * 100, 0)}%</span>`;
}
function filaComp(t, vals) { return `<tr><td>${t}</td>${vals.map((v) => `<td class="n">${v}</td>`).join("")}</tr>`; }
function param(k, t, v, step, isPct) { return `<label>${t}<input id="ucr-p-${k}" data-k="${k}" ${isPct ? 'data-pct="1"' : ""} type="number" step="${step}" value="${redondear(v, 2)}"></label>`; }
function nombreDe(ev, id) { return ev.traders.find((t) => t.id === id)?.nombre ?? id; }
function fechaCorta(iso) {
  if (!iso) return "ahora";
  const d = new Date(iso);
  return Number.isNaN(+d) ? iso : d.toLocaleString("es-CL", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}
