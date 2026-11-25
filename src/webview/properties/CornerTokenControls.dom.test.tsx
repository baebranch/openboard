// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Element } from '../../core/model';
import { seriousViolations } from '../axeHelper';
import type { UpdateOp } from './model';
import { PropertiesPanelView } from './PropertiesPanelView';

function rect(id: string, style: Record<string, unknown> = {}): Element {
  return {
    id,
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    rotation: 0,
    style: { fill: '#ffffff', stroke: '#000000', strokeWidth: 2, strokeStyle: 'solid', opacity: 100, cornerRadius: 0, ...style },
  } as unknown as Element;
}

afterEach(cleanup);

describe('corner controls (Req 26.3)', () => {
  it('gives every corner input a unique accessible name, commits on Enter and reverts on Escape', async () => {
    const ops: UpdateOp[] = [];
    const { container } = render(<PropertiesPanelView elements={[rect('a')]} onUpdate={(o) => ops.push(o)} />);
    const group = container.querySelector('.ob-prop-corners') as HTMLElement;
    const inputs = Array.from(group.querySelectorAll('input'));
    expect(inputs).toHaveLength(5);
    const names = inputs.map((i) => i.labels?.[0]?.textContent ?? '');
    expect(names.every((n) => n.length > 0)).toBe(true);
    expect(new Set(names).size).toBe(5);

    const first = inputs[0]!;
    first.focus();
    fireEvent.change(first, { target: { value: '8' } });
    fireEvent.keyDown(first, { key: 'Enter' });
    expect(ops).toHaveLength(1);

    fireEvent.change(first, { target: { value: '12' } });
    fireEvent.keyDown(first, { key: 'Escape' });
    expect(ops).toHaveLength(1);

    fireEvent.change(first, { target: { value: 'abc' } });
    fireEvent.keyDown(first, { key: 'Enter' });
    expect(await seriousViolations(container)).toEqual([]);
  });
});

describe('token controls (Req 26.3)', () => {
  it('exposes a named, keyboard-operable picker and detach button with no serious axe violations', async () => {
    const ops: UpdateOp[] = [];
    const tokens = { colors: { brand: '#ff0000', accent: '#00ff00' } };
    const { container } = render(
      <PropertiesPanelView elements={[rect('a', { fill: 'token:brand' })]} tokens={tokens} onUpdate={(o) => ops.push(o)} />,
    );
    const pick = screen.getByLabelText('Fill token');
    expect(pick).toBeTruthy();
    const detach = screen.getByRole('button', { name: 'Detach token: Fill' }) as HTMLButtonElement;
    expect(detach.disabled).toBe(false);
    expect(await seriousViolations(container)).toEqual([]);

    fireEvent.keyDown(pick, { key: 'ArrowDown' });
    expect(screen.getByRole('listbox')).toBeTruthy();
    expect(await seriousViolations(container)).toEqual([]);
    fireEvent.keyDown(pick, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('marks a missing token with a status and stays free of serious violations', async () => {
    const { container } = render(
      <PropertiesPanelView elements={[rect('a', { fill: 'token:gone' })]} tokens={{ colors: { brand: '#ff0000' } }} onUpdate={() => {}} />,
    );
    expect(screen.getByRole('status').textContent).toContain('gone');
    expect(await seriousViolations(container)).toEqual([]);
  });
});
