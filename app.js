import {
  DATA_URL,
  SITE_AUDIT_DERIVED_URL,
  THRESH_DARK_KITCHEN,
  THRESH_MIX_UBER_ALTO,
  THRESH_UPLIFT_RED,
} from "./modules/config.js";
import {
  applyFilters,
  debounce,
  fetchJSON,
  getFilterKey,
  groupBy,
  normalizeData,
  safeParseGeneratedAt,
  summarize,
  toCSV,
  downloadBlob,
  uniq,
} from "./modules/data.js";
import {
  badgeChip,
  badgePct,
  chip,
  formatDateShort,
  formatMoney,
  formatPct,
  fmtMs,
  safeStr,
} from "./modules/format.js";
import { el, renderEmptyRow, setAriaSort, zebraify } from "./modules/dom.js";

const state = {
  data: null,
  siteAudit: null,
  viewMode: "money",
  rankMode: "impact",
  filters: { sucursal: "Todas", mes: "Todos", canal: "Todos", search: "" },
  sort: { key: "diferencial", dir: "desc" },
  charts: { canal: null, mensual: null, scatter: null },
  cache: { key: "", rows: [] },
};

function getFilteredRows() {
  if (!state.data?.rows) return [];
  const key = getFilterKey(state.filters);
  if (state.cache.key === key) return state.cache.rows;
  const rows = applyFilters(state.data.rows, state.filters);
  state.cache = { key, rows };
  return rows;
}

function setViewMode(mode) {
  state.viewMode = mode;
  document.documentElement.dataset.view = mode;
  const btn = el("toggleView");
  if (!btn) return;
  const label = mode === "money" ? "$" : "%";
  btn.textContent = `Ver: ${label}`;
  btn.setAttribute("aria-pressed", mode === "pct" ? "true" : "false");
  btn.setAttribute(
    "aria-label",
    mode === "pct" ? "Ver porcentajes" : "Ver montos"
  );
}

function applyBranchFilter(sucursal) {
  if (!sucursal) return;
  const next = state.filters.sucursal === sucursal ? "Todas" : sucursal;
  state.filters.sucursal = next;
  const select = el("fSucursal");
  if (select) select.value = next;
  renderAll();
}

function initTilt() {
  const tiltItems = document.querySelectorAll("[data-tilt]");
  if (!tiltItems.length) return;
  const canHover = window.matchMedia("(hover: hover)").matches;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)")
    .matches;
  if (!canHover || reducedMotion) return;

  const start = () => {
    if (!window.VanillaTilt) return;
    window.VanillaTilt.init(tiltItems, {
      max: 6,
      speed: 400,
      glare: false,
      scale: 1.01,
    });
  };

  if (window.VanillaTilt) start();
  else window.addEventListener("load", start, { once: true });
}
/* ===== Responsive accordions ===== */
function resizeChartsSoon() {
  requestAnimationFrame(() => {
    Object.values(state.charts).forEach((c) => {
      try {
        c?.resize?.();
      } catch {}
    });
  });
}

