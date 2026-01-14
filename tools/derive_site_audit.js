"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const RAW_PATH = path.join(ROOT, "exports", "site_audit_raw.json");
const OUT_PATH = path.join(ROOT, "exports", "site_audit_derived.json");

function safeDate(s) {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function pick(obj, key, fallback = null) {
  try {
    const v = obj?.[key];
    return v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

function normalizeAudit(raw) {
  const ssl = raw?.ssl || {};
  const headers = raw?.headers || {};
  const dns = raw?.dns || {};
  const status = raw?.status || {};
  const httpSec = raw?.["http-security"] || {};
  const firewall = raw?.firewall || {};
  const hsts = raw?.hsts || {};
  const social = raw?.["social-tags"] || {};

  const issuer = ssl?.issuer || {};
  const subject = ssl?.subject || {};

  const derived = {
    meta: {
      generated_at: new Date().toISOString(),
      source: "site_audit_raw.json",
      note: "Vista derivada (read-only). No modifica BD.",
    },
    overview: {
      is_up: Boolean(pick(status, "isUp", false)),
      response_code: pick(status, "responseCode", null),
      response_time_ms: pick(status, "responseTime", null),

      server: pick(headers, "server", null),
      cache_status: pick(headers, "cf-cache-status", null),
      cf_ray: pick(headers, "cf-ray", null),

      hsts_header_present: Boolean(
        pick(headers, "strict-transport-security", null)
      ),
      hsts_preload_compatible: Boolean(pick(hsts, "compatible", false)),
      hsts_message: pick(hsts, "message", null),

      waf: {
        has_waf: Boolean(pick(firewall, "hasWaf", false)),
        vendor: pick(firewall, "waf", null),
      },

      robots: pick(social, "robots", null),
      title: pick(social, "title", null),
      description: pick(social, "description", null),
    },
    tls: {
      cn: pick(subject, "CN", null),
      issuer_cn: pick(issuer, "CN", null),
      issuer_o: pick(issuer, "O", null),
      valid_from: safeDate(pick(ssl, "valid_from", null)),
      valid_to: safeDate(pick(ssl, "valid_to", null)),
      bits: pick(ssl, "bits", null),
      curve: pick(ssl, "nistCurve", null),
      fingerprint256: pick(ssl, "fingerprint256", null),
      subject_alt_name: pick(ssl, "subjectaltname", null),
    },
    dns: {
      a: pick(dns?.A, "address", null),
      aaaa: Array.isArray(dns?.AAAA) ? dns.AAAA : [],
      soa: Array.isArray(dns?.SOA) ? dns.SOA : [],
      mx: Array.isArray(dns?.MX) ? dns.MX : [],
    },
    security_headers: {
      strict_transport_security: Boolean(
        pick(headers, "strict-transport-security", null)
      ),
      x_frame_options: Boolean(pick(httpSec, "xFrameOptions", false)),
      x_content_type_options: Boolean(
        pick(httpSec, "xContentTypeOptions", false)
      ),
      x_xss_protection: Boolean(pick(httpSec, "xXSSProtection", false)),
      content_security_policy: Boolean(
        pick(httpSec, "contentSecurityPolicy", false)
      ),
    },
    risks: [],
  };

  // Executive risk rules
  const r = [];
  if (!derived.overview.is_up)
    r.push({
      level: "high",
      title: "Sitio no disponible",
      why: "status.isUp=false",
      action: "Revisar DNS/Pages/Workers y reglas de firewall.",
    });
  if (derived.overview.response_code && derived.overview.response_code >= 400)
    r.push({
      level: "high",
      title: "HTTP error",
      why: `responseCode=${derived.overview.response_code}`,
      action: "Revisar origen/redirects/cache.",
    });
  if (
    derived.overview.response_time_ms &&
    derived.overview.response_time_ms > 800
  )
    r.push({
      level: "med",
      title: "Latencia alta",
      why: `responseTime=${Math.round(derived.overview.response_time_ms)}ms`,
      action: "Revisar cache-control, tamaño assets, CDN, TTFB.",
    });

  if (!derived.security_headers.x_frame_options)
    r.push({
      level: "med",
      title: "Falta X-Frame-Options",
      why: "Protege clickjacking",
      action: "Definir X-Frame-Options o CSP frame-ancestors (en el origen).",
    });
  if (!derived.security_headers.x_content_type_options)
    r.push({
      level: "low",
      title: "Falta X-Content-Type-Options",
      why: "Evita MIME sniffing",
      action: "Agregar X-Content-Type-Options: nosniff.",
    });
  if (!derived.security_headers.content_security_policy)
    r.push({
      level: "med",
      title: "Sin Content-Security-Policy",
      why: "Reduce riesgo XSS",
      action: "Definir CSP mínimo (script-src, frame-ancestors, base-uri).",
    });

  if (!derived.overview.hsts_header_present)
    r.push({
      level: "med",
      title: "HSTS no presente",
      why: "Forzar HTTPS",
      action: "Agregar Strict-Transport-Security.",
    });
  if (
    derived.overview.hsts_header_present &&
    !derived.overview.hsts_preload_compatible
  ) {
    r.push({
      level: "low",
      title: "HSTS sin preload",
      why: derived.overview.hsts_message || "No preload",
      action: "Evaluar agregar preload (si aplica a dominio).",
    });
  }

  derived.risks = r;
  return derived;
}

function main() {
  if (!fs.existsSync(RAW_PATH)) {
    console.error(`No existe: ${RAW_PATH}`);
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(RAW_PATH, "utf8"));
  const derived = normalizeAudit(raw);
  fs.writeFileSync(OUT_PATH, JSON.stringify(derived, null, 2), "utf8");
  console.log(`OK: generado ${OUT_PATH}`);
}

main();
