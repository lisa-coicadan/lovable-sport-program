import { useEffect } from 'react';
import { registerSW } from 'virtual:pwa-register';
import { toast } from '@/components/ui/sonner';

// Without this, `registerType: "autoUpdate"` still fetches a new service worker in the
// background, but an installed iOS home-screen PWA is almost never fully "closed" — so
// the new SW can sit waiting to activate indefinitely and the person stays stuck on an
// old build with no signal anything changed. This surfaces that moment explicitly.
const PWAUpdatePrompt = () => {
  useEffect(() => {
    const updateSW = registerSW({
      onNeedRefresh() {
        toast('Nouvelle version disponible', {
          description: 'Recharge pour passer à la dernière version.',
          duration: Infinity,
          action: {
            label: 'Recharger',
            onClick: () => updateSW(true),
          },
        });
      },
    });
  }, []);

  return null;
};

export default PWAUpdatePrompt;
