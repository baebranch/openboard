import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { ACTIONS, ActionId, buildAction } from '../actions';
import { Icon } from '../icons';
import { dispatchOp } from '../ops';
import { store as defaultStore, useWebviewState, type WebviewStore } from '../store';
import { uiState as defaultUi, useUiState, type ToolId, type UiStateStore } from '../uiState';
import {
  buildComponentOp,
  buildFrameOp,
  isFrameMenuId,
  buildContextMenu,
  ComponentMenuId,
  isComponentMenuId,
  masterOf,
  type ContextMenuItem,
} from './contextMenu';
import { goToMaster } from './goToMaster';
import { isTextInputTarget, resolveKeyCommand } from './shortcuts';
import { IconPicker } from './IconPicker';
import { PALETTE_TOOLS, nextSelectionId, nextToolIndex } from './tools';

interface MenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
  ids: string[];
}

export function ToolPalette({
  store = defaultStore,
  ui = defaultUi,
  footer,
}: {
  store?: WebviewStore;
  ui?: UiStateStore;
  /** Extra controls at the bottom of the palette, below a divider (the board sidebar buttons). */
  footer?: ReactNode;
}) {
  const { doc, readOnly } = useWebviewState(store);
  const { activeTool, selection, iconName } = useUiState(ui);
  const { setActiveTool, setSelection } = ui;
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const clipboard = useRef<unknown>(undefined);
  const [menu, setMenu] = useState<MenuState | undefined>();
  const latest = useRef({ doc, selection, readOnly });
  latest.current = { doc, selection, readOnly };

  const [pickerOpen, setPickerOpen] = useState(false);
  const activate = (id: ToolId): void => {
    setActiveTool(id);
    if (id === 'icon') setPickerOpen(true);
  };
  // Activating the Icon tool by any route opens the picker; leaving the tool closes it (Req 23.8).
  useEffect(() => setPickerOpen(activeTool === 'icon'), [activeTool]);

  const run = (id: ActionId, ids: readonly string[]): void => {
    const { tool, input } = buildAction(id, { ids, clipboard: clipboard.current });
    dispatchOp(tool, input);
    // The deleted ids must leave the selection now, not when the host's patch arrives; otherwise a
    // repeated key press (or auto-repeat) deletes the same ids again and the host reports "not found".
    if (id === ActionId.Delete || id === ActionId.Cut) setSelection([]);
  };

  const openMenu = (x: number, y: number, targetIds: string[]): void => {
    const { doc: d, readOnly: ro } = latest.current;
    const grouped = !!d?.elements.some((e) => targetIds.includes(e.id) && e.groupId);
    const items = buildContextMenu({
      targetIds,
      grouped,
      hasClipboard: clipboard.current !== undefined,
      readOnly: ro,
      elementCount: d?.elements.length ?? 0,
      elements: d?.elements ?? [],
    });
    setMenu({ x, y, items, ids: targetIds });
  };

  const choose = (item: ContextMenuItem, ids: string[]): void => {
    setMenu(undefined);
    if (item.id === 'select-all') {
      setSelection((latest.current.doc?.elements ?? []).map((e) => e.id));
      return;
    }
    if (item.id === ActionId.Copy || item.id === ActionId.Cut) {
      const els = (latest.current.doc?.elements ?? []).filter((e) => ids.includes(e.id));
      clipboard.current = { elements: structuredClone(els) };
      if (item.id === ActionId.Cut) run(ActionId.Cut, ids);
      return;
    }
    if (isComponentMenuId(item.id)) {
      const els = latest.current.doc?.elements ?? [];
      if (item.id === ComponentMenuId.GoToMaster) {
        const master = masterOf(els, ids[0] ?? '');
        if (master) goToMaster(master, setSelection);
        return;
      }
      const op = buildComponentOp(item.id, els, ids);
      if (op) dispatchOp(op.tool, op.input);
      return;
    }
    if (isFrameMenuId(item.id)) {
      const op = buildFrameOp(item.id, latest.current.doc?.elements ?? [], ids);
      if (op) dispatchOp(op.tool, op.input);
      return;
    }
    run(item.id, ids);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      const inTextInput = isTextInputTarget(target);
      if (target?.closest?.('[role="toolbar"]') && /^Arrow|^Home$|^End$/.test(e.key)) return; // toolbar handles itself
      if (target?.closest?.('[role="menu"], [data-ob-icon-picker]')) return;
      const { doc: d, readOnly: ro } = latest.current;
      // Read the live selection, not the last-rendered one, so a just-cleared selection is honoured.
      const sel = ui.getState().selection;
      if (e.key === 'Tab' && !inTextInput && !e.ctrlKey && !e.altKey && !e.metaKey) {
        const onCanvas = target === document.body || !!target?.closest?.('[data-ob-canvas]');
        if (onCanvas && d) {
          const next = nextSelectionId(d.elements.map((x) => x.id), sel, e.shiftKey);
          if (next) {
            e.preventDefault();
            setSelection([next]);
          }
        }
        return;
      }
      const cmd = resolveKeyCommand({
        key: e.key,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        altKey: e.altKey,
        shiftKey: e.shiftKey,
        inTextInput,
      });
      if (!cmd) return;
      switch (cmd.kind) {
        case 'tool':
          ui.setActiveTool(cmd.tool);
          if (cmd.tool === 'icon') setPickerOpen(true);
          break;
        case 'cancel':
          setMenu(undefined);
          ui.cancelCreation(); // discards in-progress creation; selection is kept
          ui.setActiveTool('select');
          break;
        case 'delete':
          if (!ro && sel.length > 0) {
            e.preventDefault();
            run(ActionId.Delete, sel);
          }
          break;
        case 'nudge':
          if (!ro && sel.length > 0) {
            e.preventDefault();
            const { tool, input } = buildAction(ActionId.Nudge, { ids: sel, dx: cmd.dx, dy: cmd.dy, amount: cmd.amount });
            dispatchOp(tool, input);
          }
          break;
        case 'contextMenu': {
          e.preventDefault();
          const r = target?.getBoundingClientRect?.();
          openMenu(r ? r.left + 8 : 8, r ? r.top + 8 : 8, [...sel]);
          break;
        }
      }
    };
    const onContext = (e: MouseEvent): void => {
      if (isTextInputTarget(e.target as HTMLElement | null)) return;
      e.preventDefault();
      const el = (e.target as HTMLElement | null)?.closest?.('[data-element-id]') as HTMLElement | null;
      const hit = el?.dataset.elementId;
      const sel = latest.current.selection;
      const ids = hit ? (sel.includes(hit) ? [...sel] : [hit]) : [];
      openMenu(e.clientX, e.clientY, ids);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('contextmenu', onContext);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('contextmenu', onContext);
    };
  }, [ui]);

  const onToolbarKey = (e: ReactKeyboardEvent, index: number): void => {
    const next = nextToolIndex(index, PALETTE_TOOLS.length, e.key);
    if (next !== undefined) {
      e.preventDefault();
      btnRefs.current[next]?.focus();
    }
  };

  return (
    <>
      <div className="ob-palette">
      <div role="toolbar" aria-label="Tools" aria-orientation="vertical" className="ob-palette-tools">
        {PALETTE_TOOLS.map((t, i) => {
          const pressed = t.id === activeTool;
          return (
            <button
              key={t.id}
              type="button"
              ref={(el) => {
                btnRefs.current[i] = el;
              }}
              aria-label={t.label}
              aria-pressed={pressed}
              aria-keyshortcuts={t.shortcut}
              title={`${t.label} (${t.shortcut})`}
              tabIndex={pressed ? 0 : -1}
              data-active={pressed ? 'true' : undefined}
              onClick={() => activate(t.id)}
              onKeyDown={(e) => onToolbarKey(e, i)}
            >
              <Icon name={t.id} />
            </button>
          );
        })}
      </div>
      {footer ? (
        <>
          <div className="ob-palette-divider" role="separator" aria-orientation="horizontal" />
          {footer}
        </>
      ) : null}
      </div>
      {pickerOpen && activeTool === 'icon' ? (
        <IconPicker
          selected={iconName}
          onChoose={(name) => {
            ui.setIconName(name);
            setPickerOpen(false);
            btnRefs.current[PALETTE_TOOLS.findIndex((x) => x.id === 'icon')]?.focus();
          }}
          onClose={() => {
            setPickerOpen(false);
            btnRefs.current[PALETTE_TOOLS.findIndex((x) => x.id === 'icon')]?.focus();
          }}
        />
      ) : null}
      {menu ? (
        <ul
          role="menu"
          aria-label="Context menu"
          className="ob-context-menu"
          style={{ position: 'fixed', left: menu.x, top: menu.y }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setMenu(undefined);
          }}
        >
          {menu.items.map((it, i) => (
            <li key={it.id} role="none">
              <button
                type="button"
                role="menuitem"
                autoFocus={i === 0}
                onClick={() => choose(it, menu.ids)}
              >
                {ACTIONS[it.id as ActionId]?.label ?? it.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
