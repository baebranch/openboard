import { useEffect, useId, useReducer, useRef } from 'react';
import type { Element } from '../../core/model';
import { Select } from '../ui/Select';
import {
  commitField,
  fieldReducer,
  fieldRows,
  fieldsFor,
  initFieldState,
  MIXED_LABEL,
  type FieldDef,
  type UpdateOp,
} from './model';

export interface PropertiesPanelViewProps {
  /** Currently selected elements (resolved from the document). */
  elements: readonly Element[];
  readOnly?: boolean;
  onUpdate(op: UpdateOp): void;
}

function Field({ def, elements, readOnly, onUpdate }: { def: FieldDef; elements: readonly Element[]; readOnly: boolean; onUpdate(op: UpdateOp): void }) {
  const id = useId();
  const errId = `${id}-err`;
  const [state, dispatch] = useReducer(fieldReducer, undefined, () => initFieldState(elements, def.name));
  const fresh = useRef(true);

  // Resync whenever the underlying element data changes (selection, patches, undo).
  useEffect(() => {
    if (fresh.current) {
      fresh.current = false;
      return;
    }
    dispatch({ type: 'sync', state: initFieldState(elements, def.name) });
  }, [elements, def.name]);

  const commit = (text: string): void => {
    const out = commitField(state, def, text, elements);
    if (out.op) {
      dispatch({ type: 'accept', text: out.state.committed });
      onUpdate(out.op);
    } else if (out.state.error) {
      dispatch({ type: 'reject', error: out.state.error });
    }
  };

  const invalid = state.error !== undefined;
  const common = {
    id,
    disabled: readOnly,
    'aria-invalid': invalid ? (true as const) : undefined,
    'aria-describedby': invalid ? errId : undefined,
  };

  let control;
  if (def.kind === 'enum') {
    control = (
      <Select
        id={id}
        disabled={readOnly}
        aria-invalid={common['aria-invalid']}
        aria-describedby={common['aria-describedby']}
        value={state.draft}
        mixed={state.mixed}
        mixedLabel={MIXED_LABEL}
        options={def.values!.map((v) => ({ value: v, label: v }))}
        onChange={commit}
      />
    );
  } else {
    control = (
      <input
        {...common}
        type="text"
        inputMode={def.kind === 'number' ? 'decimal' : undefined}
        value={state.draft}
        placeholder={state.mixed ? MIXED_LABEL : undefined}
        onChange={(e) => dispatch({ type: 'edit', text: e.target.value })}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
          else if (e.key === 'Escape') dispatch({ type: 'sync', state: initFieldState(elements, def.name) });
        }}
      />
    );
  }

  return (
    <div className="ob-prop" data-field={def.name}>
      <label htmlFor={id}>{def.label}</label>
      {control}
      {invalid ? (
        <span id={errId} role="alert" className="ob-prop-error">
          {state.error}
        </span>
      ) : null}
    </div>
  );
}

export function PropertiesPanelView({ elements, readOnly = false, onUpdate }: PropertiesPanelViewProps) {
  const fields = fieldsFor(elements);
  // Re-mount fields when the selected id set changes so state never leaks between selections.
  const key = elements.map((e) => e.id).join('|');
  return (
    <aside className="ob-properties" aria-label="Properties">
      <h2 className="ob-properties-title">Properties</h2>
      {fields.length === 0 ? (
        <p className="ob-properties-empty">Select an element to edit its properties.</p>
      ) : (
        <form key={key} onSubmit={(e) => e.preventDefault()}>
          {fieldRows(fields).map((row) => (
            <div key={row.map((f) => f.name).join('|')} className="ob-prop-row" data-cols={row.length}>
              {row.map((f) => (
                <Field key={f.name} def={f} elements={elements} readOnly={readOnly} onUpdate={onUpdate} />
              ))}
            </div>
          ))}
        </form>
      )}
    </aside>
  );
}
