// /app.js
/**
 * Dashboard read-only (solo lectura) para pricing uplift (ejecutivo).
 * Fuente: /exports/derived_jan_may_2025_2026.json (vistas derivadas)
 */

const READ_ONLY_MODE = true;
const DATA_URL = "./exports/derived_jan_may_2025_2026.json";

const state = {
  data: null,
  viewMode: "money", // money | pct
  filters: { sucursal: "Todas", mes: "Todos", canal: "Todos", search: "" },
  sort: { key: "diferencial", dir: "desc" },
  charts: { canal: null, mensual: null, scatter: null },
};

function assertReadOnlyFetch(options = {}) {
  const method = (options.method || "GET").toUpperCase();
  if (READ_ONLY_MODE && method !== "GET") {
    throw new Error(`READ_ONLY_MODE: método bloqueado (${method}).`);
  }
}

async function fetchJSON(url, options = {}) {
  assertReadOnlyFetch(options);
  const res = await fetch(url, { method: "GET", ...options });
  if (!res.ok) throw new Error(`No se pudo cargar data (${res.status})`);
  return res.json();
}

function safeParseGeneratedAt(value) {
  if (!value) return null;
  // Recorta microsegundos a milisegundos y normaliza +00:00 -> Z (compatibilidad)
  let v = String(value).replace(/(\.\d{3})\d+/, "$1").replace(/\+00:00$/, "Z");
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatMoney(n) {
  const v = Number(n || 0);
  return v.toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });
}

function formatPct(p) {
  const v = Number(p || 0);
  return `${v.toFixed(1)}%`;
}

function uniq(arr) {
  return [...new Set(arr)];
}

function el(id) {
  return document.getElementById(id);
}

