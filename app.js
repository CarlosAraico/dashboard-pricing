// /app.js (module)
const READ_ONLY_MODE = true;
const DATA_URL = "./exports/derived_jan_may_2025_2026.json";

const THRESH = {
  UPLIFT_RED: 8.0,
  MIX_UBER_ALTO: 40.0,
  DARK_KITCHEN: 55.0,
};

const state = {
  data: null,
  viewMode: "money",           // money | pct
  rankMode: "impact",          // impact | sensitivity
  filters: { sucursal: "Todas", mes: "Todos", canal: "Todos", search: "" },
  sort: { key: "diferencial", dir: "desc" },
  charts: { canal: null, mensual: null, scatter: null },
};

const el = (id) => document.getElementById(id);

const Utils = {
  uniq(arr) { return [...new Set(arr)]; },

  safeParseGeneratedAt(value) {
    if (!value) return null;
    const v = String(value).replace(/(\.\d{3})\d+/, "$1").replace(/\+00:00$/, "Z");
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  },

  formatMoney(n) {
    return Number(n || 0).toLocaleString("es-MX", {
      style: "currency", currency: "MXN", maximumFractionDigits: 0
    });
  },

  formatPct(p) { return `${Number(p || 0).toFixed(1)}%`; },

  toCSV(rows) {
    const cols = Object.keys(rows[0] || {});
    const esc = (v) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
    };
    return [cols.join(","), ...rows.map(r => cols.map(c => esc(r[c])).join(","))].join("\n");
  },

  downloadBlob(filename, blob) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },

  groupBy(rows, key) {
    const m = new Map();
    for (const r of rows) {
      const k = r[key];
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(r);
    }
    return m;
  },

  summarize(rows) {
    const sum = (k) => rows.reduce((a, r) => a + Number(r[k] || 0), 0);
    const venta_2025 = sum("venta_2025");
    const venta_2026 = sum("venta_2026");
    const diferencial = sum("diferencial");
    const uplift_pct = venta_2025 > 0 ? (diferencial / venta_2025) * 100 : 0;
    return { venta_2025, venta_2026, diferencial, uplift_pct };
  },

  applyFilters(rows) {
    const { sucursal, mes, canal, search } = state.filters;
    const q = (search || "").trim().toLowerCase();
    return rows.filter((r) => {
      if (sucursal !== "Todas" && r.sucursal !== sucursal) return false;
      if (mes !== "Todos" && r.mes !== mes) return false;
      if (canal !== "Todos" && r.canal !== canal) return false;
      if (q && !String(r.sucursal).toLowerCase().includes(q)) return false;
      return true;
    });
  },
};

const UI = {
  zebraify(tbodyId) {
    const tbody = el(tbodyId);
    if (tbody) tbody.classList.add("zebra");
  },

  badgePct(p) {
    const v = Number(p || 0);
    const base = "inline-flex items-center justify-end rounded-full px-2 py-0.5 text-xs font-medium ring-1 ";
    if (v >= THRESH.UPLIFT_RED) return `${base} bg-rose-500/10 text-rose-700 ring-rose-200 dark:text-rose-200 dark:ring-rose-500/30`;
    if (v >= 5) return `${base} bg-emerald-500/10 text-emerald-700 ring-emerald-200 dark:text-emerald-200 dark:ring-emerald-500/30`;
    return `${base} bg-slate-500/10 text-slate-700 ring-slate-200 dark:text-slate-200 dark:ring-slate-500/30`;
  },

  chip(text, tone = "slate") {
    const map = {
      slate: "bg-white/60 dark:bg-slate-950/30 ring-slate-200 dark:ring-slate-700",
      amber: "bg-amber-500/10 dark:bg-amber-400/10 ring-amber-200 dark:ring-amber-500/30 text-amber-800 dark:text-amber-200",
      rose: "bg-rose-500/10 dark:bg-rose-400/10 ring-rose-200 dark:ring-rose-500/30 text-rose-800 dark:text-rose-200",
      emerald: "bg-emerald-500/10 dark:bg-emerald-400/10 ring-emerald-200 dark:ring-emerald-500/30 text-emerald-800 dark:text-emerald-200",
    };
    const cls = map[tone] || map.slate;
    return `<span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${cls}">${text}</span>`;
  },

  toast(msg) {
    const div = document.createElement("div");
    div.className =
      "fixed left-1/2 -translate-x-1/2 bottom-6 z-[9999] px-4 py-2 text-sm rounded-xl " +
      "bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-soft3d";
    div.textContent = msg;
    document.body.appendChild(div);
    setTimeout(() => div.remove(), 1600);
  },

  initTilt() {
    // Solo en dispositivos con hover/puntero fino
    const canTilt = window.matchMedia?.("(hover:hover) and (pointer:fine)")?.matches;
    if (!canTilt || !window.VanillaTilt) return;

    document.querySelectorAll("[data-tilt]").forEach((node) => {
      if (node.vanillaTilt) return;
      window.VanillaTilt.init(node, {
        max: 4,
        speed: 600,
        glare: false,
        scale: 1.01
      });
    });
  },
};

