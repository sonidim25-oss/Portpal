import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  Button,
  EmptyState,
  IconButton,
  LoadingState,
  PageHeader,
  SearchInput,
  SegmentedControl,
} from './controls';

const options = [
  { value: 'all', label: 'All', count: 4 },
  { value: 'dev', label: 'Dev', count: 2 },
] as const;

describe('UI controls', () => {
  it('exposes a labelled search input and forwards changes', () => {
    const onChange = vi.fn();

    render(
      <SearchInput
        label="Search ports"
        value=""
        onChange={onChange}
        placeholder="Search ports, process, project..."
      />,
    );

    const input = screen.getByRole('searchbox', { name: 'Search ports' });
    expect(input).toBeVisible();
    fireEvent.change(input, { target: { value: '3000' } });
    expect(onChange).toHaveBeenCalledWith('3000');
  });

  it('marks the selected segment as pressed and changes selection', () => {
    const onChange = vi.fn();

    render(
      <SegmentedControl
        ariaLabel="Port category"
        value="dev"
        options={options}
        onChange={onChange}
      />,
    );

    expect(screen.getByRole('button', { name: 'Dev 2' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'All 4' }));
    expect(onChange).toHaveBeenCalledWith('all');
  });

  it('uses an icon button label as its accessible name and title', () => {
    render(
      <IconButton label="Refresh ports">
        <svg aria-hidden="true" />
      </IconButton>,
    );

    expect(screen.getByRole('button', { name: 'Refresh ports' })).toHaveAttribute(
      'title',
      'Refresh ports',
    );
  });

  it('rejects icon buttons without a nonempty label', () => {
    expect(() => render(<IconButton label="">Refresh</IconButton>)).toThrow(
      'IconButton requires a nonempty label',
    );
  });

  it('renders the remaining primitives with their semantic text', () => {
    render(
      <>
        <Button>Refresh</Button>
        <PageHeader title="Ports" description="Local listeners" />
        <LoadingState label="Scanning ports" />
        <EmptyState title="No ports in use" description="Start a server and it will appear here." />
      </>,
    );

    expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled();
    expect(screen.getByRole('heading', { name: 'Ports' })).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('Scanning ports');
    expect(screen.getByText('No ports in use')).toBeVisible();
  });
});