function downloadBlob(filename, blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function toCSV(rows) {
  const cols = Object.keys(rows[0] || {});
  const esc = (v) => {
    const s = String(v ?? "");
    if (/[",\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
    return s;
  };
  const lines = [cols.join(",")];
  for (const r of rows) lines.push(cols.map((c) => esc(r[c])).join(","));
  return lines.join("\n");
}

function applyFilters(rows) {
  const { sucursal, mes, canal, search } = state.filters;
  const q = (search || "").trim().toLowerCase();

  return rows.filter((r) => {
    if (sucursal !== "Todas" && r.sucursal !== sucursal) return false;
    if (mes !== "Todos" && r.mes !== mes) return false;
    if (canal !== "Todos" && r.canal !== canal) return false;
    if (q && !String(r.sucursal).toLowerCase().includes(q)) return false;
    return true;
  });
}

function summarize(rows) {
  const sum = (key) => rows.reduce((a, r) => a + Number(r[key] || 0), 0);
  const venta_2025 = sum("venta_2025");
  const venta_2026 = sum("venta_2026");
  const diferencial = sum("diferencial");
  const uplift_pct = venta_2025 > 0 ? (diferencial / venta_2025) * 100 : 0;
  return { venta_2025, venta_2026, diferencial, uplift_pct };
}

function groupBy(rows, key) {
  const m = new Map();
  for (const r of rows) {
    const k = r[key];
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
}

function badgePct(p) {
  const v = Number(p || 0);
  // Neutral, pero con lectura rápida
  const base =
    "inline-flex items-center justify-end rounded-full px-2 py-0.5 text-xs font-medium ring-1 ";
  if (v >= 8) return `${base} bg-rose-500/10 text-rose-700 ring-rose-200 dark:text-rose-200 dark:ring-rose-500/30`;
  if (v >= 5) return `${base} bg-emerald-500/10 text-emerald-700 ring-emerald-200 dark:text-emerald-200 dark:ring-emerald-500/30`;
  return `${base} bg-slate-500/10 text-slate-700 ring-slate-200 dark:text-slate-200 dark:ring-slate-500/30`;
}

function badgeMix(p) {
  const v = Number(p || 0);
  const base =
    "inline-flex items-center justify-end rounded-full px-2 py-0.5 text-xs font-medium ring-1 bg-white/60 dark:bg-slate-950/30 ring-slate-200 dark:ring-slate-700";
  const mark = v >= 40 ? " font-semibold" : "";
  return base + mark;
}

function buildKPIs(kpi) {
  const cards = [
    { label: "Venta 2025", value: formatMoney(kpi.venta_2025), hint: "Base (precio actual)" },
    { label: "Venta 2026", value: formatMoney(kpi.venta_2026), hint: "Precio nuevo (mismo volumen)" },
    { label: "Diferencial", value: formatMoney(kpi.diferencial), hint: "Uplift $ por precio" },
    { label: "Uplift %", value: formatPct(kpi.uplift_pct), hint: "Diferencial / Venta 2025" },
  ];

  const container = el("kpiCards");
  container.innerHTML = "";

  for (const c of cards) {
    const div = document.createElement("div");
    div.className =
      "bg-white/80 dark:bg-slate-950/30 ring-1 ring-slate-200 dark:ring-slate-700 rounded-2xl shadow-soft3d p-4 hover:-translate-y-0.5 hover:shadow-lg transition";
    div.innerHTML = `
      <div class="text-xs text-slate-600 dark:text-slate-300">${c.label}</div>
      <div class="mt-1 text-2xl font-semibold tracking-tight">${c.value}</div>
      <div class="mt-1 text-xs text-slate-500 dark:text-slate-400">${c.hint}</div>
    `;
    container.appendChild(div);
  }
}

function renderActiveChips() {
  const chips = el("activeChips");
  chips.innerHTML = "";

  const pushChip = (label, value, onClear) => {
    if (!value) return;
    const btn = document.createElement("button");
    btn.className =
      "text-xs rounded-full px-3 py-1 bg-white/70 dark:bg-slate-950/30 ring-1 ring-slate-200 dark:ring-slate-700 hover:-translate-y-0.5 transition";
    btn.title = "Click para quitar";
    btn.innerHTML = `<span class="text-slate-600 dark:text-slate-300">${label}:</span> <span class="font-medium">${value}</span> <span class="ml-1 opacity-70">×</span>`;
    btn.addEventListener("click", onClear);
    chips.appendChild(btn);
  };

  if (state.filters.sucursal !== "Todas") {
    pushChip("Sucursal", state.filters.sucursal, () => {
      state.filters.sucursal = "Todas";
      el("fSucursal").value = "Todas";
      renderAll();
    });
  }
  if (state.filters.mes !== "Todos") {
    pushChip("Mes", state.filters.mes, () => {
      state.filters.mes = "Todos";
      el("fMes").value = "Todos";
      renderAll();
    });
  }
  if (state.filters.canal !== "Todos") {
    pushChip("Canal", state.filters.canal, () => {
      state.filters.canal = "Todos";
      el("fCanal").value = "Todos";
      renderAll();
    });
  }
  if (state.filters.search.trim()) {
    pushChip("Buscar", state.filters.search.trim(), () => {
      state.filters.search = "";
      el("fSearch").value = "";
      renderAll();
    });
  }

  if (!chips.children.length) {
    const span = document.createElement("span");
    span.className = "text-xs text-slate-500 dark:text-slate-400";
    span.textContent = "Ninguno (vista global)";
    chips.appendChild(span);
  }
}

function zebraify(tbodyId) {
  const tbody = el(tbodyId);
  if (tbody) tbody.classList.add("zebra");
}

function renderCanal(rows) {
  const m = groupBy(rows, "canal");
  const channels = [...m.keys()].sort();
  const agg = channels.map((c) => ({ canal: c, ...summarize(m.get(c)) }));
  const total = summarize(rows);

  const tbody = el("tblCanal");
  tbody.innerHTML = "";

  for (const a of agg) {
    const contrib = total.diferencial > 0 ? (a.diferencial / total.diferencial) * 100 : 0;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="py-2 font-medium">${a.canal}</td>
      <td class="py-2 text-right tabular-nums">${formatMoney(a.venta_2025)}</td>
      <td class="py-2 text-right tabular-nums">${formatMoney(a.diferencial)}</td>
      <td class="py-2 text-right tabular-nums"><span class="${badgePct(a.uplift_pct)}">${formatPct(a.uplift_pct)}</span></td>
      <td class="py-2 text-right tabular-nums">${formatPct(contrib)}</td>
    `;
    tbody.appendChild(tr);
  }

  zebraify("tblCanal");

  const labels = agg.map((a) => a.canal);
  const values = agg.map((a) => a.diferencial);

  if (state.charts.canal) state.charts.canal.destroy();
  state.charts.canal = new Chart(el("chartCanal"), {
    type: "doughnut",
    data: { labels, datasets: [{ data: values }] },
    options: {
      responsive: true,
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 12 } },
        tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${formatMoney(ctx.raw)}` } },
      },
      cutout: "68%",
    },
  });
}

