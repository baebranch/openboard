// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { seriousViolations } from '../axeHelper';
import { ExportDialog } from './ExportDialog';

afterEach(cleanup);

describe('ExportDialog accessibility', () => {
  it('has no serious axe violations, including with a padding error', async () => {
    const { container } = render(<ExportDialog doc={{ elements: [] }} selection={[]} onClose={vi.fn()} onExport={vi.fn()} />);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(await seriousViolations(container)).toEqual([]);
    const pad = screen.getByLabelText(/Padding/) as HTMLInputElement;
    fireEvent.change(pad, { target: { value: 'zzz' } });
    fireEvent.blur(pad);
    expect(await seriousViolations(container)).toEqual([]);
  });
});
