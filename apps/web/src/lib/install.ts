import { useCallback, useEffect, useState } from 'react';

/**
 * Cross-platform "add to home screen" handling.
 *
 * - Chromium/Android expose `beforeinstallprompt`, which we capture and replay
 *   on demand so a button click can trigger the native install dialog.
 * - iOS/Safari never fire that event, so we expose `isIos` + `needsManual` and
 *   the UI shows the Share → Add to Home Screen instructions instead.
 * - `isStandalone` is true once the app is launched from the home screen.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'visahobe.install.dismissed';

function detectIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const iOS = /iphone|ipad|ipod/i.test(ua);
  // iPadOS 13+ reports as Macintosh; the touch check disambiguates it.
  const iPadOS = /macintosh/i.test(ua) && typeof document !== 'undefined' && 'ontouchend' in document;
  return iOS || iPadOS;
}

function detectStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export function useInstall() {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [isIos] = useState(detectIos);

  useEffect(() => {
    setIsStandalone(detectStandalone());
    try {
      setDismissed(localStorage.getItem(DISMISS_KEY) === '1');
    } catch {
      /* ignore */
    }
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setPromptEvent(null);
      setIsStandalone(true);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const promptInstall = useCallback(async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
    if (!promptEvent) return 'unavailable';
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    setPromptEvent(null);
    return choice.outcome;
  }, [promptEvent]);

  const dismiss = useCallback(() => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* ignore */
    }
  }, []);

  const canInstall = !isStandalone && !installed && !dismissed;
  return { canInstall, canPrompt: promptEvent !== null, isIos, isStandalone, installed, promptInstall, dismiss };
}
