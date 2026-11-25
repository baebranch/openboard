/**
 * Slides panel: the board's top-level frames (not component masters) as numbered previews, in
 * reading order (core/export/slides). Choosing a slide selects its frame and fits it in view;
 * double-click presents from it. The footer starts presentation mode and exports every slide as
 * one multi-page PDF.
 */
import { useId } from 'react';
import type { FrameElement } from '../../core/model/types';
import { t } from '../i18n/t';
import { Icon } from '../icons';

export interface SlidesPanelProps {
  slides: readonly FrameElement[];
  previews: ReadonlyMap<string, string | undefined>;
  /** Ids of selected elements, to mark the current slide. */
  selection: readonly string[];
  readOnly?: boolean;
  /** Whether standalone component masters are slides too (off by default). */
  includeComponents: boolean;
  onIncludeComponentsChange(include: boolean): void;
  onGoTo(frame: FrameElement): void;
  onPresent(index: number): void;
  onExportPdf(): void;
  onClose?(): void;
  id?: string;
}

export function SlidesPanel({
  slides,
  previews,
  selection,
  readOnly = false,
  includeComponents,
  onIncludeComponentsChange,
  onGoTo,
  onPresent,
  onExportPdf,
  onClose,
  id,
}: SlidesPanelProps) {
  const current = slides.findIndex((s) => selection.includes(s.id));
  const includeId = useId();
  return (
    <aside
      id={id}
      className="ob-components ob-board-panel ob-slides"
      aria-label={t('Slides')}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose?.();
        }
      }}
    >
      <h2 className="ob-components-title">{t('Slides')}</h2>
      <div className="ob-board-panel-body">
        {slides.length === 0 ? (
          <p className="ob-components-empty" role="status">
            {t('No slides yet. Every top-level frame on the board becomes a slide.')}
          </p>
        ) : (
          <ol className="ob-slide-list">
            {slides.map((s, i) => {
              const name = s.name || t('Frame');
              const src = previews.get(s.id);
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    className="ob-slide-card"
                    aria-current={i === current ? 'true' : undefined}
                    aria-label={t('Slide {0}: {1}', i + 1, name)}
                    title={t('Slide {0}: {1}. Double-click to present from here.', i + 1, name)}
                    onClick={() => onGoTo(s)}
                    onDoubleClick={() => onPresent(i)}
                  >
                    <span className="ob-slide-number" aria-hidden="true">
                      {i + 1}
                    </span>
                    <span className="ob-thumb ob-slide-thumb" aria-hidden="true" style={{ aspectRatio: `${Math.max(1, s.width)} / ${Math.max(1, s.height)}` }}>
                      {src ? <img src={src} alt="" draggable={false} /> : null}
                    </span>
                    <span className="ob-slide-name">{name}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </div>
      <div className="ob-slides-options">
        <input
          id={includeId}
          type="checkbox"
          checked={includeComponents}
          onChange={(e) => onIncludeComponentsChange(e.target.checked)}
        />
        <label htmlFor={includeId} title={t('Show each component master as its own slide. Frames that use a component always show it.')}>
          {t('Include components')}
        </label>
      </div>
      <div className="ob-slides-footer">
        <button type="button" disabled={slides.length === 0} onClick={() => onPresent(current >= 0 ? current : 0)}>
          <Icon name="present" size={16} />
          <span>{t('Present')}</span>
        </button>
        <button type="button" disabled={slides.length === 0 || readOnly} onClick={onExportPdf}>
          <Icon name="pdf" size={16} />
          <span>{t('Export PDF')}</span>
        </button>
      </div>
    </aside>
  );
}
