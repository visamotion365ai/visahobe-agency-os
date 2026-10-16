// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Pill, StatusPill, Avatar, EmptyState, Field } from '../src/components/ui';

describe('shared UI components', () => {
  it('renders a status pill with a human readable label', () => {
    render(<StatusPill status="waiting_approval" />);
    expect(screen.getByText('waiting approval')).toBeTruthy();
  });

  it('renders initials in an avatar', () => {
    render(<Avatar name="Ayesha Rahman" color="#0a84ff" />);
    expect(screen.getByText('AR')).toBeTruthy();
  });

  it('renders an empty state with a hint', () => {
    render(<EmptyState title="No cases yet" hint="Create a case to begin." />);
    expect(screen.getByText('No cases yet')).toBeTruthy();
    expect(screen.getByText('Create a case to begin.')).toBeTruthy();
  });

  it('associates a label with its control', () => {
    render(
      <Field label="Passport number">
        <input className="input" />
      </Field>,
    );
    expect(screen.getByText('Passport number')).toBeTruthy();
  });

  it('renders a pill with a status dot', () => {
    const { container } = render(<Pill tone="green" dot>online</Pill>);
    expect(container.querySelector('.pill.green')).toBeTruthy();
    expect(container.querySelector('.dot')).toBeTruthy();
  });
});
