/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { 
  Upload, 
  Type, 
  Video, 
  ChevronDown, 
  X, 
  ChefHat,
  Sparkles,
  Square,
  UtensilsCrossed,
  Coffee,
  Download,
  Copy,
  Loader2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Language, translations } from './translations';

// --- Constants ---
const API_URL = (() => {
  const raw = String(import.meta.env.VITE_API_URL ?? "").trim();
  if (!raw) return "";
  // VITE_API_URL doit pointer sur la base du backend (sans /api à la fin).
  // On normalise pour éviter les doubles préfixes (ex: .../api/api/...).
  let u = raw.replace(/\/+$/, "");
  u = u.replace(/\/api$/i, "");
  return u;
})();
const MAX_PROMO_CHARS = 2000;
const MIN_PROMO_CHARS = 20;
const MAX_MEDIA_FILES = 10;
const TUNISIAN_VOICES = ["salim", "tounsia"] as const;

function normalizeLanguage(input: string): "tn" | "fr" | "ar" | "en" {
  if (input === "tn" || input === "ar" || input === "en") return input;
  return "fr";
}

function looksLikeSecretVoiceId(input: string): boolean {
  const v = input.trim();
  if (!v) return false;
  // ElevenLabs-like IDs are typically long opaque tokens; block them from frontend payloads.
  return /^[A-Za-z0-9_-]{18,}$/.test(v);
}

/** API expects readable lowercase codes (e.g. femme_emirate, salim). */
function normalizeReadableVoiceCode(input: string): string {
  return input.trim().toLowerCase();
}

function isTunisianVoiceCode(code: string): boolean {
  const c = normalizeReadableVoiceCode(code);
  return c === "salim" || c === "tounsia";
}

function shouldDebugGenerateFormData(): boolean {
  if (import.meta.env.DEV) return true;
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("debugVoice") === "1";
}

function logGenerateFormDataDebug(fd: FormData): void {
  const rows: Array<[string, string]> = [];
  for (const [key, value] of fd.entries()) {
    if (value instanceof File) rows.push([key, `(file) ${value.name}`]);
    else rows.push([key, String(value)]);
  }
  console.log("[generate FormData]", rows);
}

function polishPromoText(s: string): string {
  const out = s.trim().replace(/\s+/g, " ");
  if (!out) return out;
  return out.charAt(0).toUpperCase() + out.slice(1);
}

function fastApiErrorMessage(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const d = data as Record<string, unknown>;
  if (typeof d.detail === "string") return d.detail;
  if (Array.isArray(d.detail) && d.detail[0] && typeof (d.detail[0] as { msg?: string }).msg === "string") {
    return (d.detail as { msg: string }[]).map((x) => x.msg).join("; ");
  }
  return "";
}

type ParsedApiResponse = {
  ok: boolean;
  status: number;
  data: Record<string, unknown> | null;
  rawText: string;
};

function sanitizeUserMessage(input: string): string {
  const text = input.trim();
  if (!text) return "";
  // Avoid showing backend stack traces to end users.
  const stackStart = text.search(/traceback|stack trace|file\s+".*?",\s+line/i);
  const cleaned = stackStart >= 0 ? text.slice(0, stackStart).trim() : text;
  return cleaned.length > 500 ? `${cleaned.slice(0, 500).trim()}...` : cleaned;
}

function formatFastApiValidationErrors(detail: unknown): string {
  if (!Array.isArray(detail)) return "";
  const lines = detail
    .slice(0, 3)
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const loc = Array.isArray((item as { loc?: unknown[] }).loc)
        ? ((item as { loc?: unknown[] }).loc ?? []).filter((x) => typeof x === "string" || typeof x === "number").join(".")
        : "";
      const msg = typeof (item as { msg?: unknown }).msg === "string" ? (item as { msg: string }).msg : "";
      if (!loc && !msg) return "";
      return `Champ ${loc || "inconnu"}: ${msg || "valeur invalide"}`;
    })
    .filter(Boolean);
  return lines.join(" | ");
}

function extractApiErrorMessage(payload: unknown, status: number, rawText = ""): string {
  const defaultMessage =
    status === 400 || status === 422
      ? "Données invalides. Vérifiez les champs puis réessayez."
      : status === 502
        ? "Service temporairement indisponible. Réessayez dans quelques instants."
        : `Erreur serveur (HTTP ${status}).`;

  if (payload && typeof payload === "object") {
    const p = payload as Record<string, unknown>;
    const code = typeof p.code === "string" ? p.code : "";
    const message = typeof p.message === "string" ? sanitizeUserMessage(p.message) : "";
    const detailString = typeof p.detail === "string" ? sanitizeUserMessage(p.detail) : "";
    const detailList = formatFastApiValidationErrors(p.detail);

    if (code === "MISTRAL_INVALID_AUTH_HEADER" && message) return message;
    if (message) return message;
    if (detailString) return detailString;
    if (detailList) return detailList;
  }

  const rawClean = sanitizeUserMessage(rawText);
  if (rawClean) return rawClean;
  return defaultMessage;
}

async function parseApiResponse(res: Response): Promise<ParsedApiResponse> {
  const rawText = await res.text();
  let data: Record<string, unknown> | null = null;
  if (rawText.trim()) {
    try {
      const parsed = JSON.parse(rawText) as unknown;
      if (parsed && typeof parsed === "object") {
        data = parsed as Record<string, unknown>;
      }
    } catch {
      data = null;
    }
  }
  return { ok: res.ok, status: res.status, data, rawText };
}

// --- Components ---

