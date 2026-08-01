import { useEffect } from 'react';
import { registerSW } from 'virtual:pwa-register';
import { toast } from '@/components/ui/sonner';

const CHECK_INTERVAL_MS = 60 * 1000;
const UPDATE_TOAST_ID = 'app-update-available';

// Le check de mise à jour du service worker (registerType: "autoUpdate", vite.config.ts)
// se fait tout seul en arrière-plan pour le cache offline, mais on ne s'y fie PAS pour
// prévenir l'utilisatrice : sur iOS/WebKit, ce check est connu pour être capricieux en
// mode PWA installée — testé en conditions réelles, même fermer complètement l'app et la
// rouvrir ne le déclenche pas de façon fiable (parfois il faut retenter plusieurs fois,
// parfois jamais). On détecte donc la nouvelle version nous-mêmes via un simple fetch de
// la page et c'est nous qui décidons quand proposer le reload — jamais de reload
// silencieux qui couperait une séance en cours.
const PWAUpdatePrompt = () => {
  useEffect(() => {
    let registration: ServiceWorkerRegistration | undefined;

    // onRegisteredSW nous donne la main sur le ServiceWorkerRegistration pour pouvoir
    // appeler nous-mêmes `.update()` plus loin (voir checkForNewVersion) — .update() force
    // le navigateur à re-télécharger sw.js immédiatement, sans attendre le délai interne
    // (~24h, encore plus flou sur iOS) que les navigateurs s'imposent pour leur propre
    // check automatique. onNeedReload reste no-op pour ne jamais déclencher le reload
    // automatique par défaut de vite-plugin-pwa en mode autoUpdate.
    registerSW({
      onNeedReload: () => {},
      onRegisteredSW: (_url, reg) => {
        registration = reg;
      },
    });

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
      // Force le SW à re-télécharger et comparer son propre script maintenant, au lieu de
      // compter sur la vérification automatique du navigateur (peu fréquente, capricieuse
      // sur iOS). Sans effet si aucun SW n'est encore enregistré.
      registration?.update().catch(() => {});

      if (updateAvailable) {
        showUpdateToast();
        return;
      }
      try {
        // Paramètre anti-cache dans l'URL : même si un ancien SW cassé (précache d'avant le
        // fix globIgnores de vite.config.ts) tournait encore sur cet appareil, sa route de
        // précache ne matche que l'URL exacte "/" — un paramètre inattendu ne matche rien
        // et retombe sur le réseau. Sans ça, ce fetch pouvait être répondu par le SW lui-même
        // depuis son propre cache, comparant la version... avec elle-même, sans jamais
        // détecter de retard (c'est ce qui expliquait le popup jamais vu).
        const res = await fetch(`/?swcheck=${Date.now()}`, { cache: 'no-store' });
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
    // Filet de sécurité supplémentaire : si un nouveau SW prend la main (skipWaiting +
    // clientsClaim, déjà activés) pendant qu'on est ouvert, on le sait immédiatement sans
    // attendre le prochain check périodique.
    navigator.serviceWorker?.addEventListener('controllerchange', checkForNewVersion);

    // Premier check immédiat au montage, sans attendre le premier intervalle (jusqu'à 60s).
    checkForNewVersion();

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', checkForNewVersion);
      navigator.serviceWorker?.removeEventListener('controllerchange', checkForNewVersion);
    };
  }, []);

  return null;
};

export default PWAUpdatePrompt;