function setupResponsiveDetails() {
  const mq = window.matchMedia("(min-width: 640px)");
  const details = Array.from(
    document.querySelectorAll("details[data-responsive]")
  );

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

/* ===== Theme (FIX: NO render antes de data) ===== */
function initTheme() {
  const root = document.documentElement;
  const saved = localStorage.getItem("theme");
  const toggle = el("themeToggle");
  const prefersDark =
    window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  const theme = saved || (prefersDark ? "dark" : "light");

  const apply = (t) => {
    if (t === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
    localStorage.setItem("theme", t);
    el("themeLabel").textContent = t === "dark" ? "Oscuro" : "Claro";
    toggle?.setAttribute("aria-pressed", t === "dark" ? "true" : "false");
    toggle?.setAttribute(
      "aria-label",
      t === "dark" ? "Tema oscuro" : "Tema claro"
    );

    // Nota: si aún no hay data, no renderizamos nada.
    if (state.data?.rows) {
      renderAll();
      renderScatterFromGlobal();
      resizeChartsSoon();
    }
  };

  apply(theme);
  toggle?.addEventListener("click", () => {
    const now = root.classList.contains("dark") ? "dark" : "light";
    apply(now === "dark" ? "light" : "dark");
  });
}

/* ===== Rendering ===== */
function buildKPIs(kpi) {
  const cards = [
    {
      label: "Venta 2025",
      value: formatMoney(kpi.venta_2025),
      hint: "Base (precio actual)",
    },
    {
      label: "Venta 2026",
      value: formatMoney(kpi.venta_2026),
      hint: "Precio nuevo (mismo volumen)",
    },
    {
      label: "Diferencial",
      value: formatMoney(kpi.diferencial),
      hint: "Uplift $ por precio",
    },
    {
      label: "Uplift %",
      value: formatPct(kpi.uplift_pct),
      hint: "Diferencial / Venta 2025",
    },
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
    btn.type = "button";
    btn.className =
      "text-xs rounded-full px-3 py-1 bg-white/70 dark:bg-slate-950/30 ring-1 ring-slate-200 dark:ring-slate-700 hover:-translate-y-0.5 transition";
    btn.title = "Click para quitar";
    btn.innerHTML = `<span class="text-slate-600 dark:text-slate-300">${label}:</span> <span class="font-medium">${value}</span> <span class="ml-1 opacity-70">×</span>`;
    btn.addEventListener("click", onClear);
    chips.appendChild(btn);
  };

  if (state.filters.sucursal !== "Todas")
    pushChip("Sucursal", state.filters.sucursal, () => {
      state.filters.sucursal = "Todas";
      el("fSucursal").value = "Todas";
      renderAll();
    });
  if (state.filters.mes !== "Todos")
    pushChip("Mes", state.filters.mes, () => {
      state.filters.mes = "Todos";
      el("fMes").value = "Todos";
      renderAll();
    });
  if (state.filters.canal !== "Todos")
    pushChip("Canal", state.filters.canal, () => {
      state.filters.canal = "Todos";
      el("fCanal").value = "Todos";
      renderAll();
    });
  if (state.filters.search.trim())
    pushChip("Buscar", state.filters.search.trim(), () => {
      state.filters.search = "";
      el("fSearch").value = "";
      renderAll();
    });

  if (!chips.children.length) {
    const span = document.createElement("span");
    span.className = "text-xs text-slate-500 dark:text-slate-400";
    span.textContent = "Ninguno (vista global)";
    chips.appendChild(span);
  }
}

function renderCanal(rows) {
  const m = groupBy(rows, "canal");
  const channels = [...m.keys()].sort();
  const total = summarize(rows);
  const agg = channels.map((c) => {
    const s = summarize(m.get(c));
    const contrib =
      total.diferencial > 0 ? (s.diferencial / total.diferencial) * 100 : 0;
    return { canal: c, contrib_uplift_pct: contrib, ...s };
  });

  const tbody = el("tblCanal");
  tbody.innerHTML = "";

  if (!agg.length) {
    renderEmptyRow(tbody, 5, "Sin datos para los filtros actuales.");
    if (state.charts.canal) {
      state.charts.canal.data.labels = [];
      state.charts.canal.data.datasets[0].data = [];
      state.charts.canal.update();
    }
    return;
  }

  for (const a of agg) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="py-2 px-3 font-medium">${a.canal}</td>
      <td class="py-2 px-3 text-right tabular-nums">${formatMoney(
        a.venta_2025
      )}</td>
      <td class="py-2 px-3 text-right tabular-nums">${formatMoney(
        a.diferencial
      )}</td>
      <td class="py-2 px-3 text-right tabular-nums"><span class="${badgePct(
        a.uplift_pct,
        THRESH_UPLIFT_RED
      )}">${formatPct(a.uplift_pct)}</span></td>
      <td class="py-2 px-3 text-right tabular-nums">${formatPct(
        a.contrib_uplift_pct
      )}</td>
    `;
    tbody.appendChild(tr);
  }
  zebraify("tblCanal");

  const labels = agg.map((a) => a.canal);
  const isPctView = state.viewMode === "pct";
  const values = isPctView
    ? agg.map((a) => a.contrib_uplift_pct)
    : agg.map((a) => a.diferencial);
  const formatter = isPctView ? formatPct : formatMoney;

  if (state.charts.canal) {
    state.charts.canal.data.labels = labels;
    state.charts.canal.data.datasets[0].data = values;
    state.charts.canal.data.datasets[0].label = isPctView
      ? "Contribución %"
      : "Diferencial $";
    state.charts.canal.options.plugins.tooltip = {
      callbacks: {
        label: (ctx) =>
          `${ctx.label}: ${formatter(ctx.parsed ?? ctx.raw ?? 0)}`,
      },
    };
    state.charts.canal.update();
    return;
  }

  state.charts.canal = new Chart(el("chartCanal"), {
    type: "doughnut",
    data: { labels, datasets: [{ data: values }] },
    options: {
      responsive: true,
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 12 } },
        tooltip: {
          callbacks: {
            label: (ctx) =>
              `${ctx.label}: ${formatter(ctx.parsed ?? ctx.raw ?? 0)}`,
          },
        },
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

  if (!agg.length) {
    renderEmptyRow(tbody, 4, "Sin datos para los filtros actuales.");
    if (state.charts.mensual) {
      state.charts.mensual.data.labels = [];
      state.charts.mensual.data.datasets = [];
      state.charts.mensual.update();
    }
    return;
  }

  for (const a of agg) {
    const isMay = a.mes === "Mayo";
    const tr = document.createElement("tr");
    tr.className = isMay ? "bg-slate-900/5 dark:bg-white/5" : "";
    tr.innerHTML = `
      <td class="py-2 px-3 font-medium">${a.mes}${isMay ? " · ★" : ""}</td>
      <td class="py-2 px-3 text-right tabular-nums">${formatMoney(
        a.venta_2025
      )}</td>
      <td class="py-2 px-3 text-right tabular-nums">${formatMoney(
        a.diferencial
      )}</td>
      <td class="py-2 px-3 text-right tabular-nums"><span class="${badgePct(
        a.uplift_pct,
        THRESH_UPLIFT_RED
      )}">${formatPct(a.uplift_pct)}</span></td>
    `;
    tbody.appendChild(tr);
  }
  zebraify("tblMensual");

  const labels = agg.map((a) => a.mes);
  const dif = agg.map((a) => a.diferencial);
  const uplift = agg.map((a) => a.uplift_pct);
  const primaryIsPct = state.viewMode === "pct";
  const barData = primaryIsPct ? uplift : dif;
  const lineData = primaryIsPct ? dif : uplift;

  const datasets = [
    {
      type: "bar",
      label: primaryIsPct ? "Uplift %" : "Diferencial $",
      data: barData,
      yAxisID: "y",
    },
    {
      type: "line",
      label: primaryIsPct ? "Diferencial $" : "Uplift %",
      data: lineData,
      yAxisID: "y1",
      tension: 0.3,
    },
  ];

  const options = {
    responsive: true,
    plugins: { legend: { position: "bottom", labels: { boxWidth: 12 } } },
    scales: {
      y: {
        title: {
          display: true,
          text: primaryIsPct ? "Uplift %" : "Diferencial $",
        },
        ticks: {
          callback: (v) => (primaryIsPct ? formatPct(v) : formatMoney(v)),
        },
      },
      y1: {
        position: "right",
        grid: { drawOnChartArea: false },
        title: {
          display: true,
          text: primaryIsPct ? "Diferencial $" : "Uplift %",
        },
        ticks: {
          callback: (v) => (primaryIsPct ? formatMoney(v) : formatPct(v)),
        },
      },
    },
  };

  if (state.charts.mensual) {
    state.charts.mensual.data.labels = labels;
    state.charts.mensual.data.datasets = datasets;
    state.charts.mensual.options = options;
    state.charts.mensual.update();
    return;
  }

  state.charts.mensual = new Chart(el("chartMensual"), {
    data: { labels, datasets },
    options,
  });
}

function buildBranchAgg(rows) {
  const m = groupBy(rows, "sucursal");
  const total = summarize(rows);

  const agg = [...m.entries()].map(([sucursal, rs]) => {
    const s = summarize(rs);
    const uberVenta = rs
      .filter((r) => r.canal === "UBER")
      .reduce((a, r) => a + Number(r.venta_2025 || 0), 0);
    const mixUber = s.venta_2025 > 0 ? (uberVenta / s.venta_2025) * 100 : 0;
    const contribUplift =
      total.diferencial > 0 ? (s.diferencial / total.diferencial) * 100 : 0;

    const rsUber = rs.filter((r) => r.canal === "UBER");
    const rsSalon = rs.filter((r) => r.canal === "SALON");
    const uUber = rsUber.length ? summarize(rsUber).uplift_pct : null;
    const uSalon = rsSalon.length ? summarize(rsSalon).uplift_pct : null;
    const salonBeatsUber =
      uUber !== null && uSalon !== null ? uSalon > uUber : false;

    return {
      sucursal,
      venta_2025: s.venta_2025,
      diferencial: s.diferencial,
      uplift_pct: s.uplift_pct,
      mix_uber_2025: mixUber,
      contrib_uplift_pct: contribUplift,
      salon_beats_uber: salonBeatsUber,
    };
  });

  return { agg, total };
}

function classifyBranch(b, p75Venta) {
  if (b.mix_uber_2025 >= THRESH_DARK_KITCHEN)
    return { label: "Dark Kitchen", tone: "amber" };
  if (
    b.uplift_pct >= THRESH_UPLIFT_RED &&
    b.mix_uber_2025 >= THRESH_MIX_UBER_ALTO
  )
    return { label: "Riesgo", tone: "rose" };
  if (b.venta_2025 >= p75Venta)
    return { label: "Volumen crítico", tone: "emerald" };
  return { label: "Conservador", tone: "slate" };
}

function renderSucursal(rows) {
  const { agg } = buildBranchAgg(rows);

  const { key, dir } = state.sort;
  agg.sort((a, b) => {
    const va = a[key],
      vb = b[key];
    const cmp = typeof va === "string" ? va.localeCompare(vb) : va - vb;
    return dir === "asc" ? cmp : -cmp;
  });

  const tbody = el("tblSucursal");
  tbody.innerHTML = "";

  if (!agg.length) {
    renderEmptyRow(tbody, 5, "Sin datos para los filtros actuales.");
    return;
  }

  agg.forEach((a) => {
    const tr = document.createElement("tr");

    const nameTd = document.createElement("td");
    nameTd.className = "py-2 px-3 font-medium";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "w-full text-left hover:underline";
    btn.textContent = a.sucursal;
    btn.addEventListener("click", () => applyBranchFilter(a.sucursal));
    nameTd.appendChild(btn);
    tr.appendChild(nameTd);

    const ventaTd = document.createElement("td");
    ventaTd.className = "py-2 px-3 text-right tabular-nums";
    ventaTd.textContent = formatMoney(a.venta_2025);
    tr.appendChild(ventaTd);

    const difTd = document.createElement("td");
    difTd.className = "py-2 px-3 text-right tabular-nums";
    difTd.textContent = formatMoney(a.diferencial);
    tr.appendChild(difTd);

    const upliftTd = document.createElement("td");
    upliftTd.className = "py-2 px-3 text-right tabular-nums";
    const upliftBadge = document.createElement("span");
    upliftBadge.className = badgePct(a.uplift_pct, THRESH_UPLIFT_RED);
    upliftBadge.textContent = formatPct(a.uplift_pct);
    upliftTd.appendChild(upliftBadge);
    tr.appendChild(upliftTd);

    const mixTd = document.createElement("td");
    mixTd.className = "py-2 px-3 text-right tabular-nums";
    mixTd.textContent = formatPct(a.mix_uber_2025);
    tr.appendChild(mixTd);

    tbody.appendChild(tr);
  });
  zebraify("tblSucursal");
}

function renderScatterFromGlobal() {
  if (!state.data) return;

  const branches = state.data.sucursales || [];
  const points = branches.map((b) => ({
    x: b.mix_uber_2025,
    y: b.uplift_pct,
    label: b.sucursal,
  }));
  const medX = state.data.scatter?.median_mix_uber ?? 0;
  const medY = state.data.scatter?.median_uplift ?? 0;
  const corr =
    state.data.scatter?.corr_mix_uber_uplift ?? state.data.scatter?.corr ?? "-";

  el("corrTxt").textContent = String(corr);

  if (!points.length) {
    if (state.charts.scatter) {
      state.charts.scatter.data.datasets = [];
      state.charts.scatter.update();
    }
    return;
  }

  const maxX = Math.max(100, ...points.map((p) => p.x || 0));
  const maxY = Math.max(20, ...points.map((p) => p.y || 0));
  const datasets = [
    { label: "Sucursales", data: points, parsing: false, pointRadius: 5 },
    {
      label: "Mediana mix",
      data: [
        { x: medX, y: 0 },
        { x: medX, y: maxY },
      ],
      type: "line",
      pointRadius: 0,
      borderWidth: 1,
    },
    {
      label: "Mediana uplift",
      data: [
        { x: 0, y: medY },
        { x: maxX, y: medY },
      ],
      type: "line",
      pointRadius: 0,
      borderWidth: 1,
    },
  ];

  const options = {
    responsive: true,
    plugins: {
      legend: { position: "bottom", labels: { boxWidth: 12 } },
      tooltip: {
        callbacks: {
          label: (ctx) =>
            ctx.raw?.label
              ? `${ctx.raw.label}: mix ${formatPct(
                  ctx.raw.x
                )} → uplift ${formatPct(ctx.raw.y)}`
              : ctx.dataset.label,
        },
      },
    },
    scales: {
      x: {
        title: { display: true, text: "Mix UBER (Venta 2025 %)" },
        ticks: { callback: (v) => formatPct(v) },
      },
      y: {
        title: { display: true, text: "Uplift % (Enero–Mayo)" },
        ticks: { callback: (v) => formatPct(v) },
        suggestedMin: 0,
      },
    },
  };

  if (state.charts.scatter) {
    state.charts.scatter.data.datasets = datasets;
    state.charts.scatter.options = options;
    state.charts.scatter.update();
    return;
  }

  state.charts.scatter = new Chart(el("chartScatter"), {
    type: "scatter",
    data: { datasets },
    options,
  });
}
function renderSecurityPanel() {
  const audit = state.siteAudit;
  if (!audit) return;

  const o = audit.overview || {};
  const tls = audit.tls || {};
  const dns = audit.dns || {};
  const risks = Array.isArray(audit.risks) ? audit.risks : [];

  const statusTone =
    o.is_up && o.response_code && o.response_code < 400
      ? "emerald"
      : o.is_up
      ? "amber"
      : "rose";

  const statusTxt = o.is_up ? `UP ${safeStr(o.response_code)}` : "DOWN";
  const secStatusChip = el("secStatusChip");
  if (secStatusChip) secStatusChip.innerHTML = chip(statusTxt, statusTone);

  const set = (id, val) => {
    const n = el(id);
    if (n) n.textContent = val;
  };

  set("secServer", safeStr(o.server));
  set(
    "secHttp",
    `${safeStr(o.response_code)} · cache ${safeStr(o.cache_status)}`
  );
  set("secLatency", fmtMs(o.response_time_ms));
  set("secWaf", o.waf?.has_waf ? `Sí (${safeStr(o.waf?.vendor)})` : "No");
  set(
    "secHsts",
    o.hsts_header_present
      ? o.hsts_preload_compatible
        ? "Sí (preload ok)"
        : "Sí (sin preload)"
      : "No"
  );
  set("secCn", safeStr(tls.cn));
  set(
    "secValid",
    `${formatDateShort(tls.valid_from)} → ${formatDateShort(tls.valid_to)}`
  );

  const dnsAAAA = Array.isArray(dns.aaaa) ? dns.aaaa : [];
  const dnsSOA = Array.isArray(dns.soa) ? dns.soa : [];
  set("secA", safeStr(dns.a));
  set("secAAAA", dnsAAAA.length ? dnsAAAA.join(", ") : "—");
  set("secSOA", dnsSOA.length ? dnsSOA.join(", ") : "—");

  const ul = el("secRisks");
  const empty = el("secRisksEmpty");
  if (!ul || !empty) return;

  ul.innerHTML = "";
  const top = risks.slice(0, 6);
  if (!top.length) {
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  top.forEach((r) => {
    const tone =
      r.level === "high" ? "rose" : r.level === "med" ? "amber" : "slate";
    const li = document.createElement("li");
    li.className =
      "rounded-xl bg-white/60 dark:bg-slate-950/20 ring-1 ring-rose-200/60 dark:ring-rose-800/30 p-3";
    li.innerHTML = `
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <div class="font-semibold">${r.title}</div>
          <div class="text-xs opacity-90 mt-0.5">${safeStr(r.why)}</div>
          <div class="text-sm mt-2">${safeStr(r.action)}</div>
        </div>
        <div>${chip(r.level.toUpperCase(), tone)}</div>
      </div>
    `;
    ul.appendChild(li);
  });
}

function renderDrilldown() {
  if (!state.data) return;

  const tbody = el("tblDrill");
  tbody.innerHTML = "";
  const rows = state.data.drilldown || [];
  if (!rows.length) {
    renderEmptyRow(tbody, 6, "Sin datos para los filtros actuales.");
    return;
  }
  for (const r of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="py-2 px-3">${r.mes}</td>
      <td class="py-2 px-3 font-medium">${r.canal}</td>
      <td class="py-2 px-3 font-medium">${r.sucursal}</td>
      <td class="py-2 px-3 text-right tabular-nums">${formatMoney(
        r.venta_2025
      )}</td>
      <td class="py-2 px-3 text-right tabular-nums">${formatMoney(
        r.diferencial
      )}</td>
      <td class="py-2 px-3 text-right tabular-nums"><span class="${badgePct(
        r.uplift_pct,
        THRESH_UPLIFT_RED
      )}">${formatPct(r.uplift_pct)}</span></td>
    `;
    tbody.appendChild(tr);
  }
  zebraify("tblDrill");
}

