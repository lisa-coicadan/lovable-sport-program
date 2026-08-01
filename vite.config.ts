import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import fs from "fs";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

// Identifiant unique par build, injecté dans index.html (voir le plugin ci-dessous) pour
// que le client puisse détecter une nouvelle version par un simple fetch de la page —
// voir le commentaire dans PWAUpdatePrompt.tsx pour le pourquoi (le check de mise à jour
// natif du service worker est trop capricieux sur iOS/WebKit pour qu'on s'y fie seul).
const buildId = String(Date.now());

// Lu via fs plutôt qu'un import JSON ESM (évite les soucis d'assertion de type selon
// l'environnement Node) — le hook .claude/hooks/version-bump/ maintient ce champ à jour.
const appVersion = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "package.json"), "utf-8")
).version as string;

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
          `<head>\n    <meta name="app-build-id" content="${buildId}" />\n    <meta name="app-version" content="${appVersion}" />`
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
        // Défaut de vite-plugin-pwa ("index.html") : ça fait intercepter TOUTE navigation
        // par le SW, qui sert alors le index.html précaché par le SW actuellement actif —
        // même un reload ou une réouverture d'icône, peu importe ce qu'il y a sur le
        // réseau. Combiné à injectRegister:false ci-dessus (qui désactive aussi l'injection
        // auto de skipWaiting/clientsClaim, voir juste en dessous), un SW une fois installé
        // ne se faisait jamais remplacer : piège permanent, confirmé en prod (sw.js live
        // inspecté). On désactive complètement l'interception du shell HTML — la fraîcheur
        // d'index.html repose uniquement sur le réseau (déjà cache-control: no-cache côté
        // serveur, vérifié). Le SW garde le précache des assets JS/CSS/images pour l'offline.
        navigateFallback: null,
        skipWaiting: true,
        clientsClaim: true,
        navigateFallbackDenylist: [/^\/~oauth/],
        // Piège restant même avec navigateFallback:null (confirmé en lisant le code source
        // de workbox-precaching/PrecacheRoute.js) : le SW précache "index.html" et ajoute
        // une route qui matche explicitement "/" vers cette entrée précachée (résolution
        // "directoryIndex"), INDÉPENDAMMENT de navigateFallback — ça ne concerne que les
        // navigations non matchées. Donc "/" restait servi depuis le cache du SW installé,
        // jamais depuis le réseau, sur reload comme sur réouverture d'icône. C'est aussi ce
        // qui rendait notre propre check de version (fetch('/') dans PWAUpdatePrompt.tsx)
        // aveugle : il comparait la version au SW... avec lui-même. On exclut totalement
        // index.html du précache : plus aucune route SW ne matche "/", il tombe toujours
        // sur le réseau (fallbackToNetwork, comportement par défaut du PrecacheController).
        globIgnores: ["**/index.html"],
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