const Data = {
  assertReadOnlyFetch(options = {}) {
    const method = (options.method || "GET").toUpperCase();
    if (READ_ONLY_MODE && method !== "GET") throw new Error(`READ_ONLY_MODE: método bloqueado (${method}).`);
  },

  async fetchJSON(url, options = {}) {
    Data.assertReadOnlyFetch(options);
    const res = await fetch(url, { method: "GET", ...options });
    if (!res.ok) throw new Error(`No se pudo cargar data (${res.status})`);
    return res.json();
  },

  buildBranchAgg(rows) {
    const m = Utils.groupBy(rows, "sucursal");
    const total = Utils.summarize(rows);

    const agg = [...m.entries()].map(([sucursal, rs]) => {
      const s = Utils.summarize(rs);
      const uberVenta = rs.filter((r) => r.canal === "UBER").reduce((a, r) => a + Number(r.venta_2025 || 0), 0);
      const mixUber = s.venta_2025 > 0 ? (uberVenta / s.venta_2025) * 100 : 0;
      const contribUplift = total.diferencial > 0 ? (s.diferencial / total.diferencial) * 100 : 0;

      const rsUber = rs.filter((r) => r.canal === "UBER");
      const rsSalon = rs.filter((r) => r.canal === "SALON");
      const uUber = rsUber.length ? Utils.summarize(rsUber).uplift_pct : null;
      const uSalon = rsSalon.length ? Utils.summarize(rsSalon).uplift_pct : null;

      return {
        sucursal,
        venta_2025: s.venta_2025,
        diferencial: s.diferencial,
        uplift_pct: s.uplift_pct,
        mix_uber_2025: mixUber,
        contrib_uplift_pct: contribUplift,
        salon_beats_uber: (uUber !== null && uSalon !== null) ? (uSalon > uUber) : false
      };
    });

    return { agg, total };
  },

  classifyBranch(b, p75Venta) {
    if (b.mix_uber_2025 >= THRESH.DARK_KITCHEN) return { label: "Dark Kitchen", tone: "amber" };
    if (b.uplift_pct >= THRESH.UPLIFT_RED && b.mix_uber_2025 >= THRESH.MIX_UBER_ALTO) return { label: "Riesgo", tone: "rose" };
    if (b.venta_2025 >= p75Venta) return { label: "Volumen crítico", tone: "emerald" };
    return { label: "Conservador", tone: "slate" };
  },
};

const Charts = {
  registerPlugins() {
    // chartjs-plugin-annotation expone global diferente según build
    const ann = window.ChartAnnotation || window["chartjs-plugin-annotation"];
    if (ann) Chart.register(ann);
  },

  cssVar(name) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || "";
  },

  rgbTriplet(varName) {
    const t = Charts.cssVar(varName);
    return t ? `rgb(${t})` : undefined;
  },

  applyGlobalTheme() {
    const fg = Charts.rgbTriplet("--fg") || "#0f172a";
    const muted = Charts.rgbTriplet("--muted") || "#64748b";
    const grid = "rgba(148,163,184,.28)";

    Chart.defaults.color = muted;
    Chart.defaults.borderColor = grid;
    Chart.defaults.font.family = "ui-sans-serif,system-ui,Segoe UI,Roboto,Arial";
    Chart.defaults.plugins.legend.labels.color = muted;
    Chart.defaults.plugins.tooltip.backgroundColor = "rgba(15,23,42,.92)";
    Chart.defaults.plugins.tooltip.titleColor = "#fff";
    Chart.defaults.plugins.tooltip.bodyColor = "#fff";
    Chart.defaults.plugins.tooltip.borderColor = "rgba(255,255,255,.12)";
    Chart.defaults.plugins.tooltip.borderWidth = 1;

    // En dark, tooltip más claro
    if (document.documentElement.classList.contains("dark")) {
      Chart.defaults.plugins.tooltip.backgroundColor = "rgba(248,250,252,.94)";
      Chart.defaults.plugins.tooltip.titleColor = "#0f172a";
      Chart.defaults.plugins.tooltip.bodyColor = "#0f172a";
      Chart.defaults.plugins.tooltip.borderColor = "rgba(15,23,42,.12)";
    }

    return { fg, muted };
  },

  destroy(key) {
    if (state.charts[key]) state.charts[key].destroy();
    state.charts[key] = null;
  },
};