/* ===== Executive ===== */
function renderExecutive(rows) {
  const { agg, total } = buildBranchAgg(rows);

  const list = el("redFlagsList");
  const empty = el("redFlagsEmpty");
  const ap = el("actionPlanList");
  const rankList = el("rankingList");

  if (!agg.length) {
    const concentration = el("concentrationTxt");
    if (concentration)
      concentration.textContent =
        "Concentración: sin datos para los filtros actuales.";
    if (list) list.innerHTML = "";
    if (empty) empty.classList.remove("hidden");
    if (ap) {
      ap.innerHTML = "";
      const div = document.createElement("div");
      div.className =
        "rounded-2xl bg-white/80 dark:bg-slate-950/30 ring-1 ring-slate-200 dark:ring-slate-700 p-4 text-sm text-slate-600 dark:text-slate-300";
      div.textContent = "Sin datos para los filtros actuales.";
      ap.appendChild(div);
    }
    if (rankList) {
      rankList.innerHTML = "";
      const div = document.createElement("div");
      div.className =
        "rounded-2xl bg-white/80 dark:bg-slate-950/30 ring-1 ring-slate-200 dark:ring-slate-700 p-4 text-sm text-slate-600 dark:text-slate-300";
      div.textContent = "Sin datos para los filtros actuales.";
      rankList.appendChild(div);
    }
    return;
  }

  const ventas = agg.map((a) => a.venta_2025).sort((a, b) => a - b);
  const p75Venta = ventas.length
    ? ventas[Math.floor(0.75 * (ventas.length - 1))]
    : 0;

  const topImpact = [...agg].sort((a, b) => b.diferencial - a.diferencial)[0];
  const topSens = [...agg].sort((a, b) => b.uplift_pct - a.uplift_pct)[0];
  const topMix = [...agg].sort((a, b) => b.mix_uber_2025 - a.mix_uber_2025)[0];

  const top5 = [...agg]
    .sort((a, b) => b.diferencial - a.diferencial)
    .slice(0, 5);
  const top5Pct =
    total.diferencial > 0
      ? (top5.reduce((s, x) => s + x.diferencial, 0) / total.diferencial) * 100
      : 0;
  const concentrationTxt = el("concentrationTxt");
  if (concentrationTxt)
    concentrationTxt.textContent = `Concentración: Top 5 explica ${formatPct(
      top5Pct
    )} del uplift total (${formatMoney(total.diferencial)}).`;

  const flags = [];
  const rowsUber = rows.filter((r) => r.canal === "UBER");
  const rowsMayUber = rows.filter(
    (r) => r.canal === "UBER" && r.mes === "Mayo"
  );
  if (rowsMayUber.length && rowsUber.length) {
    const uMay = summarize(rowsMayUber).uplift_pct;
    const uAll = summarize(rowsUber).uplift_pct;
    if (uMay >= uAll + 2 || uMay >= THRESH_UPLIFT_RED) {
      flags.push({
        title: "Mayo en UBER",
        body: `Uplift ${formatPct(uMay)} vs promedio UBER ${formatPct(
          uAll
        )} → auditar mix/campañas/operación.`,
      });
    }
  }
  if (topSens) {
    const risk =
      topSens.uplift_pct >= THRESH_UPLIFT_RED &&
      topSens.mix_uber_2025 >= THRESH_MIX_UBER_ALTO;
    flags.push({
      title: `${topSens.sucursal}`,
      body: `Uplift ${formatPct(topSens.uplift_pct)} con mix UBER ${formatPct(
        topSens.mix_uber_2025
      )} → ${risk ? "riesgo de elasticidad" : "sensibilidad elevada"}.`,
    });
  }
  if (topImpact && topImpact.contrib_uplift_pct >= 25) {
    flags.push({
      title: `Dependencia ${topImpact.sucursal}`,
      body: `Explica ${formatPct(
        topImpact.contrib_uplift_pct
      )} del uplift. Caída operativa pega al total.`,
    });
  }
  if (topMix && topMix.mix_uber_2025 >= THRESH_DARK_KITCHEN) {
    flags.push({
      title: "Mix digital extremo",
      body: `${topMix.sucursal}: mix UBER ${formatPct(
        topMix.mix_uber_2025
      )} → sensibilidad al canal digital.`,
    });
  }
  const weird = agg.find((a) => a.salon_beats_uber);
  if (weird)
    flags.push({
      title: "Caso raro SALON>UBER",
      body: `${weird.sucursal}: patrón inverso → revisar tickets/mix/producto/operación.`,
    });

  if (list) list.innerHTML = "";
  const shown = flags.slice(0, 4);
  if (!shown.length) empty?.classList.remove("hidden");
  else {
    empty?.classList.add("hidden");
    shown.forEach((f, i) => {
      const li = document.createElement("li");
      li.className = "leading-snug";
      li.innerHTML = `
        <div class="flex gap-2">
          <div class="min-w-[22px] text-rose-700 dark:text-rose-200 font-semibold">${
            i + 1
          }.</div>
          <div>
            <div class="font-semibold">${f.title}:</div>
            <div class="text-rose-900/90 dark:text-rose-100/90">${f.body}</div>
          </div>
        </div>
      `;
      list?.appendChild(li);
    });
  }

  const actions = [];
  if (shown.some((x) => x.title.includes("Mayo en UBER")))
    actions.push({
      title: "Auditoría de Mayo",
      body: "Validar lista de precios y ejecución digital. Confirmar que el salto es intencional.",
    });
  if (topSens)
    actions.push({
      title: `Monitoreo ${topSens.sucursal}`,
      body: "Semanas 1–4: seguimiento de transacciones/NPS. Si cae >5%, activar diagnóstico.",
    });
  if (topImpact)
    actions.push({
      title: `Defensa ${topImpact.sucursal}`,
      body: "Asegurar disponibilidad, tiempos y calidad. Priorizar operación para sostener el uplift.",
    });

  if (ap) ap.innerHTML = "";
  actions.slice(0, 3).forEach((a, idx) => {
    const div = document.createElement("div");
    div.className =
      "bg-white/80 dark:bg-slate-950/30 ring-1 ring-slate-200 dark:ring-slate-700 rounded-2xl p-4 shadow-soft3d";
    div.innerHTML = `
      <div class="flex items-start gap-3">
        <div class="mt-0.5 inline-flex items-center justify-center w-7 h-7 rounded-full bg-slate-900 text-white dark:bg-white dark:text-slate-900 text-xs font-semibold">${
          idx + 1
        }</div>
        <div>
          <div class="font-semibold">${a.title}</div>
          <div class="text-sm text-slate-600 dark:text-slate-300 mt-1">${
            a.body
          }</div>
        </div>
      </div>
    `;
    ap?.appendChild(div);
  });

  if (rankList) rankList.innerHTML = "";

  const sorted = [...agg]
    .sort((a, b) => {
      if (state.rankMode === "sensitivity") return b.uplift_pct - a.uplift_pct;
      return b.diferencial - a.diferencial;
    })
    .slice(0, 5);

  const maxVal = sorted.length
    ? Math.max(
        ...sorted.map((x) =>
          state.rankMode === "sensitivity" ? x.uplift_pct : x.diferencial
        )
      )
    : 0;

  sorted.forEach((b, i) => {
    const cls = classifyBranch(b, p75Venta);
    const val = state.rankMode === "sensitivity" ? b.uplift_pct : b.diferencial;
    const pctBar = maxVal > 0 ? (val / maxVal) * 100 : 0;

    const rightMain =
      state.rankMode === "sensitivity"
        ? `${formatPct(b.uplift_pct)}`
        : `${formatMoney(b.diferencial)} (${formatPct(b.uplift_pct)})`;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className =
      "rounded-2xl bg-white/80 dark:bg-slate-950/30 ring-1 ring-slate-200 dark:ring-slate-700 p-4 shadow-soft3d w-full text-left";
    btn.setAttribute("aria-label", `Filtrar por ${b.sucursal}`);
    btn.addEventListener("click", () => applyBranchFilter(b.sucursal));
    btn.innerHTML = `
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <span class="text-xs font-semibold text-slate-500 dark:text-slate-400">${
              i + 1
            }.</span>
            <span class="font-semibold truncate">${b.sucursal}</span>
            ${badgeChip(cls.label, cls.tone)}
            ${
              b.uplift_pct >= THRESH_UPLIFT_RED &&
              b.mix_uber_2025 >= THRESH_MIX_UBER_ALTO
                ? badgeChip("Alerta", "rose")
                : ""
            }
          </div>
          <div class="mt-2 h-2 w-full rounded-full bg-slate-200/70 dark:bg-slate-700/50 overflow-hidden">
            <div class="h-2 rounded-full bg-emerald-500/80" style="width:${pctBar.toFixed(
              1
            )}%"></div>
          </div>
        </div>

        <div class="text-right">
          <div class="font-semibold tabular-nums">${rightMain}</div>
          <div class="text-xs text-slate-500 dark:text-slate-400 mt-1">Mix UBER: ${formatPct(
            b.mix_uber_2025
          )}</div>
        </div>
      </div>
    `;
    rankList?.appendChild(btn);
  });

  const impactBtn = el("rankImpactBtn");
  const sensBtn = el("rankSensBtn");
  const activeCls =
    "bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-soft3d";
  const idleCls =
    "text-slate-700 dark:text-slate-200 hover:bg-slate-900/5 dark:hover:bg-white/5";
  if (impactBtn)
    impactBtn.className = `px-3 py-1.5 text-sm rounded-lg transition ${
      state.rankMode === "impact" ? activeCls : idleCls
    }`;
  if (sensBtn)
    sensBtn.className = `px-3 py-1.5 text-sm rounded-lg transition ${
      state.rankMode === "sensitivity" ? activeCls : idleCls
    }`;
  impactBtn?.setAttribute(
    "aria-pressed",
    state.rankMode === "impact" ? "true" : "false"
  );
  sensBtn?.setAttribute(
    "aria-pressed",
    state.rankMode === "sensitivity" ? "true" : "false"
  );
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

  el("fSucursal").addEventListener("change", (e) => {
    state.filters.sucursal = e.target.value;
    renderAll();
  });
  el("fMes").addEventListener("change", (e) => {
    state.filters.mes = e.target.value;
    renderAll();
  });
  el("fCanal").addEventListener("change", (e) => {
    state.filters.canal = e.target.value;
    renderAll();
  });
  const onSearch = debounce((value) => {
    state.filters.search = value;
    renderAll();
  }, 200);
  el("fSearch").addEventListener("input", (e) => {
    onSearch(e.target.value);
  });

  el("btnReset").addEventListener("click", () => {
    state.filters = {
      sucursal: "Todas",
      mes: "Todos",
      canal: "Todos",
      search: "",
    };
    el("fSucursal").value = "Todas";
    el("fMes").value = "Todos";
    el("fCanal").value = "Todos";
    el("fSearch").value = "";
    renderAll();
  });

  el("toggleView").addEventListener("click", () => {
    setViewMode(state.viewMode === "money" ? "pct" : "money");
    renderAll();
  });

  el("btnExportJSON").addEventListener("click", () => {
    const rowsFiltered = getFilteredRows();
    downloadBlob(
      "vista_derivada.json",
      new Blob(
        [
          JSON.stringify(
            {
              meta: state.data.meta,
              filters: state.filters,
              rows: rowsFiltered,
            },
            null,
            2
          ),
        ],
        { type: "application/json" }
      )
    );
  });

  el("btnExportCSV").addEventListener("click", () => {
    const rowsFiltered = getFilteredRows();
    downloadBlob(
      "vista_derivada.csv",
      new Blob([`\uFEFF${toCSV(rowsFiltered)}`], {
        type: "text/csv;charset=utf-8",
      })
    );
  });

  const sortHeaders = Array.from(document.querySelectorAll("[data-sort]"));
  setAriaSort(sortHeaders, state.sort.key, state.sort.dir);
  sortHeaders.forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.getAttribute("data-sort");
      if (state.sort.key === key)
        state.sort.dir = state.sort.dir === "asc" ? "desc" : "asc";
      else {
        state.sort.key = key;
        state.sort.dir = "desc";
      }
      setAriaSort(sortHeaders, state.sort.key, state.sort.dir);
      renderAll();
    });
  });

  el("rankImpactBtn")?.addEventListener("click", () => {
    state.rankMode = "impact";
    renderAll();
  });
  el("rankSensBtn")?.addEventListener("click", () => {
    state.rankMode = "sensitivity";
    renderAll();
  });
}

