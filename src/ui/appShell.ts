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

/**
 * The other half of the condition, exported so that the rules which depend on
 * it are written once. Installed on a desktop there is a pointer and room for
 * the strip, so only a touch device gets the phone shape.
 */
export const TOUCH = '(pointer: coarse)';

/**
 * The other end of the same question: a mouse, on a device that can hover at
 * all. What "desktop" means here is the input, not the screen -- the same
 * argument the toolbar's placement rule makes.
 *
 * Asked live wherever it is used rather than answered once at startup: a hybrid
 * laptop replies differently depending on which input the person last touched,
 * so anything gated on it should follow them between the two.
 */
export const FINE = '(hover: hover) and (pointer: fine)';

/**
 * Where a control that wants a keyboard, a pointer and room to work is not
 * offered at all.
 *
 * A media query list, so the comma is an OR: a touch device, or a window too
 * narrow to spare the space. The width arm is the only breakpoint in the app,
 * and it is not the one the toolbar deliberately refused -- that argument is
 * about *placing* a strip that exists either way, where a phone in landscape is
 * 844px wide and still a phone. This asks a different question: whether there
 * is anywhere sensible to put a two-minute video, a text caret, or a frame
 * dragged with a mouse. A desktop window squeezed to a column fails it too, and
 * that is the right answer rather than a side effect.
 *
 * Not the same question as FINE above, which asks whether there is a mouse to
 * hover with. A narrow window on a laptop passes that and fails this, and both
 * answers are right: you can still aim an eraser in a column of a window, and
 * there is still nowhere in it to put a video.
 *
 * Read by the stylesheet alone. The guards in the app ask the strip whether a
 * cell is on offer (Toolbar.offers) rather than asking this again, so there is
 * one answer rather than two that can disagree.
 */
export const HANDHELD = `${TOUCH}, (max-width: 640px)`;

/**
 * The same question the CSS asks, for the one decision that cannot be made in
 * a stylesheet: whether opening settings should also push a history entry.
 */
export function isAppShell(): boolean {
  return document.documentElement.hasAttribute('data-standalone')
    && window.matchMedia(TOUCH).matches;
}

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
