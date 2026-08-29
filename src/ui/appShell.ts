/**
 * Whether Walky is running as an installed app, answered once on `<html>`.
 *
 * Installed to a home screen the page is not a page any more: there is no
 * browser chrome above it and no mouse, so the toolbar moves off the top-left
 * corner and becomes a bar within reach of a thumb. That is a layout decision,
 * so it is stamped as an attribute and made entirely in CSS -- one place says
 * what "the installed app" means, and every rule that cares reads it.
 *
 * `navigator.standalone` is the second clause because it is the only signal iOS
 * gives for a home-screen launch; `display-mode` covers everything else.
 */

const STANDALONE = '(display-mode: standalone)';

function isStandalone(query: MediaQueryList): boolean {
  return query.matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function markAppShell(): void {
  let query: MediaQueryList;
  try {
    query = window.matchMedia(STANDALONE);
  } catch {
    return;
  }

  const apply = () => {
    const root = document.documentElement;
    if (isStandalone(query)) root.dataset.standalone = '';
    else delete root.dataset.standalone;
  };

  apply();
  // Android can hand a running page between a tab and an installed window.
  query.addEventListener('change', apply);
}