function renderAll() {
  if (!state.data?.rows) return;

  const rowsFiltered = getFilteredRows();
  const kpi = summarize(rowsFiltered);

  buildKPIs(kpi);
  renderActiveChips();
  renderExecutive(rowsFiltered);
  renderCanal(rowsFiltered);
  renderMensual(rowsFiltered);
  renderSucursal(rowsFiltered);
  resizeChartsSoon();
}
async function main() {
  initTheme();
  setupResponsiveDetails();
  initTilt();

  state.data = normalizeData(await fetchJSON(DATA_URL));

  try {
    state.siteAudit = await fetchJSON(SITE_AUDIT_DERIVED_URL);
    renderSecurityPanel();
  } catch (e) {
    console.warn("Site audit no cargado:", e.message);
  }

  const d = safeParseGeneratedAt(state.data?.meta?.generated_at);
  const pretty = d ? d.toLocaleString("es-MX") : "-";
  el("lastRefresh").textContent = pretty;
  el("dataVersion").textContent = pretty;

  el("footerYear").textContent = String(new Date().getFullYear());

  setupFilters();
  setViewMode(state.viewMode);
  renderAll();
  renderScatterFromGlobal();
  renderDrilldown();
  resizeChartsSoon();
}
main().catch((err) => {
  console.error(err);
  alert(`Error: ${err.message}`);
});
