/**
 * Component panel (Req 13.6, 26.2): a read-only list of Component_Masters in ascending order by name,
 * each shown as a preview with its name. Choosing one selects the master and fits it in view without
 * recording an Undo_History entry. Opened from the board panels toolbar (BoardPanels.tsx).
 */
import { useMemo } from 'react';
import type { MasterEntry } from '../../core/components/masters';
import { t } from '../i18n/t';

export interface ComponentPanelProps {
  masters: readonly MasterEntry[];
  onGoToMaster(master: MasterEntry): void;
  onClose?(): void;
  id?: string;
  /** Preview image (data URI) per master id; masters without one show only their name. */
  previews?: ReadonlyMap<string, string | undefined>;
}

/** Accessible names must be unique in the panel: masters sharing a name get their id appended. */
function uniqueLabels(masters: readonly MasterEntry[]): Map<string, string> {
  const counts = new Map<string, number>();
  for (const m of masters) counts.set(m.name, (counts.get(m.name) ?? 0) + 1);
  return new Map(masters.map((m) => [m.id, (counts.get(m.name) ?? 0) > 1 ? `${m.name} (${m.id})` : m.name]));
}

/** Pure view over the master list. */
export function ComponentPanel({ masters, onGoToMaster, onClose, id, previews }: ComponentPanelProps) {
  const labels = useMemo(() => uniqueLabels(masters), [masters]);
  return (
    <aside
      id={id}
      className="ob-components ob-board-panel"
      aria-label={t('Components')}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose?.();
        }
      }}
    >
      <h2 className="ob-components-title">{t('Components')}</h2>
      <div className="ob-board-panel-body">
        {masters.length === 0 ? (
          <p className="ob-components-empty" role="status">
            {t('No components yet. Select a frame and run Create Component.')}
          </p>
        ) : (
          <ul className="ob-components-list">
            {masters.map((m) => {
              const label = labels.get(m.id) ?? m.name;
              const src = previews?.get(m.id);
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    className={`ob-components-item${previews ? ' ob-components-card' : ''}`}
                    aria-label={t('Go To: {0}', label)}
                    title={t('Go To: {0}', label)}
                    onClick={() => onGoToMaster(m)}
                  >
                    <span className="ob-components-name">{m.name}</span>
                    {previews ? (
                      <span className="ob-thumb" aria-hidden="true">
                        {src ? <img src={src} alt="" draggable={false} /> : null}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