function renderMensual(rows) {
  const m = groupBy(rows, "mes");
  const order = ["Enero", "Febrero", "Marzo", "Abril", "Mayo"];
  const months = order.filter((x) => m.has(x));
  const agg = months.map((mes) => ({ mes, ...summarize(m.get(mes)) }));

  const tbody = el("tblMensual");
  tbody.innerHTML = "";

  for (const a of agg) {
    const isMay = a.mes === "Mayo";
    const tr = document.createElement("tr");
    tr.className = isMay ? "bg-slate-900/5 dark:bg-white/5" : "";
    tr.innerHTML = `
      <td class="py-2 font-medium">${a.mes}${isMay ? " · ★" : ""}</td>
      <td class="py-2 text-right tabular-nums">${formatMoney(a.venta_2025)}</td>
      <td class="py-2 text-right tabular-nums">${formatMoney(a.diferencial)}</td>
      <td class="py-2 text-right tabular-nums"><span class="${badgePct(a.uplift_pct)}">${formatPct(a.uplift_pct)}</span></td>
    `;
    tbody.appendChild(tr);
  }

  zebraify("tblMensual");

  const labels = agg.map((a) => a.mes);
  const dif = agg.map((a) => a.diferencial);
  const uplift = agg.map((a) => a.uplift_pct);

  if (state.charts.mensual) state.charts.mensual.destroy();
  state.charts.mensual = new Chart(el("chartMensual"), {
    data: {
      labels,
      datasets: [
        { type: "bar", label: "Diferencial $", data: dif, yAxisID: "y" },
        { type: "line", label: "Uplift %", data: uplift, yAxisID: "y1", tension: 0.3 },
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { position: "bottom", labels: { boxWidth: 12 } } },
      scales: {
        y: { ticks: { callback: (v) => formatMoney(v) } },
        y1: {
          position: "right",
          grid: { drawOnChartArea: false },
          ticks: { callback: (v) => formatPct(v) },
        },
      },
    },
  });
}

function renderSucursal(rows) {
  const m = groupBy(rows, "sucursal");
  const agg = [...m.entries()].map(([sucursal, rs]) => {
    const s = summarize(rs);
    const uberVenta = rs
      .filter((r) => r.canal === "UBER")
      .reduce((a, r) => a + Number(r.venta_2025 || 0), 0);
    const mixUber = s.venta_2025 > 0 ? (uberVenta / s.venta_2025) * 100 : 0;
    return { sucursal, venta_2025: s.venta_2025, diferencial: s.diferencial, uplift_pct: s.uplift_pct, mix_uber_2025: mixUber };
  });

  const { key, dir } = state.sort;
  agg.sort((a, b) => {
    const va = a[key];
    const vb = b[key];
    const cmp = typeof va === "string" ? va.localeCompare(vb) : va - vb;
    return dir === "asc" ? cmp : -cmp;
  });

  const tbody = el("tblSucursal");
  tbody.innerHTML = "";

  agg.forEach((a, idx) => {
    const rank = idx + 1;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="py-2 font-medium">
        <span class="inline-flex items-center justify-center w-6 h-6 rounded-full text-xs mr-2 ring-1 ring-slate-200 dark:ring-slate-700 bg-white/70 dark:bg-slate-950/30">${rank}</span>
        ${a.sucursal}
      </td>
      <td class="py-2 text-right tabular-nums">${formatMoney(a.venta_2025)}</td>
      <td class="py-2 text-right tabular-nums">${formatMoney(a.diferencial)}</td>
      <td class="py-2 text-right tabular-nums"><span class="${badgePct(a.uplift_pct)}">${formatPct(a.uplift_pct)}</span></td>
      <td class="py-2 text-right tabular-nums"><span class="${badgeMix(a.mix_uber_2025)}">${formatPct(a.mix_uber_2025)}</span></td>
    `;
    tbody.appendChild(tr);
  });

  zebraify("tblSucursal");
}

function renderScatterFromGlobal() {
  const branches = state.data.sucursales || [];
  const points = branches.map((b) => ({ x: b.mix_uber_2025, y: b.uplift_pct, label: b.sucursal }));

  const medX = state.data.scatter?.median_mix_uber ?? 0;
  const medY = state.data.scatter?.median_uplift ?? 0;

  el("corrTxt").textContent = String(state.data.scatter?.corr_mix_uber_uplift ?? "—");

  if (state.charts.scatter) state.charts.scatter.destroy();
  state.charts.scatter = new Chart(el("chartScatter"), {
    type: "scatter",
    data: {
      datasets: [
        { label: "Sucursales", data: points, parsing: false, pointRadius: 5 },
        { label: "Mediana mix", data: [{ x: medX, y: 0 }, { x: medX, y: 20 }], type: "line", pointRadius: 0, borderWidth: 1 },
        { label: "Mediana uplift", data: [{ x: 0, y: medY }, { x: 100, y: medY }], type: "line", pointRadius: 0, borderWidth: 1 },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 12 } },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const p = ctx.raw;
              if (p.label) return `${p.label}: mix ${formatPct(p.x)} · uplift ${formatPct(p.y)}`;
              return ctx.dataset.label;
            },
          },
        },
      },
      scales: {
        x: { title: { display: true, text: "Mix UBER (Venta 2025 %)" }, ticks: { callback: (v) => formatPct(v) } },
        y: { title: { display: true, text: "Uplift % (Jan–May)" }, ticks: { callback: (v) => formatPct(v) }, suggestedMin: 0 },
      },
    },
  });
}

function renderDrilldown() {
  const tbody = el("tblDrill");
  tbody.innerHTML = "";
  for (const r of state.data.drilldown || []) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="py-2">${r.mes}</td>
      <td class="py-2 font-medium">${r.canal}</td>
      <td class="py-2 font-medium">${r.sucursal}</td>
      <td class="py-2 text-right tabular-nums">${formatMoney(r.venta_2025)}</td>
      <td class="py-2 text-right tabular-nums">${formatMoney(r.diferencial)}</td>
      <td class="py-2 text-right tabular-nums"><span class="${badgePct(r.uplift_pct)}">${formatPct(r.uplift_pct)}</span></td>
    `;
    tbody.appendChild(tr);
  }
  zebraify("tblDrill");
}

function setupFilters() {
  const rows = state.data.rows;

  const sucursales = ["Todas", ...uniq(rows.map((r) => r.sucursal)).sort()];
  const meses = ["Todos", ...uniq(rows.map((r) => r.mes))];
  const canales = ["Todos", ...uniq(rows.map((r) => r.canal)).sort()];

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

  el("fSearch").addEventListener("input", (e) => {
    state.filters.search = e.target.value;
    renderAll();
  });

  el("btnReset").addEventListener("click", () => {
    state.filters = { sucursal: "Todas", mes: "Todos", canal: "Todos", search: "" };
    el("fSucursal").value = "Todas";
    el("fMes").value = "Todos";
    el("fCanal").value = "Todos";
    el("fSearch").value = "";
    renderAll();
  });

  el("toggleView").addEventListener("click", () => {
    state.viewMode = state.viewMode === "money" ? "pct" : "money";
    el("toggleView").textContent = `Ver: ${state.viewMode === "money" ? "$" : "%"}`;
  });

  el("btnExportJSON").addEventListener("click", () => {
    const rowsFiltered = applyFilters(state.data.rows);
    const payload = { meta: state.data.meta, filters: state.filters, rows: rowsFiltered };
    downloadBlob("vista_derivada.json", new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
  });

  el("btnExportCSV").addEventListener("click", () => {
    const rowsFiltered = applyFilters(state.data.rows);
    downloadBlob("vista_derivada.csv", new Blob([toCSV(rowsFiltered)], { type: "text/csv;charset=utf-8" }));
  });

  document.querySelectorAll("[data-sort]").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.getAttribute("data-sort");
      if (state.sort.key === key) state.sort.dir = state.sort.dir === "asc" ? "desc" : "asc";
      else { state.sort.key = key; state.sort.dir = "desc"; }
      renderAll();
    });
  });
}