function resizeChartsSoon() {
  requestAnimationFrame(() => {
    Object.values(state.charts).forEach((c) => { try { c?.resize?.(); } catch {} });
  });
}

/* ===== Responsive accordions ===== */
function setupResponsiveDetails() {
  const mq = window.matchMedia("(min-width: 640px)");
  const details = Array.from(document.querySelectorAll("details[data-responsive]"));

  const apply = () => {
    const isDesktop = mq.matches;
    details.forEach((d) => {
      if (isDesktop) d.open = true;
      else if (!d.dataset.userSet) d.open = false;
    });
    resizeChartsSoon();
  };

  details.forEach((d) => {
    d.addEventListener("toggle", () => {
      d.dataset.userSet = "1";
      resizeChartsSoon();
    });
  });

  mq.addEventListener?.("change", apply);
  window.addEventListener("resize", apply);
  apply();
}

/* ===== Theme ===== */
function initTheme() {
  const root = document.documentElement;
  const saved = localStorage.getItem("theme");
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const theme = saved || (prefersDark ? "dark" : "light");

  const apply = (t) => {
    if (t === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
    localStorage.setItem("theme", t);
    el("themeLabel").textContent = t === "dark" ? "Oscuro" : "Claro";

    // Re-theme charts
    Charts.applyGlobalTheme();
    renderAll();
    renderScatter(); // mantiene medianas correctas
  };

  apply(theme);
  el("themeToggle").addEventListener("click", () => {
    const now = root.classList.contains("dark") ? "dark" : "light";
    apply(now === "dark" ? "light" : "dark");
  });
}

/* ===== Rendering ===== */
function buildKPIs(kpi) {
  const cards = [
    { label: "Venta 2025", value: Utils.formatMoney(kpi.venta_2025), hint: "Base (precio actual)" },
    { label: "Venta 2026", value: Utils.formatMoney(kpi.venta_2026), hint: "Precio nuevo (mismo volumen)" },
    { label: "Diferencial", value: Utils.formatMoney(kpi.diferencial), hint: "Uplift $ por precio" },
    { label: "Uplift %", value: Utils.formatPct(kpi.uplift_pct), hint: "Diferencial / Venta 2025" },
  ];

  const container = el("kpiCards");
  container.innerHTML = "";

  for (const c of cards) {
    const div = document.createElement("div");
    div.className = "surface surface-hover p-4";
    div.dataset.tilt = "";
    div.innerHTML = `
      <div class="text-xs text-slate-600 dark:text-slate-300">${c.label}</div>
      <div class="mt-1 text-2xl font-semibold tracking-tight">${c.value}</div>
      <div class="mt-1 text-xs text-slate-500 dark:text-slate-400">${c.hint}</div>
    `;
    container.appendChild(div);
  }

  UI.initTilt();
}

function renderActiveChips() {
  const chips = el("activeChips");
  chips.innerHTML = "";

  const pushChip = (label, value, onClear) => {
    if (!value) return;
    const btn = document.createElement("button");
    btn.className = "chip hover:-translate-y-0.5";
    btn.title = "Click para quitar";
    btn.innerHTML = `<span class="text-slate-600 dark:text-slate-300">${label}:</span> <span class="font-medium">${value}</span> <span class="ml-1 opacity-70">×</span>`;
    btn.addEventListener("click", onClear);
    chips.appendChild(btn);
  };

  if (state.filters.sucursal !== "Todas") pushChip("Sucursal", state.filters.sucursal, () => { state.filters.sucursal = "Todas"; el("fSucursal").value = "Todas"; renderAll(); });
  if (state.filters.mes !== "Todos") pushChip("Mes", state.filters.mes, () => { state.filters.mes = "Todos"; el("fMes").value = "Todos"; renderAll(); });
  if (state.filters.canal !== "Todos") pushChip("Canal", state.filters.canal, () => { state.filters.canal = "Todos"; el("fCanal").value = "Todos"; renderAll(); });
  if (state.filters.search.trim()) pushChip("Buscar", state.filters.search.trim(), () => { state.filters.search = ""; el("fSearch").value = ""; renderAll(); });

  if (!chips.children.length) {
    const span = document.createElement("span");
    span.className = "text-xs text-slate-500 dark:text-slate-400";
    span.textContent = "Ninguno (vista global)";
    chips.appendChild(span);
  }
}

function renderCanal(rows) {
  const m = Utils.groupBy(rows, "canal");
  const channels = [...m.keys()].sort();
  const agg = channels.map((c) => ({ canal: c, ...Utils.summarize(m.get(c)) }));
  const total = Utils.summarize(rows);

  const tbody = el("tblCanal");
  tbody.innerHTML = "";

  const contribs = agg.map((a) => {
    const contrib = total.diferencial > 0 ? (a.diferencial / total.diferencial) * 100 : 0;
    return { ...a, contrib };
  });

  for (const a of contribs) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="py-2 px-3 font-medium">${a.canal}</td>
      <td class="py-2 px-3 text-right tabular-nums">${Utils.formatMoney(a.venta_2025)}</td>
      <td class="py-2 px-3 text-right tabular-nums">${Utils.formatMoney(a.diferencial)}</td>
      <td class="py-2 px-3 text-right tabular-nums"><span class="${UI.badgePct(a.uplift_pct)}">${Utils.formatPct(a.uplift_pct)}</span></td>
      <td class="py-2 px-3 text-right tabular-nums">${Utils.formatPct(a.contrib)}</td>
    `;
    tbody.appendChild(tr);
  }
  UI.zebraify("tblCanal");

  const labels = contribs.map((a) => a.canal);
  const values = state.viewMode === "pct"
    ? contribs.map((a) => a.contrib)
    : contribs.map((a) => a.diferencial);

  const { muted } = Charts.applyGlobalTheme();

  Charts.destroy("canal");
  state.charts.canal = new Chart(el("chartCanal"), {
    type: "doughnut",
    data: { labels, datasets: [{ data: values }] },
    options: {
      responsive: true,
      cutout: "68%",
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 12, color: muted } },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const v = ctx.raw;
              return state.viewMode === "pct"
                ? `${ctx.label}: ${Utils.formatPct(v)}`
                : `${ctx.label}: ${Utils.formatMoney(v)}`;
            }
          }
        }
      }
    },
  });
}

function renderMensual(rows) {
  const m = Utils.groupBy(rows, "mes");
  const order = ["Enero", "Febrero", "Marzo", "Abril", "Mayo"];
  const months = order.filter((x) => m.has(x));
  const agg = months.map((mes) => ({ mes, ...Utils.summarize(m.get(mes)) }));

  const tbody = el("tblMensual");
  tbody.innerHTML = "";

  for (const a of agg) {
    const isMay = a.mes === "Mayo";
    const tr = document.createElement("tr");
    tr.className = isMay ? "bg-slate-900/5 dark:bg-white/5" : "";
    tr.innerHTML = `
      <td class="py-2 px-3 font-medium">${a.mes}${isMay ? " · ★" : ""}</td>
      <td class="py-2 px-3 text-right tabular-nums">${Utils.formatMoney(a.venta_2025)}</td>
      <td class="py-2 px-3 text-right tabular-nums">${Utils.formatMoney(a.diferencial)}</td>
      <td class="py-2 px-3 text-right tabular-nums"><span class="${UI.badgePct(a.uplift_pct)}">${Utils.formatPct(a.uplift_pct)}</span></td>
    `;
    tbody.appendChild(tr);
  }
  UI.zebraify("tblMensual");

  const labels = agg.map((a) => a.mes);

  // Toggle view: money -> bar dif, line uplift; pct -> bar uplift, line dif
  const bar = state.viewMode === "pct" ? agg.map(a => a.uplift_pct) : agg.map(a => a.diferencial);
  const line = state.viewMode === "pct" ? agg.map(a => a.diferencial) : agg.map(a => a.uplift_pct);

  Charts.destroy("mensual");
  state.charts.mensual = new Chart(el("chartMensual"), {
    data: {
      labels,
      datasets: [
        {
          type: "bar",
          label: state.viewMode === "pct" ? "Uplift %" : "Diferencial $",
          data: bar,
          yAxisID: "y",
        },
        {
          type: "line",
          label: state.viewMode === "pct" ? "Diferencial $" : "Uplift %",
          data: line,
          yAxisID: "y1",
          tension: 0.3,
          pointRadius: 3,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { position: "bottom", labels: { boxWidth: 12 } } },
      scales: {
        y: {
          ticks: {
            callback: (v) => state.viewMode === "pct" ? Utils.formatPct(v) : Utils.formatMoney(v)
          }
        },
        y1: {
          position: "right",
          grid: { drawOnChartArea: false },
          ticks: {
            callback: (v) => state.viewMode === "pct" ? Utils.formatMoney(v) : Utils.formatPct(v)
          }
        },
      },
    },
  });
}

function renderSucursal(rows) {
  const { agg } = Data.buildBranchAgg(rows);

  const { key, dir } = state.sort;
  agg.sort((a, b) => {
    const va = a[key], vb = b[key];
    const cmp = typeof va === "string" ? va.localeCompare(vb) : va - vb;
    return dir === "asc" ? cmp : -cmp;
  });

  const tbody = el("tblSucursal");
  tbody.innerHTML = "";

  agg.forEach((a) => {
    const tr = document.createElement("tr");
    tr.className = "cursor-pointer";
    tr.title = "Click para filtrar esta sucursal";
    tr.addEventListener("click", () => {
      state.filters.sucursal = a.sucursal;
      el("fSucursal").value = a.sucursal;
      renderAll();
      UI.toast(`Filtro: ${a.sucursal}`);
    });

    tr.innerHTML = `
      <td class="py-2 px-3 font-medium">${a.sucursal}</td>
      <td class="py-2 px-3 text-right tabular-nums">${Utils.formatMoney(a.venta_2025)}</td>
      <td class="py-2 px-3 text-right tabular-nums">${Utils.formatMoney(a.diferencial)}</td>
      <td class="py-2 px-3 text-right tabular-nums"><span class="${UI.badgePct(a.uplift_pct)}">${Utils.formatPct(a.uplift_pct)}</span></td>
      <td class="py-2 px-3 text-right tabular-nums">${Utils.formatPct(a.mix_uber_2025)}</td>
    `;
    tbody.appendChild(tr);
  });

  UI.zebraify("tblSucursal");
}

function renderScatter() {
  // Scatter usando data global (como tu original), pero con annotation plugin
  const branches = state.data?.sucursales || [];
  const points = branches.map((b) => ({ x: b.mix_uber_2025, y: b.uplift_pct, label: b.sucursal }));

  const medX = state.data?.scatter?.median_mix_uber ?? 0;
  const medY = state.data?.scatter?.median_uplift ?? 0;
  el("corrTxt").textContent = String(state.data?.scatter?.corr_mix_uber_uplift ?? "—");

  Charts.destroy("scatter");
  state.charts.scatter = new Chart(el("chartScatter"), {
    type: "scatter",
    data: {
      datasets: [
        {
          label: "Sucursales",
          data: points,
          parsing: false,
          pointRadius: 5,
        }
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 12 } },
        tooltip: {
          callbacks: {
            label: (ctx) => ctx.raw?.label
              ? `${ctx.raw.label}: mix ${Utils.formatPct(ctx.raw.x)} · uplift ${Utils.formatPct(ctx.raw.y)}`
              : "Sucursal"
          }
        },
        annotation: {
          annotations: {
            medMix: {
              type: "line",
              xMin: medX,
              xMax: medX,
              borderColor: "rgba(148,163,184,.9)",
              borderWidth: 1,
              label: { display: true, content: "Mediana mix", position: "start" }
            },
            medUplift: {
              type: "line",
              yMin: medY,
              yMax: medY,
              borderColor: "rgba(148,163,184,.9)",
              borderWidth: 1,
              label: { display: true, content: "Mediana uplift", position: "start" }
            }
          }
        }
      },
      scales: {
        x: { title: { display: true, text: "Mix UBER (Venta 2025 %)" }, ticks: { callback: (v) => Utils.formatPct(v) } },
        y: { title: { display: true, text: "Uplift % (Jan–May)" }, ticks: { callback: (v) => Utils.formatPct(v) }, suggestedMin: 0 },
      },
    },
  });
}

function renderDrilldown() {
  const tbody = el("tblDrill");
  tbody.innerHTML = "";
  for (const r of state.data?.drilldown || []) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="py-2 px-3">${r.mes}</td>
      <td class="py-2 px-3 font-medium">${r.canal}</td>
      <td class="py-2 px-3 font-medium">${r.sucursal}</td>
      <td class="py-2 px-3 text-right tabular-nums">${Utils.formatMoney(r.venta_2025)}</td>
      <td class="py-2 px-3 text-right tabular-nums">${Utils.formatMoney(r.diferencial)}</td>
      <td class="py-2 px-3 text-right tabular-nums"><span class="${UI.badgePct(r.uplift_pct)}">${Utils.formatPct(r.uplift_pct)}</span></td>
    `;
    tbody.appendChild(tr);
  }
  UI.zebraify("tblDrill");
}

