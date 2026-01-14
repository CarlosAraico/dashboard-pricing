import { READ_ONLY_MODE } from "./config.js";

const FALLBACK_TEXT = "Sin dato";

export function assertReadOnlyFetch(options = {}) {
  const method = (options.method || "GET").toUpperCase();
  if (READ_ONLY_MODE && method !== "GET") {
    throw new Error(`READ_ONLY_MODE: método bloqueado (${method}).`);
  }
}

export async function fetchJSON(url, options = {}) {
  assertReadOnlyFetch(options);
  const res = await fetch(url, { method: "GET", ...options });
  if (!res.ok) throw new Error(`No se pudo cargar ${url} (${res.status})`);
  return res.json();
}

export function safeParseGeneratedAt(value) {
  if (!value) return null;
  const v = String(value)
    .replace(/(\.\d{3})\d+/, "$1")
    .replace(/\+00:00$/, "Z");
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function uniq(arr) {
  return [...new Set(arr)];
}

export function toCSV(rows) {
  const cols = Object.keys(rows[0] || {});
  const esc = (v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  return [
    cols.join(","),
    ...rows.map((r) => cols.map((c) => esc(r[c])).join(",")),
  ].join("\n");
}

export function downloadBlob(filename, blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function applyFilters(rows, filters) {
  if (!Array.isArray(rows)) return [];
  const { sucursal, mes, canal, search } = filters || {};
  const q = (search || "").trim().toLowerCase();
  return rows.filter((r) => {
    if (sucursal && sucursal !== "Todas" && r.sucursal !== sucursal)
      return false;
    if (mes && mes !== "Todos" && r.mes !== mes) return false;
    if (canal && canal !== "Todos" && r.canal !== canal) return false;
    if (q && !String(r.sucursal).toLowerCase().includes(q)) return false;
    return true;
  });
}

export function summarize(rows) {
  const sum = (k) => rows.reduce((a, r) => a + Number(r[k] || 0), 0);
  const venta_2025 = sum("venta_2025");
  const venta_2026 = sum("venta_2026");
  const diferencial = sum("diferencial");
  const uplift_pct = venta_2025 > 0 ? (diferencial / venta_2025) * 100 : 0;
  return { venta_2025, venta_2026, diferencial, uplift_pct };
}

export function groupBy(rows, key) {
  const m = new Map();
  for (const r of rows) {
    const k = r[key];
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
}

export function debounce(fn, delay = 200) {
  let t = null;
  return (...args) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), delay);
  };
}

export function getFilterKey(filters) {
  const f = filters || {};
  return [f.sucursal, f.mes, f.canal, (f.search || "").trim().toLowerCase()]
    .map((v) => v || "")
    .join("|");
}

function normalizeText(value) {
  if (value === null || value === undefined) return "";
  return String(value).normalize("NFC").trim();
}

function normalizeField(value, fallback = FALLBACK_TEXT) {
  const t = normalizeText(value);
  return t ? t : fallback;
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeRow(r) {
  return {
    sucursal: normalizeField(r?.sucursal),
    mes: normalizeField(r?.mes),
    canal: normalizeField(r?.canal),
    venta_2025: toNumber(r?.venta_2025),
    venta_2026: toNumber(r?.venta_2026),
    diferencial: toNumber(r?.diferencial),
    uplift_pct: toNumber(r?.uplift_pct),
  };
}

function normalizeBranch(b) {
  return {
    sucursal: normalizeField(b?.sucursal),
    venta_2025: toNumber(b?.venta_2025),
    diferencial: toNumber(b?.diferencial),
    uplift_pct: toNumber(b?.uplift_pct),
    mix_uber_2025: toNumber(b?.mix_uber_2025),
    contrib_uplift_pct: toNumber(b?.contrib_uplift_pct),
  };
}

function normalizeDrill(r) {
  return {
    mes: normalizeField(r?.mes),
    canal: normalizeField(r?.canal),
    sucursal: normalizeField(r?.sucursal),
    venta_2025: toNumber(r?.venta_2025),
    diferencial: toNumber(r?.diferencial),
    uplift_pct: toNumber(r?.uplift_pct),
  };
}

export function normalizeData(raw) {
  const data = raw && typeof raw === "object" ? raw : {};
  const rows = Array.isArray(data.rows) ? data.rows.map(normalizeRow) : [];
  const sucursales = Array.isArray(data.sucursales)
    ? data.sucursales.map(normalizeBranch)
    : [];
  const drilldown = Array.isArray(data.drilldown)
    ? data.drilldown.map(normalizeDrill)
    : [];
  const scatter =
    data.scatter && typeof data.scatter === "object" ? data.scatter : {};
  return { ...data, rows, sucursales, drilldown, scatter };
}
