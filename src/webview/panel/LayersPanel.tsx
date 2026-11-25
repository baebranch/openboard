/**
 * Layers panel: every element on the board as a tree (frames and their children), topmost first.
 * Choosing a row selects the element (Shift or Ctrl/Cmd adds or removes it); double-click also fits
 * it in view. Rows with children expand and collapse; the selection's ancestors open automatically
 * and the selected row scrolls into view. View-only: nothing here edits the document.
 */
import { useEffect, useId, useMemo, useRef, useState, type MouseEvent } from 'react';
import type { BoardDocument, ElementId } from '../../core/model/types';
import { rotatedBounds } from '../../core/model/geometry';
import { emitFocusBounds } from '../canvas/viewportBus';
import { t } from '../i18n/t';
import { Icon } from '../icons';
import { ancestorIds, countLayers, filterLayers, layerIcon, layerKind, layerLabel, layerTree, type LayerNode } from './layers-model';

export interface LayersPanelProps {
  doc: Pick<BoardDocument, 'elements'>;
  selection: readonly ElementId[];
  onSelect(ids: ElementId[]): void;
  onClose?(): void;
  id?: string;
}

export function LayersPanel({ doc, selection, onSelect, onClose, id }: LayersPanelProps) {
  const full = useMemo(() => layerTree(doc), [doc]);
  const [query, setQuery] = useState('');
  const searching = query.trim() !== '';
  const tree = useMemo(() => filterLayers(full, query), [full, query]);
  const searchId = useId();
  const [expanded, setExpanded] = useState<ReadonlySet<ElementId>>(() => new Set());
  const selected = useMemo(() => new Set(selection), [selection]);
  const body = useRef<HTMLDivElement>(null);

  // Reveal the selection: open its ancestors, then scroll the first selected row into view.
  useEffect(() => {
    const open = selection.flatMap((s) => ancestorIds(doc, s));
    if (open.some((a) => !expanded.has(a))) setExpanded((cur) => new Set([...cur, ...open]));
    // `expanded` is read, not tracked: collapsing a selected element's parent must stay possible.
  }, [selection, doc]);
  useEffect(() => {
    const first = selection[0];
    if (first === undefined) return;
    const rows = body.current?.querySelectorAll<HTMLElement>('[data-layer-id]') ?? [];
    const row = Array.from(rows).find((r) => r.dataset['layerId'] === first);
    row?.scrollIntoView?.({ block: 'nearest' });
  }, [selection, expanded]);

  const toggle = (nodeId: ElementId): void =>
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });

  const choose = (e: MouseEvent, nodeId: ElementId): void => {
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      onSelect(selected.has(nodeId) ? selection.filter((s) => s !== nodeId) : [...selection, nodeId]);
    } else onSelect([nodeId]);
  };

  const row = (n: LayerNode) => {
    const label = layerLabel(n.el);
    // While searching, every path to a match is open.
    const open = searching || expanded.has(n.el.id);
    const hasKids = n.children.length > 0;
    return (
      <li key={n.el.id}>
        <div
          className="ob-layer-row"
          data-layer-id={n.el.id}
          data-kind={layerKind(n.el)}
          data-selected={selected.has(n.el.id) ? 'true' : undefined}
          style={{ paddingLeft: 4 + n.depth * 14 }}
        >
          {hasKids && !searching ? (
            <button
              type="button"
              className="ob-layer-toggle"
              aria-expanded={open}
              aria-label={open ? t('Collapse {0}', label) : t('Expand {0}', label)}
              title={open ? t('Collapse {0}', label) : t('Expand {0}', label)}
              onClick={() => toggle(n.el.id)}
            >
              <Icon name="chevronRight" size={12} />
            </button>
          ) : (
            <span className="ob-layer-toggle-spacer" aria-hidden="true" />
          )}
          <button
            type="button"
            className="ob-layer-item"
            aria-pressed={selected.has(n.el.id)}
            title={label}
            onClick={(e) => choose(e, n.el.id)}
            onDoubleClick={() => emitFocusBounds(rotatedBounds(n.el))}
          >
            <Icon name={layerIcon(n.el)} size={14} />
            <span className="ob-layer-name">{label}</span>
          </button>
        </div>
        {hasKids && open ? <ul className="ob-layer-list">{n.children.map(row)}</ul> : null}
      </li>
    );
  };

  return (
    <aside
      id={id}
      className="ob-components ob-board-panel ob-layers"
      aria-label={t('Layers')}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose?.();
        }
      }}
    >
      <h2 className="ob-components-title">{t('Layers')}</h2>
      <div className="ob-layer-search" role="search">
        <label htmlFor={searchId} className="ob-sr-only">
          {t('Search layers')}
        </label>
        <Icon name="search" size={14} />
        <input
          id={searchId}
          type="search"
          value={query}
          placeholder={t('Search layers')}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            // Escape clears a search first; a second Escape closes the panel.
            if (e.key === 'Escape' && query !== '') {
              e.stopPropagation();
              setQuery('');
            }
          }}
        />
      </div>
      {searching ? (
        <p className="ob-sr-only" role="status" aria-live="polite">
          {t('{0} matching layers', countLayers(tree))}
        </p>
      ) : null}
      <div ref={body} className="ob-board-panel-body">
        {tree.length === 0 ? (
          <p className="ob-components-empty" role="status">
            {searching ? t('No layers match "{0}".', query.trim()) : t('The board is empty.')}
          </p>
        ) : (
          <ul className="ob-layer-list">{tree.map(row)}</ul>
        )}
      </div>
    </aside>
  );
}