const Card = ({ children, className = "" }: { children: React.ReactNode, className?: string }) => (
  <motion.div 
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    className={`bg-caramel rounded-2xl p-6 shadow-xl border-2 border-terracotta/10 relative ${className}`}
  >
    <div className="absolute inset-1 border border-terracotta/5 rounded-xl pointer-events-none" />
    {children}
  </motion.div>
);

const Label = ({ children, icon: Icon }: { children: React.ReactNode, icon?: any }) => (
  <div className="flex items-center gap-2 mb-3">
    {Icon && <Icon size={18} className="text-terracotta" />}
    <span className="text-sm font-medium uppercase tracking-wider text-coffee/80 flex items-center gap-2">
      {children}
    </span>
  </div>
);

const Select = ({ value, onChange, options, icon: Icon }: { value: string, onChange: (v: any) => void, options: string[], icon: any }) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full pl-10 pr-10 py-3 bg-cream/30 border border-terracotta/10 rounded-xl input-focus text-coffee font-medium cursor-pointer flex items-center justify-between text-left transition-all hover:bg-cream/40"
      >
        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-terracotta transition-colors">
          <Icon size={18} />
        </div>
        <span className="truncate">{value}</span>
        <div className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}>
          <ChevronDown size={18} className="text-coffee/40" />
        </div>
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 4, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            className="absolute z-50 w-full bg-caramel border border-terracotta/20 rounded-xl shadow-2xl overflow-hidden py-1 max-h-60 overflow-y-auto"
          >
            {options.map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => {
                  onChange(opt);
                  setIsOpen(false);
                }}
                className={`w-full px-4 py-2.5 text-left text-sm transition-colors flex items-center justify-between
                  ${value === opt 
                    ? 'bg-terracotta text-cream' 
                    : 'text-coffee hover:bg-cream/10'
                  }
                `}
              >
                {opt}
                {value === opt && <Sparkles size={14} className="opacity-60" />}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default function App() {
  const [lang, setLang] = useState<Language>(() => {
    const saved = localStorage.getItem("vidzed_lang");
    return saved === "fr" || saved === "en" || saved === "ar" ? saved : "fr";
  });
  const t = translations[lang];
  const copyLangOpts = t.copyLangOpts ?? translations.fr.copyLangOpts;
  const ambianceOpts = t.ambianceOpts ?? translations.fr.ambianceOpts;
  const transitionPresets = t.transitionPresets ?? translations.fr.transitionPresets;
  const cameraOptions = t.cameraOptions ?? translations.fr.cameraOptions;
  const subtitleOptions = t.subtitleOptions ?? translations.fr.subtitleOptions;
  const voiceOptions = t.voiceOptions ?? translations.fr.voiceOptions;

  const [files, setFiles] = useState<File[]>([]);
  const [promoText, setPromoText] = useState("");
  const [businessType, setBusinessType] = useState<"restaurant" | "cafe" | "immobilier">("restaurant");
  const [copyLanguage, setCopyLanguage] = useState<"fr" | "tn" | "ar" | "en">("fr");
  const [businessName, setBusinessName] = useState("");
  const [city, setCity] = useState("");
  const [offer, setOffer] = useState("");
  const [ambiance, setAmbiance] = useState("chaleureux");
  const [textLengthMode, setTextLengthMode] = useState<"short" | "long">("short");
  const [activeChip, setActiveChip] = useState<string | null>(null);
  const [transitionPreset, setTransitionPreset] = useState("default");
  const [cameraStyle, setCameraStyle] = useState("");
  const [musicStyle, setMusicStyle] = useState("upbeat");
  const [subtitleModeApi, setSubtitleModeApi] = useState("");
  const [subtitleStyleApi, setSubtitleStyleApi] = useState("capcut");
  const [voiceCode, setVoiceCode] = useState("");
  const [copySuccess, setCopySuccess] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [jobProgress, setJobProgress] = useState<{ status: string, download_url?: string } | null>(null);
  const [apiStatus, setApiStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [copyLoading, setCopyLoading] = useState(false);
  const [improveLoading, setImproveLoading] = useState(false);
  const [textCopied, setTextCopied] = useState(false);
  const [videoBuffering, setVideoBuffering] = useState(true);
  const [autoplayHint, setAutoplayHint] = useState(false);

  useEffect(() => {
    localStorage.setItem("vidzed_lang", lang);
    document.documentElement.lang = lang;
  }, [lang]);

  // Avoid stale manual voice when switching generation language (auto = empty voice_code).
  useEffect(() => {
    setVoiceCode("");
  }, [copyLanguage]);

  const promoPlaceholder = useMemo(() => {
    if (businessType === "cafe") return t.placeholderCafe;
    if (businessType === "immobilier") return t.placeholderImmobilier;
    return t.placeholderRestaurant;
  }, [businessType, lang, t]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const previewUrls = useMemo(
    () => files.map((f) => URL.createObjectURL(f)),
    [files]
  );

  useEffect(() => {
    return () => previewUrls.forEach((u) => URL.revokeObjectURL(u));
  }, [previewUrls]);

  const canSubmit =
    files.length > 0 &&
    promoText.trim().length >= MIN_PROMO_CHARS &&
    apiStatus !== "offline";

  const statusStepLabel = (() => {
    if (status?.type === "error") return "";
    if (!isGenerating && !activeJobId) return "";
    if (isGenerating && !activeJobId) return t.statusQueued;
    if (jobProgress?.download_url) return "";
    const st = (jobProgress?.status || "").toLowerCase();
    if (st.includes("render") || st.includes("rendu") || st.includes("encoding"))
      return t.statusRendering;
    if (st.includes("process") || st.includes("trait")) return t.statusProcessing;
    return t.statusProcessing;
  })();

  // Nettoyage du polling à la destruction du composant
  useEffect(() => {
    const checkApi = async () => {
      try {
        const res = await fetch(`${API_URL}/health`);
        if (res.ok) {
          setApiStatus('online');
        } else {
          setApiStatus('offline');
        }
      } catch (e) {
        setApiStatus('offline');
      }
    };
    checkApi();

    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  const pollJobStatus = async (jobId: string) => {
    try {
      const response = await fetch(`${API_URL}/status/${jobId}`);
      if (!response.ok) {
        console.warn(`Status check failed with status: ${response.status}`);
        return;
      }
      
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const text = await response.text();
        console.error("Status response is not JSON:", text.substring(0, 100));
        return;
      }

      let data;
      try {
        data = await response.json();
      } catch (e) {
        console.error("Failed to parse status JSON");
        return;
      }
      const isCompleted = data.status === 'completed' || data.download_url;
      const isFailed = data.status === 'failed' || data.status === 'error';

      if (isFailed) {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
        setIsGenerating(false);
        setStatus({ 
          type: 'error', 
          message: data.message || data.error || "La génération a échoué sur le serveur externe." 
        });
        setJobProgress({
          status: "Échec",
          download_url: undefined
        });
        return;
      }

      if (isCompleted) {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }

        try {
          const videoRes = await fetch(`${API_URL}/download/${jobId}`);
          const contentType = videoRes.headers.get('content-type');
          
          if (videoRes.ok && contentType && contentType.includes('video')) {
            const blob = await videoRes.blob();
            const blobUrl = URL.createObjectURL(blob);
            
            setJobProgress({
              status: data.status || data.message || t.generating,
              download_url: blobUrl
            });
            setStatus({ type: 'success', message: t.videoReady });
            setIsGenerating(false);
          } else {
            throw new Error("Invalid video response");
          }
        } catch (err) {
          console.error("Error downloading video blob:", err);
          setStatus({ type: 'error', message: "Erreur lors du chargement de la vidéo." });
        }
      } else {
        setJobProgress({
          status: data.status || data.message || t.generating,
          download_url: undefined
        });
      }
    } catch (error) {
      console.error("Erreur polling:", error);
    }
  };

  const mergeMediaFiles = (incoming: File[]) => {
    setFiles((prev) => [...prev, ...incoming].slice(0, MAX_MEDIA_FILES));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      mergeMediaFiles(Array.from(e.target.files));
    }
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave = () => {
    setIsDragging(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) {
      mergeMediaFiles(Array.from(e.dataTransfer.files));
    }
  };

  const handleStop = () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    setIsGenerating(false);
    setActiveJobId(null);
    setJobProgress(null);
    setStatus({ type: 'error', message: t.genInterrupted });
  };

  const handleGenerate = async () => {
    setStatus(null);
    setCopySuccess(null);

    if (files.length === 0) {
      setStatus({ type: 'error', message: "Média requis: ajoutez au moins un fichier (image ou vidéo)." });
      return;
    }
    if (files.length > MAX_MEDIA_FILES) {
      setStatus({ type: 'error', message: `Trop de médias: maximum ${MAX_MEDIA_FILES} fichiers.` });
      return;
    }
    const promoTrimmed = promoText.trim();
    if (!promoTrimmed) {
      setStatus({ type: 'error', message: "Texte requis: ajoutez un texte promotionnel." });
      return;
    }
    if (promoTrimmed.length < MIN_PROMO_CHARS) {
      setStatus({ type: 'error', message: `Texte trop court: minimum ${MIN_PROMO_CHARS} caractères.` });
      return;
    }
    if (promoTrimmed.length > MAX_PROMO_CHARS) {
      setStatus({ type: 'error', message: `Texte trop long: maximum ${MAX_PROMO_CHARS} caractères.` });
      return;
    }
    if (apiStatus === "offline") {
      setStatus({ type: 'error', message: t.apiOffline });
      return;
    }

    let launchedJobId: string | null = null;
    setIsGenerating(true);
    setStatus(null);

    try {
      const targetPath = '/generate';
      console.log(`Tentative d'envoi de la requête à ${API_URL}${targetPath}...`);
      
      const formData = new FormData();
      files.forEach(file => formData.append('media', file));
      formData.append('text', promoText);
      formData.append('promoText', promoText);
      formData.append('transition_preset', transitionPreset);
      formData.append('camera_style', cameraStyle);
      formData.append('music_style', musicStyle);
      formData.append('subtitle_style', subtitleStyleApi);
      if (subtitleModeApi) formData.append('subtitle_mode', subtitleModeApi);

      const normalizedLanguage = normalizeLanguage(copyLanguage);
      formData.append("language", normalizedLanguage);

      if (voiceCode && looksLikeSecretVoiceId(voiceCode)) {
        setStatus({ type: "error", message: "Code voix invalide: utilisez un code lisible (ex: salim), jamais un ID brut." });
        return;
      }
      // Manual only: never append voice_code in auto mode (empty = server picks by language).
      const manualVoiceCode = normalizeReadableVoiceCode(voiceCode);
      if (manualVoiceCode) {
        if (normalizedLanguage === "ar" && isTunisianVoiceCode(manualVoiceCode)) {
          const ok = window.confirm(
            "Vous avez choisi une voix tunisienne (Derja) alors que la langue est arabe fusha. Continuer avec ce choix manuel ?"
          );
          if (!ok) {
            setIsGenerating(false);
            return;
          }
        }
        formData.append("voice_code", manualVoiceCode);
      }

      if (shouldDebugGenerateFormData()) {
        logGenerateFormDataDebug(formData);
      }

      const response = await fetch(`${API_URL}${targetPath}`, {
        method: 'POST',
        body: formData,
      });
      const parsed = await parseApiResponse(response);
      const data = parsed.data ?? {};

      if (!parsed.ok) {
        const msg = extractApiErrorMessage(parsed.data, parsed.status, parsed.rawText);
        if (import.meta.env.DEV) {
          console.warn("[API error]", {
            endpoint: targetPath,
            status: parsed.status,
            code: typeof data.code === "string" ? data.code : undefined,
            message: msg,
          });
        }
        setStatus({ type: "error", message: msg });
        return;
      }

      const jobId = data.job_id || data.id || data.jobId;
      if (!jobId || typeof jobId !== "string") {
        setStatus({ type: "error", message: "Réponse API invalide: job_id manquant." });
        return;
      }

      setStatus({ type: "success", message: t.videoLaunched(jobId) });
      launchedJobId = jobId;
      setActiveJobId(jobId);
      setJobProgress({ status: t.initializing });
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = setInterval(() => pollJobStatus(jobId), 5000);
    } catch (error: any) {
      const msg = error instanceof Error ? error.message : String(error);
      setStatus({ type: 'error', message: sanitizeUserMessage(msg) || "Erreur de connexion au serveur." });
    } finally {
      if (!launchedJobId) {
        setIsGenerating(false);
      }
    }
  };

  const handleGenerateCopy = async (
    forcedBusinessType?: "restaurant" | "cafe" | "immobilier"
  ) => {
    setStatus(null);
    setCopySuccess(null);
    const bt = forcedBusinessType || businessType;
    if (!businessName.trim()) {
      setStatus({ type: "error", message: t.needBusinessName });
      return;
    }
    if (!city.trim()) {
      setStatus({ type: "error", message: t.needCity });
      return;
    }

    setCopyLoading(true);
    try {
      const fd = new FormData();
      fd.append("business_type", bt);
      fd.append("business_name", businessName.trim());
      fd.append("location", city.trim());
      fd.append("offer", offer.trim() || "");
      fd.append("ambiance", ambiance || "chaleureux");
      fd.append("language", copyLanguage);
      fd.append("length", textLengthMode === "long" ? "long" : "court");

      const endpoint = "/generate-copy";
      const res = await fetch(`${API_URL}${endpoint}`, { method: "POST", body: fd });
      const parsed = await parseApiResponse(res);
      const data = parsed.data ?? {};
      const code = typeof data.code === "string" ? data.code : "";

      if (!parsed.ok || data.status === "error") {
        const errMsg =
          code === "MISTRAL_INVALID_AUTH_HEADER"
            ? (typeof data.message === "string" && data.message) || extractApiErrorMessage(parsed.data, parsed.status, parsed.rawText)
            : extractApiErrorMessage(parsed.data, parsed.status, parsed.rawText) || fastApiErrorMessage(data);
        if (import.meta.env.DEV) {
          console.warn("[API error]", {
            endpoint,
            status: parsed.status,
            code: code || undefined,
            message: errMsg,
          });
        }
        setStatus({ type: "error", message: errMsg });
        return;
      }
      if (data.status !== "success") {
        setStatus({ type: "error", message: t.copyGenUnexpected });
        return;
      }
      const generatedText = String(data.text ?? "").trim();
      if (!generatedText) {
        setStatus({ type: "error", message: t.copyGenEmpty });
        return;
      }
      setPromoText(generatedText.slice(0, MAX_PROMO_CHARS));
      setCopySuccess(t.copyGenSuccess);
      setTimeout(() => setCopySuccess(null), 2300);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus({ type: "error", message: "Erreur de connexion au serveur: " + msg });
    } finally {
      setCopyLoading(false);
    }
  };

  const handleImproveText = async () => {
    const currentText = promoText.trim();
    if (!currentText) {
      setStatus({ type: "error", message: t.improveNeedText });
      return;
    }
    setImproveLoading(true);
    let improved = currentText.replace(/\s+/g, " ").replace(/,\s*,/g, ", ").trim();
    const ctaFr = " Contactez-nous maintenant.";
    const ctaEn = " Contact us now.";
    const ctaAr = " تواصلوا معنا الان.";
    const ctaTn = " Kallemna tawa.";
    const cta = copyLanguage === "ar" ? ctaAr : copyLanguage === "tn" ? ctaTn : copyLanguage === "en" ? ctaEn : ctaFr;
    improved = improved.endsWith(".") ? improved + cta : improved + "." + cta;
    setPromoText(polishPromoText(improved).slice(0, MAX_PROMO_CHARS));
    setCopySuccess(t.improveDone);
    setTimeout(() => setCopySuccess(null), 2300);
    setImproveLoading(false);
  };

  const handleCopyText = async () => {
    try {
      await navigator.clipboard.writeText(promoText);
      setTextCopied(true);
      setTimeout(() => setTextCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  const onChipSuggestion = (chipType: "restaurant" | "cafe" | "immobilier") => {
    setActiveChip(chipType);
    setBusinessType(chipType);
    void handleGenerateCopy(chipType);
  };

  const nativeSelectClass =
    "ux-native-select w-full py-3 px-3 bg-caramel border border-terracotta/35 rounded-xl text-coffee text-sm focus:outline-none focus:ring-2 focus:ring-terracotta/45";
  const fieldLabelClass = "block text-sm font-semibold text-coffee mb-2";

  return (
    <div className="min-h-screen pb-20 px-4 sm:px-6 lg:px-8 max-w-5xl mx-auto" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      {/* Header */}
      <header className="py-10 flex flex-col md:flex-row items-center md:items-start justify-between gap-8 border-b border-coffee/5 mb-12">
        <div className="flex flex-col md:flex-row items-center md:items-start gap-8 w-full justify-between">
          <motion.div 
            initial={{ opacity: 0, x: lang === 'ar' ? 30 : -30 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex items-center gap-5"
          >
            <div className="relative group">
              <div className="absolute -inset-1 bg-gradient-to-r from-cyan-400 to-blue-500 rounded-2xl blur opacity-25 group-hover:opacity-50 transition duration-1000 group-hover:duration-200"></div>
              <div className="relative w-20 h-20 md:w-24 md:h-24 rounded-2xl bg-white flex items-center justify-center overflow-hidden shadow-2xl">
                <img 
                  src="/logo.png" 
                  alt="VidZed Logo" 
                  className="w-full h-full object-contain p-1 z-10"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                    const fallback = e.currentTarget.parentElement?.querySelector('.fallback-icon');
                    if (fallback) (fallback as HTMLElement).style.display = 'flex';
                  }}
                  referrerPolicy="no-referrer"
                />
                <div className="fallback-icon absolute inset-0 hidden items-center justify-center bg-gradient-to-br from-cyan-500 to-blue-600 text-white">
                  <Video size={40} />
                </div>
              </div>
            </div>
            <div className="text-left">
              <div className="flex items-center gap-3">
                <h1 className="text-4xl md:text-5xl font-serif italic text-coffee tracking-tight leading-none">VidZed</h1>
                <div className={`w-2 h-2 rounded-full mt-2 ${
                  apiStatus === 'online' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 
                  apiStatus === 'offline' ? 'bg-red-500 animate-pulse' : 'bg-amber-500'
                }`} title={apiStatus === 'online' ? 'API Connectée' : 'API Déconnectée'} />
              </div>
              <div className="flex items-center gap-2 mt-2">
                <span className="h-px w-8 bg-terracotta/30"></span>
                <p className="text-[11px] uppercase tracking-[0.4em] text-terracotta font-black">{t.tagline}</p>
              </div>
            </div>
          </motion.div>

          <div className="flex flex-col items-center md:items-end gap-4">
            <div className="flex items-center gap-2 bg-cream/20 p-1 rounded-full border border-terracotta/10 pointer-events-auto">
              {(['fr', 'en', 'ar'] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  aria-pressed={lang === l}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setLang(l);
                  }}
                  className={`px-3 py-1 rounded-full text-xs font-bold transition-all ${
                    lang === l 
                      ? 'bg-terracotta text-cream shadow-md' 
                      : 'text-coffee/40 hover:text-coffee/60'
                  }`}
                >
                  {l.toUpperCase()}
                </button>
              ))}
            </div>
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="max-w-xs md:text-right"
            >
              <p className="text-coffee/50 text-sm font-light italic leading-relaxed">{t.description}</p>
            </motion.div>
          </div>
        </div>
      </header>

      <main className="space-y-8">
        <div className="text-center max-w-2xl mx-auto px-2">
          <h2 className="text-2xl md:text-3xl font-serif font-semibold text-coffee tracking-tight">
            {t.heroTitle}
          </h2>
          <p className="text-coffee/55 text-sm mt-3 leading-relaxed">{t.heroSubtitle}</p>
        </div>

        {/* 1) Business */}
        <Card>
          <h2 className="text-lg font-serif font-semibold text-coffee mb-4 border-b border-terracotta/10 pb-3">
            {t.sectionBusiness}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="business_type" className={fieldLabelClass}>
                {t.businessType}
              </label>
              <select
                id="business_type"
                value={businessType}
                onChange={(e) => {
                  setBusinessType(e.target.value as typeof businessType);
                  setActiveChip(null);
                }}
                className={nativeSelectClass}
              >
                <option value="restaurant">{t.chipRestaurant}</option>
                <option value="cafe">{t.chipCafe}</option>
                <option value="immobilier">{t.chipImmobilier}</option>
              </select>
            </div>
            <div>
              <label htmlFor="language_mode" className={fieldLabelClass}>
                {t.copyLanguage}
              </label>
              <select
                id="language_mode"
                value={copyLanguage}
                onChange={(e) => setCopyLanguage(e.target.value as typeof copyLanguage)}
                className={nativeSelectClass}
              >
                <option value="fr">{copyLangOpts.fr}</option>
                <option value="tn">{copyLangOpts.tn}</option>
                <option value="ar">{copyLangOpts.ar}</option>
                <option value="en">{copyLangOpts.en}</option>
              </select>
            </div>
            <div>
              <label htmlFor="business_name" className={fieldLabelClass}>
                {t.businessName}
              </label>
              <input
                id="business_name"
                type="text"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                className={nativeSelectClass}
                placeholder="Le Sunset Lounge"
                autoComplete="organization"
              />
            </div>
            <div>
              <label htmlFor="city" className={fieldLabelClass}>
                {t.cityLabel}
              </label>
              <input
                id="city"
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className={nativeSelectClass}
                placeholder="Sidi Bou Saïd"
                autoComplete="address-level2"
              />
            </div>
            <div>
              <label htmlFor="offer" className={fieldLabelClass}>
                {t.offerLabel}
              </label>
              <input
                id="offer"
                type="text"
                value={offer}
                onChange={(e) => setOffer(e.target.value)}
                className={nativeSelectClass}
                placeholder="-20% ce week-end"
              />
            </div>
            <div>
              <label htmlFor="ambiance" className={fieldLabelClass}>
                {t.ambianceLabel}
              </label>
              <select
                id="ambiance"
                value={ambiance}
                onChange={(e) => setAmbiance(e.target.value)}
                className={nativeSelectClass}
              >
                {(Object.keys(ambianceOpts) as Array<keyof typeof ambianceOpts>).map((k) => (
                  <option key={k} value={k}>
                    {ambianceOpts[k]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 mt-5">
            <button
              type="button"
              id="text_short_btn"
              onClick={() => setTextLengthMode("short")}
              className={`ux-btn-secondary text-sm ${textLengthMode === "short" ? "ring-2 ring-terracotta/40 bg-cream/30" : ""}`}
            >
              {t.textShort}
            </button>
            <button
              type="button"
              id="text_long_btn"
              onClick={() => setTextLengthMode("long")}
              className={`ux-btn-secondary text-sm ${textLengthMode === "long" ? "ring-2 ring-terracotta/40 bg-cream/30" : ""}`}
            >
              {t.textLong}
            </button>
            <span
              id="lengthBadge"
              className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-full border border-dashed border-terracotta/35 text-coffee/70 bg-cream/10"
            >
              {t.formatBadge(textLengthMode)}
            </span>
          </div>
        </Card>

        {/* 2) Text */}
        <Card>
          <h2 className="text-lg font-serif font-semibold text-coffee mb-4 border-b border-terracotta/10 pb-3">
            {t.sectionText}
          </h2>
          <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
            <Label icon={Type}>{t.promoText}</Label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                id="generateCopyBtn"
                disabled={copyLoading}
                onClick={() => void handleGenerateCopy()}
                className="ux-btn-secondary"
                title={t.generateCopy}
              >
                {copyLoading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                {copyLoading ? t.copyWorking : t.generateCopy}
              </button>
              <button
                type="button"
                id="improveTextBtn"
                disabled={improveLoading || !promoText.trim()}
                onClick={handleImproveText}
                className="ux-btn-secondary"
                title={t.improveText}
              >
                {improveLoading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                {improveLoading ? t.improveWorking : t.improveText}
              </button>
              <button
                type="button"
                onClick={handleCopyText}
                className="ux-btn-secondary"
                title={t.copyText}
              >
                {textCopied ? <Sparkles size={14} /> : <Copy size={14} />}
                {textCopied ? t.copied : t.copyText}
              </button>
            </div>
          </div>
          <textarea
            id="text"
            name="text"
            placeholder={promoPlaceholder}
            value={promoText}
            onChange={(e) => setPromoText(e.target.value.slice(0, MAX_PROMO_CHARS))}
            rows={5}
            maxLength={MAX_PROMO_CHARS}
            required
            aria-describedby="text-help text-counter"
            className={`w-full p-4 bg-cream/30 border rounded-xl input-focus text-coffee placeholder:text-coffee/30 resize-y min-h-[110px] leading-relaxed transition-colors ${
              promoText.trim().length >= MIN_PROMO_CHARS ? "ux-field-filled border-terracotta/25" : "border-terracotta/10"
            }`}
          />
          <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-coffee/45">
            <span id="text-help">{t.textHelper}</span>
            <span id="text-counter" className="tabular-nums text-coffee/55">
              {t.charCount(promoText.length, MAX_PROMO_CHARS)}
            </span>
          </div>
          <p className="text-[10px] uppercase tracking-wider text-coffee/40 mt-4 mb-2">{t.suggestionChipsHint}</p>
          <div id="textSuggestions" className="flex flex-wrap gap-2">
            {(
              [
                ["restaurant", t.chipRestaurant],
                ["cafe", t.chipCafe],
                ["immobilier", t.chipImmobilier],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                data-suggestion={key}
                onClick={() => onChipSuggestion(key)}
                className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${
                  activeChip === key
                    ? "border-terracotta/60 bg-terracotta/15 text-terracotta font-semibold"
                    : "bg-cream/20 border-terracotta/10 text-coffee/70 hover:border-terracotta/40 hover:text-terracotta"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {copySuccess && (
            <div
              id="copyStatus"
              className="mt-3 p-3 rounded-xl text-sm border border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
              role="status"
              aria-live="polite"
            >
              {copySuccess}
            </div>
          )}
        </Card>

        {/* 3) Upload Section */}
        <Card className="relative overflow-hidden group">
          <h2 className="text-lg font-serif font-semibold text-coffee mb-2 border-b border-terracotta/10 pb-3">
            {t.sectionMedia}
          </h2>
          <div className="flex flex-wrap items-end justify-between gap-2 mb-1">
            <Label icon={Video}>{t.promoMedia}</Label>
            <span
              id="mediaCount"
              className={`text-xs font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border transition-colors ${
                files.length > 0
                  ? "border-terracotta/40 text-terracotta bg-terracotta/10"
                  : "border-coffee/10 text-coffee/35"
              }`}
              title={t.mediaHelper}
            >
              {t.mediaBadge(files.length)}
            </span>
          </div>
          <p className="text-[11px] text-coffee/45 mb-2 leading-snug" id="media-helper">
            {t.mediaHelper}
          </p>
          <div 
            id="media-dropzone"
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`
              mt-2 border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all duration-300
              ${isDragging ? 'border-terracotta bg-terracotta/10 ux-drag-active' : 'border-terracotta/20 hover:border-terracotta/40 hover:bg-cream/20'}
            `}
          >
            <input 
              id="media"
              type="file" 
              multiple 
              className="hidden" 
              ref={fileInputRef}
              onChange={handleFileChange}
              accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/x-m4v"
            />
            <div className="flex flex-col items-center gap-4">
              <div className="p-4 bg-cream/10 rounded-full text-terracotta shadow-sm group-hover:scale-110 transition-transform">
                <Upload size={32} />
              </div>
              <div>
                <p className="text-coffee font-medium text-lg">{t.dragDrop}</p>
                <p className="text-coffee/60 text-sm mt-1">{t.clickBrowse}</p>
              </div>
            </div>
          </div>

          <AnimatePresence>
            {files.length > 0 && (
              <motion.div 
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-6 space-y-3"
              >
                <div className="flex items-center justify-between text-sm text-coffee/60 font-medium">
                  <span>{t.filesSelected(files.length)}</span>
                  <button type="button" onClick={() => setFiles([])} className="text-terracotta hover:underline">{t.clearAll}</button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3">
                  {files.map((file, idx) => (
                    <motion.div 
                      key={`${file.name}-${idx}`}
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="relative aspect-square rounded-lg bg-cream/10 border border-terracotta/10 overflow-hidden group/item"
                      title={file.name}
                    >
                      {file.type.startsWith("video") ? (
                        <video
                          src={previewUrls[idx]}
                          className="w-full h-full object-cover"
                          muted
                          playsInline
                          preload="metadata"
                        />
                      ) : (
                        <img src={previewUrls[idx]} alt="" className="w-full h-full object-cover" />
                      )}
                      <div className="absolute bottom-0 left-0 right-0 bg-black/55 px-1 py-0.5 text-[9px] text-coffee truncate">
                        {file.name}
                      </div>
                      <button 
                        type="button"
                        onClick={(e) => { e.stopPropagation(); removeFile(idx); }}
                        className="absolute top-1 right-1 p-1 bg-black/50 text-white rounded-full opacity-0 group-hover/item:opacity-100 transition-opacity"
                      >
                        <X size={12} />
                      </button>
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </Card>

        <details className="group rounded-2xl border border-terracotta/15 bg-caramel shadow-xl overflow-hidden">
          <summary className="cursor-pointer list-none px-5 py-4 font-semibold text-coffee bg-cream/10 hover:bg-cream/20 border-b border-terracotta/10 flex items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
            <span>{t.advancedOptions}</span>
            <ChevronDown size={18} className="text-coffee/50 shrink-0 transition-transform group-open:rotate-180" />
          </summary>
          <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-terracotta/5">
            <div>
              <label htmlFor="transition_preset" className={fieldLabelClass}>
                {t.transition}
              </label>
              <select
                id="transition_preset"
                name="transition_preset"
                value={transitionPreset}
                onChange={(e) => setTransitionPreset(e.target.value)}
                className={nativeSelectClass}
              >
                {(Object.keys(transitionPresets) as Array<keyof typeof transitionPresets>).map((k) => (
                  <option key={k} value={k}>
                    {transitionPresets[k]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="camera_style" className={fieldLabelClass}>
                {t.camera}
              </label>
              <select
                id="camera_style"
                name="camera_style"
                value={cameraStyle}
                onChange={(e) => setCameraStyle(e.target.value)}
                className={nativeSelectClass}
              >
                <option value="">{cameraOptions.default}</option>
                <option value="smooth">{cameraOptions.smooth}</option>
                <option value="dynamic">{cameraOptions.dynamic}</option>
                <option value="luxury">{cameraOptions.luxury}</option>
              </select>
            </div>
            <div>
              <label htmlFor="music_style" className={fieldLabelClass}>
                {t.musicStyle}
              </label>
              <select
                id="music_style"
                name="music_style"
                value={musicStyle}
                onChange={(e) => setMusicStyle(e.target.value)}
                className={nativeSelectClass}
              >
                <option value="upbeat">Upbeat</option>
                <option value="chill">Chill</option>
                <option value="cinematic">Cinematic</option>
              </select>
            </div>
            <div>
              <label htmlFor="voice_code" className={fieldLabelClass}>
                {t.voice}
              </label>
              <select
                id="voice_code"
                name="voice_code"
                value={voiceCode}
                onChange={(e) => setVoiceCode(e.target.value)}
                className={nativeSelectClass}
              >
                <option value="">{voiceOptions.default}</option>
                {(copyLanguage === "tn" || copyLanguage === "ar") && (
                  <>
                    <option value={TUNISIAN_VOICES[0]}>Salim</option>
                    <option value={TUNISIAN_VOICES[1]}>Tounsia</option>
                  </>
                )}
                <option value="femme_emirate">{voiceOptions.femme_emirate}</option>
                <option value="homme_saudi">{voiceOptions.homme_saudi}</option>
              </select>
              <p className="text-[11px] text-coffee/45 mt-2">
                La langue choisit la voix automatiquement si aucune voix manuelle n&apos;est selectionnee.
              </p>
            </div>
            <div>
              <label htmlFor="subtitle_mode" className={fieldLabelClass}>
                {t.subtitleMode}
              </label>
              <select
                id="subtitle_mode"
                name="subtitle_mode"
                value={subtitleModeApi}
                onChange={(e) => setSubtitleModeApi(e.target.value)}
                className={nativeSelectClass}
              >
                <option value="">{subtitleOptions.auto}</option>
                <option value="ass_phrase">{subtitleOptions.phrase}</option>
                <option value="ass_word">{subtitleOptions.word}</option>
                <option value="drawtext">{subtitleOptions.classic}</option>
                <option value="none">{subtitleOptions.none}</option>
              </select>
            </div>
            <div>
              <label htmlFor="subtitle_style" className={fieldLabelClass}>
                {t.subtitleStyle}
              </label>
              <select
                id="subtitle_style"
                name="subtitle_style"
                value={subtitleStyleApi}
                onChange={(e) => setSubtitleStyleApi(e.target.value)}
                className={nativeSelectClass}
              >
                <option value="default">Default</option>
                <option value="social">Social</option>
                <option value="movie">Movie</option>
                <option value="tiktok">TikTok</option>
                <option value="karaoke">Karaoke</option>
                <option value="capcut">CapCut</option>
              </select>
            </div>
          </div>
        </details>

        {/* Generate Button */}
        <div className="pt-8 flex flex-col items-center gap-6">
          <div className="w-full max-w-md space-y-4">
            <AnimatePresence mode="wait">
              {status?.type === "error" && (
                <motion.div
                  key="form-error"
                  id="error"
                  role="alert"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                >
                  {status.message}
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {((status && status.type === "success") || (isGenerating && !status)) && (
                <motion.div
                  id="status"
                  role="status"
                  aria-live="polite"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  className="p-4 rounded-xl text-sm font-medium text-center border border-emerald-500/25 bg-emerald-500/10 text-emerald-100/95"
                >
                  {status?.type === "success" && status.message && <p>{status.message}</p>}
                  {isGenerating && !status && <p>{t.statusQueued}</p>}
                  {statusStepLabel && (
                    <p className="text-xs mt-2 font-normal text-coffee/70">{statusStepLabel}</p>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {activeJobId && jobProgress && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-3 bg-cream/20 rounded-lg border border-terracotta/20"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs uppercase tracking-wider opacity-60">{t.jobStatus}</span>
                    <span className="text-xs font-mono">{activeJobId.substring(0, 8)}...</span>
                  </div>
                  <div className="text-lg font-serif italic mb-3 text-coffee">{jobProgress.status}</div>

                  <div
                    id="result"
                    ref={resultRef}
                    className={jobProgress.download_url ? "ux-result-ready space-y-4" : "space-y-4"}
                  >
                    {jobProgress.download_url && (
                      <>
                        <div className="relative aspect-video rounded-xl overflow-hidden bg-black shadow-inner border border-terracotta/10">
                          {videoBuffering && (
                            <div className="ux-video-loader z-10">
                              <Loader2 size={22} className="animate-spin text-terracotta" />
                              <span>{t.videoPreparing}</span>
                            </div>
                          )}
                          <video
                            id="videoPlayer"
                            ref={videoRef}
                            src={jobProgress.download_url}
                            controls
                            playsInline
                            className="relative z-[1] w-full h-full object-contain"
                            poster="https://picsum.photos/seed/gourmet/800/450?blur=2"
                            onLoadedData={() => {
                              setVideoBuffering(false);
                              const el = videoRef.current;
                              if (!el) return;
                              el.play().catch(() => setAutoplayHint(true));
                            }}
                            onPlaying={() => setAutoplayHint(false)}
                          >
                            {t.videoNotSupported}
                          </video>
                        </div>
                        {autoplayHint && (
                          <p className="text-xs text-center text-coffee/55">{t.autoplayBlocked}</p>
                        )}

                        <div className="flex flex-wrap justify-center gap-3">
                          <motion.a
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            href={jobProgress.download_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 px-6 py-2.5 bg-terracotta text-cream rounded-full text-sm font-medium hover:bg-coffee transition-colors shadow-lg shadow-terracotta/20 ring-2 ring-terracotta/20"
                          >
                            <Video size={16} />
                            {t.fullScreen}
                          </motion.a>

                          <motion.a
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            href={jobProgress.download_url}
                            download="video.mp4"
                            className="inline-flex items-center gap-2 px-7 py-2.5 bg-emerald-600 text-white rounded-full text-sm font-semibold hover:bg-emerald-500 transition-colors shadow-lg shadow-emerald-900/30 ring-2 ring-emerald-400/30"
                          >
                            <Download size={18} />
                            {t.downloadCta}
                          </motion.a>

                          <button
                            type="button"
                            onClick={() => window.location.reload()}
                            className="inline-flex items-center gap-2 px-6 py-2 bg-cream text-coffee border border-coffee/10 rounded-full text-sm font-medium hover:bg-white transition-colors"
                          >
                            {t.newCreation}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <motion.button
            id="submitBtn"
            whileHover={!canSubmit || isGenerating ? {} : { scale: 1.02 }}
            whileTap={!canSubmit || isGenerating ? {} : { scale: 0.98 }}
            onClick={handleGenerate}
            disabled={!canSubmit || isGenerating}
            title={
              !canSubmit
                ? files.length === 0
                  ? t.validationMedia
                  : promoText.trim().length < MIN_PROMO_CHARS
                    ? t.validationText
                    : t.apiOffline
                : undefined
            }
            className={`
              relative group overflow-hidden
              px-12 py-5 rounded-full
              bg-gradient-to-r from-terracotta via-caramel to-terracotta
              text-cream font-serif text-xl font-semibold tracking-wide
              shadow-2xl shadow-terracotta/30
              flex items-center gap-3
              transition-all duration-300
              ${!canSubmit || isGenerating ? "opacity-70 cursor-not-allowed" : ""}
            `}
          >
            <div className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity" />
            {isGenerating ? (
              <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <ChefHat size={24} />
            )}
            <span>{isGenerating ? t.generating : t.generate}</span>
            {!isGenerating && <Sparkles size={20} className="text-cream/60" />}
          </motion.button>

          {isGenerating && (
            <motion.button
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={handleStop}
              className="flex items-center gap-2 text-terracotta hover:text-terracotta/80 transition-colors font-medium text-sm"
            >
              <Square size={14} fill="currentColor" />
              <span>{t.stopGenerating}</span>
            </motion.button>
          )}
          
          <div className="flex items-center gap-8 text-coffee/60">
            <div className="flex items-center gap-2">
              <Coffee size={16} />
              <span className="text-xs uppercase tracking-widest">{t.quality4k}</span>
            </div>
            <div className="flex items-center gap-2">
              <UtensilsCrossed size={16} />
              <span className="text-xs uppercase tracking-widest">{t.gastronomicAI}</span>
            </div>
          </div>
        </div>
      </main>

      {/* Footer Decoration */}
      <footer className="mt-20 pt-10 border-t border-coffee/5 text-center">
        <p className="text-coffee/30 text-sm font-serif italic">
          {t.footerText}
        </p>
      </footer>
    </div>
  );
}