function renderExecutive(rows) {
  const { agg, total } = Data.buildBranchAgg(rows);
  const ventas = agg.map((a) => a.venta_2025).sort((a, b) => a - b);
  const p75Venta = ventas.length ? ventas[Math.floor(0.75 * (ventas.length - 1))] : 0;

  const topImpact = [...agg].sort((a, b) => b.diferencial - a.diferencial)[0];
  const topSens = [...agg].sort((a, b) => b.uplift_pct - a.uplift_pct)[0];
  const topMix = [...agg].sort((a, b) => b.mix_uber_2025 - a.mix_uber_2025)[0];

  const top5 = [...agg].sort((a, b) => b.diferencial - a.diferencial).slice(0, 5);
  const top5Pct = total.diferencial > 0 ? (top5.reduce((s, x) => s + x.diferencial, 0) / total.diferencial) * 100 : 0;
  el("concentrationTxt").textContent = `Concentración: Top 5 explica ${Utils.formatPct(top5Pct)} del uplift total (${Utils.formatMoney(total.diferencial)}).`;

  const flags = [];
  const rowsUber = rows.filter((r) => r.canal === "UBER");
  const rowsMayUber = rows.filter((r) => r.canal === "UBER" && r.mes === "Mayo");

  if (rowsMayUber.length && rowsUber.length) {
    const uMay = Utils.summarize(rowsMayUber).uplift_pct;
    const uAll = Utils.summarize(rowsUber).uplift_pct;
    if (uMay >= uAll + 2 || uMay >= THRESH.UPLIFT_RED) {
      flags.push({ title: "Mayo en UBER", body: `Uplift ${Utils.formatPct(uMay)} vs promedio UBER ${Utils.formatPct(uAll)} → auditar mix/campañas/operación.` });
    }
  }

  if (topSens) {
    const risk = (topSens.uplift_pct >= THRESH.UPLIFT_RED && topSens.mix_uber_2025 >= THRESH.MIX_UBER_ALTO);
    flags.push({ title: `${topSens.sucursal}`, body: `Uplift ${Utils.formatPct(topSens.uplift_pct)} con mix UBER ${Utils.formatPct(topSens.mix_uber_2025)} → ${risk ? "riesgo de elasticidad" : "sensibilidad elevada"}.` });
  }

  if (topImpact && topImpact.contrib_uplift_pct >= 25) {
    flags.push({ title: `Dependencia ${topImpact.sucursal}`, body: `Explica ${Utils.formatPct(topImpact.contrib_uplift_pct)} del uplift. Caída operativa pega al total.` });
  }

  if (topMix && topMix.mix_uber_2025 >= THRESH.DARK_KITCHEN) {
    flags.push({ title: `Mix digital extremo`, body: `${topMix.sucursal}: mix UBER ${Utils.formatPct(topMix.mix_uber_2025)} → sensibilidad al canal digital.` });
  }

  const weird = agg.find((a) => a.salon_beats_uber);
  if (weird) flags.push({ title: "Caso raro SALON>UBER", body: `${weird.sucursal}: patrón inverso → revisar tickets/mix/producto/operación.` });

  // Render red flags
  const list = el("redFlagsList");
  const empty = el("redFlagsEmpty");
  list.innerHTML = "";
  const shown = flags.slice(0, 4);

  if (!shown.length) empty.classList.remove("hidden");
  else {
    empty.classList.add("hidden");
    shown.forEach((f, i) => {
      const li = document.createElement("li");
      li.className = "leading-snug";
      li.innerHTML = `
        <div class="flex gap-2">
          <div class="min-w-[22px] text-rose-700 dark:text-rose-200 font-semibold">${i + 1}.</div>
          <div>
            <div class="font-semibold">${f.title}:</div>
            <div class="text-rose-900/90 dark:text-rose-100/90">${f.body}</div>
          </div>
        </div>
      `;
      list.appendChild(li);
    });
  }

  // Action plan
  const actions = [];
  if (shown.some((x) => x.title.includes("Mayo en UBER"))) actions.push({ title: "Auditoría de Mayo", body: "Validar lista de precios y ejecución digital. Confirmar que el salto es intencional." });
  if (topSens) actions.push({ title: `Monitoreo ${topSens.sucursal}`, body: "Semanas 1–4: seguimiento de transacciones/NPS. Si cae >5%, activar diagnóstico." });
  if (topImpact) actions.push({ title: `Defensa ${topImpact.sucursal}`, body: "Asegurar disponibilidad, tiempos y calidad. Priorizar operación para sostener el uplift." });

  const ap = el("actionPlanList");
  ap.innerHTML = "";
  actions.slice(0, 3).forEach((a, idx) => {
    const div = document.createElement("div");
    div.className = "surface p-4";
    div.innerHTML = `
      <div class="flex items-start gap-3">
        <div class="mt-0.5 inline-flex items-center justify-center w-7 h-7 rounded-full bg-slate-900 text-white dark:bg-white dark:text-slate-900 text-xs font-semibold">${idx + 1}</div>
        <div>
          <div class="font-semibold">${a.title}</div>
          <div class="text-sm text-slate-600 dark:text-slate-300 mt-1">${a.body}</div>
        </div>
      </div>
    `;
    ap.appendChild(div);
  });

  // Ranking list
  const rankList = el("rankingList");
  rankList.innerHTML = "";

  const sorted = [...agg].sort((a, b) => {
    if (state.rankMode === "sensitivity") return b.uplift_pct - a.uplift_pct;
    return b.diferencial - a.diferencial;
  }).slice(0, 5);

  const maxVal = sorted.length ? Math.max(...sorted.map((x) => (state.rankMode === "sensitivity" ? x.uplift_pct : x.diferencial))) : 0;

  sorted.forEach((b, i) => {
    const cls = Data.classifyBranch(b, p75Venta);
    const val = state.rankMode === "sensitivity" ? b.uplift_pct : b.diferencial;
    const pctBar = maxVal > 0 ? (val / maxVal) * 100 : 0;

    const rightMain = state.rankMode === "sensitivity"
      ? `${Utils.formatPct(b.uplift_pct)}`
      : `${Utils.formatMoney(b.diferencial)} (${Utils.formatPct(b.uplift_pct)})`;

    const div = document.createElement("button");
    div.type = "button";
    div.className = "surface p-4 text-left w-full";
    div.dataset.tilt = "";
    div.title = "Click para filtrar esta sucursal";

    div.addEventListener("click", () => {
      state.filters.sucursal = b.sucursal;
      el("fSucursal").value = b.sucursal;
      renderAll();
      UI.toast(`Filtro: ${b.sucursal}`);
    });

    div.innerHTML = `
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <span class="text-xs font-semibold text-slate-500 dark:text-slate-400">${i + 1}.</span>
            <span class="font-semibold truncate">${b.sucursal}</span>
            ${UI.chip(cls.label, cls.tone)}
            ${b.uplift_pct >= THRESH.UPLIFT_RED && b.mix_uber_2025 >= THRESH.MIX_UBER_ALTO ? UI.chip("Alerta", "rose") : ""}
          </div>
          <div class="mt-2 h-2 w-full rounded-full bg-slate-200/70 dark:bg-slate-700/50 overflow-hidden">
            <div class="h-2 rounded-full bg-emerald-500/80" style="width:${pctBar.toFixed(1)}%"></div>
          </div>
        </div>

        <div class="text-right">
          <div class="font-semibold tabular-nums">${rightMain}</div>
          <div class="text-xs text-slate-500 dark:text-slate-400 mt-1">Mix UBER: ${Utils.formatPct(b.mix_uber_2025)}</div>
        </div>
      </div>
    `;
    rankList.appendChild(div);
  });

  UI.initTilt();

  const impactBtn = el("rankImpactBtn");
  const sensBtn = el("rankSensBtn");
  const activeCls = "bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-soft3d";
  const idleCls = "text-slate-700 dark:text-slate-200 hover:bg-slate-900/5 dark:hover:bg-white/5";
  impactBtn.className = `px-3 py-1.5 text-sm rounded-lg transition ${state.rankMode === "impact" ? activeCls : idleCls}`;
  sensBtn.className = `px-3 py-1.5 text-sm rounded-lg transition ${state.rankMode === "sensitivity" ? activeCls : idleCls}`;
}

