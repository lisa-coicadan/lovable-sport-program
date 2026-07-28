import { useEffect } from 'react';
import { registerSW } from 'virtual:pwa-register';
import { toast } from '@/components/ui/sonner';

const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const UPDATE_TOAST_ID = 'app-update-available';

// Le check de mise à jour du service worker (registerType: "autoUpdate", vite.config.ts)
// se fait tout seul en arrière-plan pour le cache offline, mais on ne s'y fie PAS pour
// prévenir l'utilisatrice : sur iOS/WebKit, ce check est connu pour être capricieux en
// mode PWA installée — testé en conditions réelles, même fermer complètement l'app et la
// rouvrir ne le déclenche pas de façon fiable (parfois il faut retenter plusieurs fois,
// parfois jamais). On détecte donc la nouvelle version nous-mêmes via un simple fetch de
// la page (soumis aux mêmes en-têtes no-cache que le SW, mais sans la même fragilité
// côté navigateur) et c'est nous qui décidons quand proposer le reload — jamais de reload
// silencieux qui couperait une séance en cours.
const PWAUpdatePrompt = () => {
  useEffect(() => {
    // Laisse le SW se mettre à jour silencieusement ; onNeedReload no-op pour ne jamais
    // déclencher le reload automatique par défaut de vite-plugin-pwa en mode autoUpdate.
    registerSW({ onNeedReload: () => {} });

    const currentBuildId = document
      .querySelector('meta[name="app-build-id"]')
      ?.getAttribute('content');

    let updateAvailable = false;

    function showUpdateToast() {
      toast('Nouvelle version disponible', {
        id: UPDATE_TOAST_ID,
        description: 'Recharger effacera la séance en cours si tu es en plein entraînement.',
        duration: 30000,
        action: {
          label: 'Recharger',
          onClick: () => window.location.reload(),
        },
      });
    }

    async function checkForNewVersion() {
      if (updateAvailable) {
        showUpdateToast();
        return;
      }
      try {
        const res = await fetch('/', { cache: 'no-store' });
        const html = await res.text();
        const latestBuildId = html.match(/<meta name="app-build-id" content="([^"]+)"/)?.[1];
        if (latestBuildId && currentBuildId && latestBuildId !== currentBuildId) {
          updateAvailable = true;
          showUpdateToast();
        }
      } catch {
        // Pas de réseau : on retentera au prochain check.
      }
    }

    const interval = setInterval(checkForNewVersion, CHECK_INTERVAL_MS);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') checkForNewVersion();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', checkForNewVersion);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', checkForNewVersion);
    };
  }, []);

  return null;
};

export default PWAUpdatePrompt;
