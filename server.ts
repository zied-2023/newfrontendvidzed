import { createServer as createHttpServer } from "http";
import express from "express";
import { createServer as createViteServer, loadEnv } from "vite";
import react from "vite-plugin-react";
import multer from "multer";
import path from "path";
import fs from "fs";
import { createRequire } from "module";
import { pathToFileURL } from "url";
import axios from "axios";
import FormData from "form-data";

/** tsx breaks static import of @tailwindcss/vite — load via file URL */
async function loadTailwindVitePlugin() {
  const require = createRequire(import.meta.url);
  const resolved = require.resolve("tailwindcss-vite");
  const mod = await import(pathToFileURL(resolved).href);
  return mod.default;
}

const upload = multer({ dest: "uploads/" });
const GENERATE_UPLOAD = upload.fields([
  { name: "media", maxCount: 10 },
  { name: "audio", maxCount: 1 },
  { name: "cta_logo", maxCount: 1 },
]);
const EXTERNAL_API_URL = "https://video1-agent-api.onrender.com";

// Ensure uploads directory exists
if (!fs.existsSync("uploads")) {
  fs.mkdirSync("uploads");
}

async function startServer() {
  const app = express();
  const httpServer = createHttpServer(app);
  const PORT = 3000;

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  const healthPayload = () => ({ status: "ok", externalApi: EXTERNAL_API_URL });

  // Health check (les deux chemins pour coller au front qui teste /health puis /api/health)
  app.get("/health", (req, res) => {
    res.json(healthPayload());
  });
  app.get("/api/health", (req, res) => {
    res.json(healthPayload());
  });

  /** Proxy génération de texte (Mistral) — même contrat que le HTML statique */
  const forwardGenerateCopy = async (req: express.Request, res: express.Response) => {
    try {
      const forward = new FormData();
      for (const [k, v] of Object.entries(req.body)) {
        if (v !== undefined && v !== null) forward.append(k, String(v));
      }
      const response = await axios.post(`${EXTERNAL_API_URL}/generate-copy`, forward, {
        headers: { ...forward.getHeaders() },
        timeout: 180000,
      });
      res.status(response.status).json(response.data);
    } catch (e: any) {
      const status = e.response?.status || 500;
      const data = e.response?.data;
      const backendMessage =
        (typeof data?.message === "string" && data.message) ||
        (typeof data?.error === "string" && data.error) ||
        (typeof e.message === "string" ? e.message : "");
      const hasIllegalHeader =
        /illegal header value/i.test(backendMessage) && /bearer/i.test(backendMessage);

      if (hasIllegalHeader) {
        // Friendly actionable error: token likely contains trailing newline/whitespace.
        return res.status(502).json({
          status: "error",
          code: "MISTRAL_INVALID_AUTH_HEADER",
          message:
            "Mistral indisponible: en-tete Authorization invalide. Verifiez MISTRAL_API_KEY sur Render (retirer espaces, retours ligne, \\r/\\n).",
          details: "Expected 'Bearer <token>' without trailing newline.",
        });
      }

      if (data && typeof data === "object") {
        res.status(status).json(data);
      } else {
        res.status(status).json({ status: "error", message: e.message || "Erreur proxy generate-copy" });
      }
    }
  };
  app.post("/generate-copy", upload.none(), forwardGenerateCopy);
  app.post("/api/generate-copy", upload.none(), forwardGenerateCopy);

  const cleanupUploaded = (
    mediaList: Express.Multer.File[],
    audio?: Express.Multer.File,
    ctaLogo?: Express.Multer.File
  ) => {
    [...mediaList, ...(audio ? [audio] : []), ...(ctaLogo ? [ctaLogo] : [])].forEach((file) => {
      if (file?.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
    });
  };

  // API Route for video generation
  app.post("/api/generate", GENERATE_UPLOAD, async (req, res) => {
    const fieldFiles = req.files as Record<string, Express.Multer.File[]> | undefined;
    const mediaFiles = fieldFiles?.media ?? [];
    const audioMulterFile = fieldFiles?.audio?.[0];
    const ctaLogoMulterFile = fieldFiles?.cta_logo?.[0];
    console.log("--- Nouvelle requête de génération reçue ---");
    
    try {
      const { 
        promoText, 
        text,
        transition, 
        transition_preset,
        camera, 
        camera_style,
        music, 
        music_style,
        subtitleMode, 
        subtitle_mode,
        subtitleStyle, 
        subtitle_style,
        voice,
        voice_code,
        audio_mode,
        cta_enabled,
        cta_phone,
        cta_address,
        cta_duration,
        cta_logo_url,
        safe_zone_mode,
        output_formats,
        text_style,
        hook_intensity,
        parallel_encoding,
      } = req.body;

      const tr = String(transition || transition_preset || "");
      const cam = String(camera || camera_style || "");
      const mu = String(music || music_style || "");
      const subM = String(subtitleMode || subtitle_mode || "");
      const subS = String(subtitleStyle || subtitle_style || "");

      console.log("Forwarding request to external API:", EXTERNAL_API_URL);

      // Prepare form data for the external API
      const externalFormData = new FormData();
      
      // Add text fields
      // L'API semble attendre "text" au lieu de "promoText"
      const finalPromoText = text || promoText || "";
      externalFormData.append('text', finalPromoText);
      externalFormData.append('promoText', finalPromoText);
      externalFormData.append('transition', tr);
      externalFormData.append('transition_preset', tr);
      externalFormData.append('camera', cam);
      externalFormData.append('camera_style', cam);
      externalFormData.append('music', mu);
      externalFormData.append('music_style', mu);
      externalFormData.append('subtitleMode', subM);
      externalFormData.append('subtitle_mode', subM);
      externalFormData.append('subtitleStyle', subS);
      externalFormData.append('subtitle_style', subS);
      
      if (voice_code) {
        externalFormData.append('voice_code', voice_code);
      } else if (voice) {
        externalFormData.append('voice', voice);
      }

      const audioModeStr = audio_mode != null && String(audio_mode).trim() !== "" ? String(audio_mode).trim() : "";
      if (audioModeStr) {
        externalFormData.append("audio_mode", audioModeStr);
      }

      const appendIf = (key: string, val: unknown) => {
        if (val === undefined || val === null) return;
        const s = String(val).trim();
        if (s) externalFormData.append(key, s);
      };
      const appendBool = (key: string, val: unknown) => {
        if (val === undefined || val === null) return;
        const s = String(val).trim().toLowerCase();
        if (s === "true" || s === "1" || s === "yes") externalFormData.append(key, "true");
        else if (s === "false" || s === "0" || s === "no") externalFormData.append(key, "false");
      };

      appendBool("cta_enabled", cta_enabled);
      appendIf("cta_phone", cta_phone);
      appendIf("cta_address", cta_address);
      appendIf("cta_duration", cta_duration);
      appendIf("cta_logo_url", cta_logo_url);
      appendIf("safe_zone_mode", safe_zone_mode);
      appendIf("output_formats", output_formats);
      appendIf("text_style", text_style);
      appendIf("hook_intensity", hook_intensity);
      appendBool("parallel_encoding", parallel_encoding);

      // Add files
      if (mediaFiles.length > 0) {
        mediaFiles.forEach((file) => {
          externalFormData.append('media', fs.createReadStream(file.path), {
            filename: file.originalname,
            contentType: file.mimetype,
          });
        });
      }

      if (audioMulterFile) {
        externalFormData.append(
          "audio",
          fs.createReadStream(audioMulterFile.path),
          {
            filename: audioMulterFile.originalname,
            contentType: audioMulterFile.mimetype,
          }
        );
      }

      if (ctaLogoMulterFile) {
        externalFormData.append(
          "cta_logo",
          fs.createReadStream(ctaLogoMulterFile.path),
          {
            filename: ctaLogoMulterFile.originalname,
            contentType: ctaLogoMulterFile.mimetype,
          }
        );
      }

      // Forward to Render API
      // On utilise /generate comme suggéré dans votre snippet
      const targetUrl = `${EXTERNAL_API_URL}/generate`;
      console.log("Appel de l'URL cible externe:", targetUrl);

      const response = await axios.post(targetUrl, externalFormData, {
        headers: {
          ...externalFormData.getHeaders(),
        },
        timeout: 600000, 
      });

      console.log("Réponse de l'API externe reçue:", response.status);
      console.log("Corps de la réponse externe:", JSON.stringify(response.data).substring(0, 500));

      // Cleanup local files
      cleanupUploaded(mediaFiles, audioMulterFile, ctaLogoMulterFile);

      const responseData = response.data;
      
      // Si l'API renvoie explicitement un échec dans un 200 OK
      if (responseData && (responseData.status === 'failed' || responseData.status === 'error')) {
        return res.json({ 
          success: false, 
          error: responseData.message || responseData.error || "L'API externe a renvoyé un statut d'échec.",
          ...responseData 
        });
      }

      if (typeof responseData === 'object' && responseData !== null) {
        res.json({ success: true, ...responseData });
      } else {
        res.json({ success: true, data: responseData });
      }

    } catch (error: any) {
      console.error("External API error:", error.response?.data || error.message);
      
      // Cleanup local files on error
      cleanupUploaded(mediaFiles, audioMulterFile, ctaLogoMulterFile);

      let errorMessage = "Erreur lors de la communication avec l'API externe";
      if (error.code === 'ECONNABORTED') {
        errorMessage = "La requête a expiré (timeout). L'API externe est peut-être trop lente ou surchargée.";
      } else if (error.response?.data?.error) {
        errorMessage = error.response.data.error;
      } else if (error.response?.data?.message) {
        errorMessage = error.response.data.message;
      } else if (typeof error.response?.data?.detail === "string") {
        errorMessage = error.response.data.detail;
      } else if (Array.isArray(error.response?.data?.detail) && error.response.data.detail.length > 0) {
        const formatted = error.response.data.detail
          .slice(0, 3)
          .map((d: any) => {
            const loc = Array.isArray(d?.loc) ? d.loc.join(".") : "";
            const msg = typeof d?.msg === "string" ? d.msg : "";
            return loc && msg ? `${loc}: ${msg}` : msg || loc;
          })
          .filter(Boolean)
          .join(" | ");
        if (formatted) errorMessage = formatted;
      }

      res.status(error.response?.status || 500).json({ 
        success: false, 
        error: errorMessage 
      });
    }
  });

  // Route pour vérifier le statut d'un job
  app.get("/api/status/:jobId", async (req, res) => {
    try {
      const { jobId } = req.params;
      if (!jobId || jobId === 'undefined') {
        return res.status(400).json({ error: "ID de job invalide" });
      }

      console.log(`Vérification du statut pour le job: ${jobId}`);
      
      try {
        // Tentative 1: /status/:id
        const response = await axios.get(`${EXTERNAL_API_URL}/status/${jobId}`);
        return res.json(response.data);
      } catch (error: any) {
        if (error.response?.status === 404) {
          console.log(`404 sur /status/${jobId}, tentative sur /status?id=${jobId}`);
          // Tentative 2: /status?id=:id
          const responseAlt = await axios.get(`${EXTERNAL_API_URL}/status`, {
            params: { id: jobId }
          });
          return res.json(responseAlt.data);
        }
        throw error;
      }
    } catch (error: any) {
      console.error("Erreur lors de la vérification du statut:", error.response?.data || error.message);
      res.status(error.response?.status || 500).json({ 
        error: "Impossible de récupérer le statut",
        details: error.response?.data || error.message
      });
    }
  });

  // Route proxy pour le téléchargement de la vidéo
  app.get("/api/download/:jobId", async (req, res) => {
    try {
      const { jobId } = req.params;
      console.log(`Proxy de téléchargement pour le job: ${jobId}`);
      const qsParams = new URLSearchParams();
      for (const [k, v] of Object.entries(req.query)) {
        if (v === undefined) continue;
        if (typeof v === "string") qsParams.set(k, v);
        else if (Array.isArray(v)) {
          const first = v.find((x): x is string => typeof x === "string");
          if (first) qsParams.set(k, first);
        }
      }
      const qs = qsParams.toString();
      const downloadUrl = `${EXTERNAL_API_URL}/download/${jobId}${qs ? `?${qs}` : ""}`;
      
      const response = await axios({
        method: 'get',
        url: downloadUrl,
        responseType: 'stream'
      });

      // On transmet les headers importants
      res.setHeader('Content-Type', response.headers['content-type'] || 'video/mp4');
      if (response.headers['content-length']) {
        res.setHeader('Content-Length', response.headers['content-length']);
      }
      
      // On streame la vidéo vers le client
      response.data.pipe(res);
    } catch (error: any) {
      console.error("Erreur lors du proxy de téléchargement:", error.message);
      res.status(500).send("Erreur lors du téléchargement de la vidéo");
    }
  });

  // Vite middleware for development (inline config: tsx breaks loading vite.config.*)
  if (process.env.NODE_ENV !== "production") {
    const mode =
      process.env.NODE_ENV === "production" ? "production" : "development";
    const env = loadEnv(mode, process.cwd(), "");
    const tailwindcss = await loadTailwindVitePlugin();
    const vite = await createViteServer({
      root: process.cwd(),
      configFile: false,
      appType: "spa",
      plugins: [react(), tailwindcss()],
      define: {
        "process.env.GEMINI_API_KEY": JSON.stringify(env.GEMINI_API_KEY),
      },
      resolve: {
        alias: {
          "@": path.resolve(process.cwd(), "."),
        },
      },
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== "true",
      },
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
    app.get("*", (req, res) => {
      res.sendFile(path.resolve("dist/index.html"));
    });
  }

  httpServer.listen(PORT, () => {
    console.log(`Server running → http://127.0.0.1:${PORT} (recommandé) ou http://localhost:${PORT}`);
  });
}

startServer();