function initTheme() {
  const root = document.documentElement;
  const saved = localStorage.getItem("theme"); // 'dark' | 'light' | null
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const theme = saved || (prefersDark ? "dark" : "light");

  const apply = (t) => {
    if (t === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
    localStorage.setItem("theme", t);
    const label = document.getElementById("themeLabel");
    if (label) label.textContent = t === "dark" ? "Oscuro" : "Claro";
  };

  apply(theme);

  const btn = document.getElementById("themeToggle");
  if (btn) {
    btn.addEventListener("click", () => {
      const now = root.classList.contains("dark") ? "dark" : "light";
      apply(now === "dark" ? "light" : "dark");
    });
  }
}

function renderAll() {
  const rowsFiltered = applyFilters(state.data.rows);
  const kpi = summarize(rowsFiltered);

  buildKPIs(kpi);
  renderActiveChips();
  renderCanal(rowsFiltered);
  renderMensual(rowsFiltered);
  renderSucursal(rowsFiltered);
}

async function main() {
  initTheme();

  state.data = await fetchJSON(DATA_URL);

  const generatedAtRaw = state.data?.meta?.generated_at;
  const d = safeParseGeneratedAt(generatedAtRaw);
  const pretty = d ? d.toLocaleString("es-MX") : "—";

  el("lastRefresh").textContent = pretty;
  const dv = document.getElementById("dataVersion");
  if (dv) dv.textContent = pretty;

  setupFilters();
  renderAll();
  renderScatterFromGlobal();
  renderDrilldown();
}

main().catch((err) => {
  console.error(err);
  alert(`Error: ${err.message}`);
});
