import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

// Identifiant unique par build, injecté dans index.html (voir le plugin ci-dessous) pour
// que le client puisse détecter une nouvelle version par un simple fetch de la page —
// voir le commentaire dans PWAUpdatePrompt.tsx pour le pourquoi (le check de mise à jour
// natif du service worker est trop capricieux sur iOS/WebKit pour qu'on s'y fie seul).
const buildId = String(Date.now());

export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: { overlay: false },
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    {
      name: "inject-build-id",
      transformIndexHtml(html: string) {
        return html.replace(
          "<head>",
          `<head>\n    <meta name="app-build-id" content="${buildId}" />`
        );
      },
    },
    VitePWA({
      registerType: "autoUpdate",
      // "auto" ne détecte pas fiablement notre appel manuel à `virtual:pwa-register`
      // (bug de timing dans vite-plugin-pwa 1.x : la détection tombe après la
      // résolution des options) — il générait un `registerSW.js` en plus, avec un
      // `navigator.serviceWorker.register()` brut qui bypasse nos callbacks.
      // PWAUpdatePrompt.tsx gère déjà l'enregistrement, donc on désactive l'injection.
      injectRegister: false,
      includeAssets: ["favicon.ico"],
      workbox: {
        navigateFallbackDenylist: [/^\/~oauth/],
      },
      manifest: {
        name: "Lisa Muscu",
        short_name: "Lisa Muscu",
        description: "Personal fitness tracker with 5/3/1 programming",
        theme_color: "#111114",
        background_color: "#111114",
        display: "standalone",
        orientation: "portrait",
        icons: [
          { src: "/pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512x512.png", sizes: "512x512", type: "image/png" },
        ],
      },
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