function renderAll() {
  const rowsFiltered = Utils.applyFilters(state.data.rows);
  const kpi = Utils.summarize(rowsFiltered);

  buildKPIs(kpi);
  renderActiveChips();
  renderExecutive(rowsFiltered);
  renderCanal(rowsFiltered);
  renderMensual(rowsFiltered);
  renderSucursal(rowsFiltered);
  resizeChartsSoon();
}

/* ===== Filters & events ===== */
function setupFilters() {
  const rows = state.data.rows;

  const sucursales = ["Todas", ...Utils.uniq(rows.map((r) => r.sucursal)).sort()];
  const meses = ["Todos", ...Utils.uniq(rows.map((r) => r.mes))];
  const canales = ["Todos", ...Utils.uniq(rows.map((r) => r.canal)).sort()];

  const fill = (select, values) => {
    select.innerHTML = "";
    for (const v of values) {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      select.appendChild(opt);
    }
  };

  fill(el("fSucursal"), sucursales);
  fill(el("fMes"), meses);
  fill(el("fCanal"), canales);

  el("fSucursal").addEventListener("change", (e) => { state.filters.sucursal = e.target.value; renderAll(); });
  el("fMes").addEventListener("change", (e) => { state.filters.mes = e.target.value; renderAll(); });
  el("fCanal").addEventListener("change", (e) => { state.filters.canal = e.target.value; renderAll(); });
  el("fSearch").addEventListener("input", (e) => { state.filters.search = e.target.value; renderAll(); });

  el("btnReset").addEventListener("click", () => {
    state.filters = { sucursal: "Todas", mes: "Todos", canal: "Todos", search: "" };
    el("fSucursal").value = "Todas";
    el("fMes").value = "Todos";
    el("fCanal").value = "Todos";
    el("fSearch").value = "";
    renderAll();
    UI.toast("Filtros reseteados");
  });

  el("toggleView").addEventListener("click", () => {
    state.viewMode = state.viewMode === "money" ? "pct" : "money";
    el("toggleView").textContent = `Ver: ${state.viewMode === "money" ? "$" : "%"}`;
    renderAll();
    UI.toast(state.viewMode === "money" ? "Vista: $ (impacto)" : "Vista: % (proporción)");
  });

  el("btnExportJSON").addEventListener("click", () => {
    const rowsFiltered = Utils.applyFilters(state.data.rows);
    Utils.downloadBlob(
      "vista_derivada.json",
      new Blob([JSON.stringify({ meta: state.data.meta, filters: state.filters, rows: rowsFiltered }, null, 2)], { type: "application/json" })
    );
    UI.toast("Export JSON listo");
  });

  el("btnExportCSV").addEventListener("click", () => {
    const rowsFiltered = Utils.applyFilters(state.data.rows);
    Utils.downloadBlob(
      "vista_derivada.csv",
      new Blob([Utils.toCSV(rowsFiltered)], { type: "text/csv;charset=utf-8" })
    );
    UI.toast("Export CSV listo");
  });

  document.querySelectorAll("[data-sort]").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.getAttribute("data-sort");
      if (state.sort.key === key) state.sort.dir = state.sort.dir === "asc" ? "desc" : "asc";
      else { state.sort.key = key; state.sort.dir = "desc"; }
      renderAll();
    });
  });

  el("rankImpactBtn")?.addEventListener("click", () => { state.rankMode = "impact"; renderAll(); });
  el("rankSensBtn")?.addEventListener("click", () => { state.rankMode = "sensitivity"; renderAll(); });
}

/* ===== Main ===== */
async function main() {
  Charts.registerPlugins();
  initTheme();
  setupResponsiveDetails();

  state.data = await Data.fetchJSON(DATA_URL);

  const d = Utils.safeParseGeneratedAt(state.data?.meta?.generated_at);
  const pretty = d ? d.toLocaleString("es-MX") : "—";
  el("lastRefresh").textContent = pretty;
  el("dataVersion").textContent = pretty;
  el("footerYear").textContent = String(new Date().getFullYear());

  setupFilters();
  Charts.applyGlobalTheme();

  renderAll();
  renderScatter();
  renderDrilldown();

  UI.initTilt();
  resizeChartsSoon();
}

main().catch((err) => {
  console.error(err);
  alert(`Error: ${err.message}`);
});
