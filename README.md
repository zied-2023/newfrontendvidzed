<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/74c6a058-b189-4b73-a23c-f17fa0b4bec5

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## API vidéo & options avancées (frontend)

- **`VITE_API_URL`** : base de l’API (ex. `https://…` ou `http://127.0.0.1:3000` si vous passez par le proxy `server.ts`). Voir [.env.example](.env.example).
- **`VITE_VIDEO_API_V2=1`** (ou `true` / `yes`) : affiche dans **Options avancées** le bloc aligné sur **video-agent-api** (`cta_enabled`, `cta_phone`, `cta_address`, `cta_duration`, `cta_logo` fichier, `cta_logo_url`, `safe_zone_mode`, `output_formats`, `text_style`, `hook_intensity`, `parallel_encoding`). Sans cette variable, ces champs ne sont **pas** envoyés et l’UI reste minimaliste.
- Après toute modification de variable `VITE_*`, **redémarrer** le serveur Vite (`npm run dev`) pour que le navigateur les prenne en compte.
