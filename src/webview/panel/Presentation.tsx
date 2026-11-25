/**
 * Presentation mode: covers the whole editor (toolbars, panels, canvas) and shows one slide at a
 * time, fitted to the window. Slides are the board's frames in panel order.
 *
 * Keys: Right / Down / PageDown / Space / Enter next, Left / Up / PageUp / Backspace previous,
 * Home / End first / last, digits then Enter jump to that slide number, Escape exits. Clicking the
 * slide goes forward. While presenting, no key reaches the board's own shortcuts, so nothing on the
 * board can change; shortcuts with Ctrl, Cmd or Alt still reach VS Code.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { framesById } from '../../core/export/slides';
import { t } from '../i18n/t';
import { Icon } from '../icons';
import { goToSlide, stopPresentation, usePresentation } from '../presentation';
import { store as defaultStore, useWebviewState, type WebviewStore } from '../store';
import { useThemePalette } from '../theme/useThemePalette';
import { frameImage } from './thumbnails';

/** Controls fade out after this long without pointer movement. */
const CONTROLS_IDLE_MS = 2500;

export function Presentation({ store = defaultStore }: { store?: WebviewStore }) {
  const state = usePresentation();
  const { doc } = useWebviewState(store);
  const palette = useThemePalette();
  // The slides chosen when presenting started; frames deleted meanwhile drop out.
  const slides = useMemo(() => (doc && state ? framesById(doc.elements, state.frameIds).frames : []), [doc, state?.frameIds]);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const [idle, setIdle] = useState(false);

  const count = slides.length;
  const index = state ? Math.min(state.index, Math.max(0, count - 1)) : 0;
  const slide = slides[index];
  const src = doc && slide ? frameImage(doc, slide, palette, 'theme') : undefined;

  // Leave presentation mode when there is nothing to show (all frames deleted).
  useEffect(() => {
    if (state && count === 0) stopPresentation();
  }, [state, count]);

  // Focus the stage on entry; give focus back to where it was on exit.
  useEffect(() => {
    if (!state) return;
    const before = document.activeElement as HTMLElement | null;
    root.current?.focus();
    return () => before?.focus?.();
  }, [state !== undefined]);

  // Keys go to the presentation first (capture phase), so the board's shortcuts never see them.
  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.target === input.current) return; // the slide-number field handles its own keys
      const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
      let act: (() => void) | undefined;
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
        case 'PageDown':
        case ' ':
        case 'Enter':
          act = () => goToSlide(index + 1, count);
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
        case 'PageUp':
        case 'Backspace':
          act = () => goToSlide(index - 1, count);
          break;
        case 'Home':
          act = () => goToSlide(0, count);
          break;
        case 'End':
          act = () => goToSlide(count - 1, count);
          break;
        case 'Escape':
          act = stopPresentation;
          break;
        case 'Tab':
          return; // keep keyboard access to the controls
        default:
          if (plain && /^[0-9]$/.test(e.key)) {
            act = () => {
              setDraft(e.key);
              input.current?.focus();
            };
          }
      }
      e.stopPropagation();
      if (plain || act) e.preventDefault();
      if (plain) act?.();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [state, index, count]);

  // Fade the controls after a pause; any pointer movement shows them again.
  useEffect(() => {
    if (!state) return;
    let timer = setTimeout(() => setIdle(true), CONTROLS_IDLE_MS);
    const wake = (): void => {
      setIdle(false);
      clearTimeout(timer);
      timer = setTimeout(() => setIdle(true), CONTROLS_IDLE_MS);
    };
    window.addEventListener('pointermove', wake);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pointermove', wake);
    };
  }, [state !== undefined]);

  if (!state || !slide) return null;

  const jump = (): void => {
    const n = Number.parseInt(draft ?? '', 10);
    if (Number.isFinite(n)) goToSlide(n - 1, count);
    setDraft(undefined);
    root.current?.focus();
  };
  const name = slide.name || t('Frame');

  return (
    <div
      ref={root}
      className="ob-presentation"
      role="dialog"
      aria-modal="true"
      aria-label={t('Presentation')}
      tabIndex={-1}
      data-idle={idle ? 'true' : undefined}
      style={{ background: palette.background }}
    >
      <div className="ob-presentation-stage" onClick={() => goToSlide(index + 1, count)}>
        {src ? <img src={src} alt={t('Slide {0}: {1}', index + 1, name)} draggable={false} /> : null}
      </div>
      <div className="ob-presentation-controls" role="toolbar" aria-label={t('Presentation controls')}>
        <button type="button" aria-label={t('Previous slide')} title={t('Previous slide')} disabled={index === 0} onClick={() => goToSlide(index - 1, count)}>
          <Icon name="chevronLeft" size={18} />
        </button>
        <span className="ob-presentation-counter">
          <input
            ref={input}
            type="text"
            inputMode="numeric"
            aria-label={t('Slide number')}
            title={t('Type a slide number and press Enter')}
            value={draft ?? String(index + 1)}
            size={Math.max(2, String(count).length)}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ''))}
            onBlur={() => setDraft(undefined)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') {
                e.preventDefault();
                jump();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setDraft(undefined);
                root.current?.focus();
              }
            }}
          />
          <span aria-hidden="true">/ {count}</span>
        </span>
        <button
          type="button"
          aria-label={t('Next slide')}
          title={t('Next slide')}
          disabled={index >= count - 1}
          onClick={() => goToSlide(index + 1, count)}
        >
          <Icon name="chevronRight" size={18} />
        </button>
        <span className="ob-presentation-title" title={name}>
          {name}
        </span>
        <button type="button" aria-label={t('Exit presentation')} title={t('Exit presentation (Esc)')} onClick={stopPresentation}>
          <Icon name="close" size={18} />
        </button>
      </div>
      <p className="ob-sr-only" role="status" aria-live="polite">
        {t('Slide {0} of {1}: {2}', index + 1, count, name)}
      </p>
    </div>
  );
}
