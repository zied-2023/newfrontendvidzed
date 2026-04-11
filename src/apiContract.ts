/**
 * Contrat client ↔ API vidéo (externe).
 * Les noms snake_case ci-dessous sont des hypothèses alignées sur la demande produit ;
 * à ajuster dès publication OpenAPI / README / staging (une seule source de vérité).
 *
 * Feature flag : VITE_VIDEO_API_V2 — active l’UI options avancées « v2 » et l’envoi
 * des champs optionnels non vides (évite de casser une API v1 qui rejette les clés inconnues).
 */

export function isVideoApiV2Enabled(): boolean {
  const v = String(import.meta.env.VITE_VIDEO_API_V2 ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/** Chemins health à tester dans l’ordre (base API_URL sans slash final). */
export const HEALTH_PATHS = ["/health", "/api/health"] as const;

export type StatusOutputDraft = {
  /** URL absolue, ou chemin relatif (ex. /download/xxx), ou vide si seulement format */
  url?: string;
  format?: string;
  label?: string;
  type?: string;
};

export type ResolvedJobOutput = {
  key: string;
  label: string;
  /** URL blob (preview) ou URL directe pour lien téléchargement */
  href: string;
  isVideo: boolean;
};

function pickString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/**
 * Extrait une liste de sorties depuis la réponse GET /status (tolérant plusieurs formes).
 * Ne dépend pas du flag v2 : si l’API renvoie outputs, on les exploite.
 */
export function extractOutputsFromStatus(data: Record<string, unknown>): StatusOutputDraft[] | null {
  const raw = data.outputs ?? data.output_files ?? data.result_outputs;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const base = apiBase.replace(/\/+$/, "");
  const out: StatusOutputDraft[] = [];
  let i = 0;
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const url =
      pickString(o.url) ??
      pickString(o.download_url) ??
      pickString(o.href) ??
      pickString(o.file_url);
    const format = pickString(o.format) ?? pickString(o.profile) ?? pickString(o.variant);
    const label =
      pickString(o.label) ??
      pickString(o.name) ??
      (format ? format : `output_${i}`);
    const type = pickString(o.type) ?? pickString(o.mime_type);
    if (url || format) {
      out.push({ url, format, label, type });
      i++;
    }
  }
  return out.length ? out : null;
}

function resolveOutputHref(draft: StatusOutputDraft, jobId: string, apiBase: string): string {
  const base = apiBase.replace(/\/+$/, "");
  if (draft.url) {
    const u = draft.url;
    if (/^https?:\/\//i.test(u)) return u;
    return `${base}${u.startsWith("/") ? u : `/${u}`}`;
  }
  if (draft.format) {
    const q = new URLSearchParams({ format: draft.format }).toString();
    return `${base}/download/${jobId}?${q}`;
  }
  return `${base}/download/${jobId}`;
}

export function isProbablyVideoUrl(href: string, contentTypeHint?: string): boolean {
  if (contentTypeHint && contentTypeHint.includes("video")) return true;
  const lower = href.split("?")[0].toLowerCase();
  return /\.(mp4|webm|mov|m4v)(\b|$)/i.test(lower);
}

/**
 * Résout les brouillons en hrefs finales (sans fetch ici).
 */
export function resolveOutputHrefs(
  drafts: StatusOutputDraft[],
  jobId: string,
  apiBase: string
): Array<{ href: string; label: string; key: string }> {
  return drafts.map((d, idx) => ({
    key: `${idx}-${d.format ?? d.url ?? "out"}`,
    label: d.label ?? d.format ?? `Output ${idx + 1}`,
    href: resolveOutputHref(d, jobId, apiBase),
  }));
}
