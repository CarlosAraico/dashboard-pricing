const moneyFormatter = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 0,
});

export function formatMoney(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "-";
  return moneyFormatter.format(v);
}

export function formatPct(p) {
  const v = Number(p);
  if (!Number.isFinite(v)) return "-";
  return `${v.toFixed(1)}%`;
}

export function chip(text, tone = "slate") {
  const map = {
    slate:
      "bg-white/70 dark:bg-slate-950/30 ring-slate-200 dark:ring-slate-700",
    emerald:
      "bg-emerald-500/10 dark:bg-emerald-400/10 ring-emerald-200 dark:ring-emerald-500/30 text-emerald-800 dark:text-emerald-200",
    amber:
      "bg-amber-500/10 dark:bg-amber-400/10 ring-amber-200 dark:ring-amber-500/30 text-amber-800 dark:text-amber-200",
    rose: "bg-rose-500/10 dark:bg-rose-400/10 ring-rose-200 dark:ring-rose-500/30 text-rose-800 dark:text-rose-200",
  };
  return `<span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${
    map[tone] || map.slate
  }">${text}</span>`;
}

export function fmtMs(n) {
  if (n === null || n === undefined) return "-";
  const v = Number(n);
  if (Number.isNaN(v)) return "-";
  return `${Math.round(v)} ms`;
}

export function safeStr(v) {
  return v === null || v === undefined || v === "" ? "-" : String(v);
}

export function formatDateShort(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("es-MX", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

export function badgePct(p, thresholdRed = 8, thresholdGood = 5) {
  const v = Number(p || 0);
  const base =
    "inline-flex items-center justify-end rounded-full px-2 py-0.5 text-xs font-medium ring-1 ";
  if (v >= thresholdRed)
    return `${base} bg-rose-500/10 text-rose-700 ring-rose-200 dark:text-rose-200 dark:ring-rose-500/30`;
  if (v >= thresholdGood)
    return `${base} bg-emerald-500/10 text-emerald-700 ring-emerald-200 dark:text-emerald-200 dark:ring-emerald-500/30`;
  return `${base} bg-slate-500/10 text-slate-700 ring-slate-200 dark:text-slate-200 dark:ring-slate-500/30`;
}

export function badgeChip(text, tone = "slate") {
  const map = {
    slate:
      "bg-white/60 dark:bg-slate-950/30 ring-slate-200 dark:ring-slate-700",
    amber:
      "bg-amber-500/10 dark:bg-amber-400/10 ring-amber-200 dark:ring-amber-500/30 text-amber-800 dark:text-amber-200",
    rose: "bg-rose-500/10 dark:bg-rose-400/10 ring-rose-200 dark:ring-rose-500/30 text-rose-800 dark:text-rose-200",
    emerald:
      "bg-emerald-500/10 dark:bg-emerald-400/10 ring-emerald-200 dark:ring-emerald-500/30 text-emerald-800 dark:text-emerald-200",
  };
  const cls = map[tone] || map.slate;
  return `<span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${cls}">${text}</span>`;
}
