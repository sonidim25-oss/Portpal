import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CategoryIcon, PortBadge, PortInfoCard, PortLabel, PortTooltip } from './index';
import type { PortLike } from './types';

const port = (over: Partial<PortLike> & { port: number }): PortLike => ({
  process_name: null,
  project_name: null,
  project_path: null,
  ...over,
});

describe('PortLabel', () => {
  it('renders the full plain-English translation', () => {
    render(<PortLabel port={port({ port: 80 })} />);
    expect(screen.getByText('Port 80 (Web Traffic / HTTP)')).toBeInTheDocument();
  });

  it('keeps the number scannable in the compact variant', () => {
    const { container } = render(<PortLabel port={port({ port: 5173 })} variant="compact" />);
    expect(within(container).getByText('5173')).toBeInTheDocument();
    expect(within(container).getByText('Development Server')).toBeInTheDocument();
  });

  it('renders the name alone when asked', () => {
    const { container } = render(<PortLabel port={port({ port: 6379 })} variant="name" />);
    expect(container.textContent).toBe('Redis Cache');
  });
});

describe('PortBadge', () => {
  it('shows an icon and the plain-English name', () => {
    const { container } = render(<PortBadge port={port({ port: 5432 })} />);
    expect(screen.getByText('PostgreSQL Database')).toBeInTheDocument();
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('tags itself with the category so the design can style it', () => {
    const { container } = render(<PortBadge port={port({ port: 22 })} />);
    expect(container.querySelector('.pi-badge')).toHaveAttribute('data-category', 'remote-access');
  });

  it('marks a guessed identification differently from a known one', () => {
    const known = render(<PortBadge port={port({ port: 443 })} />);
    expect(known.container.querySelector('.pi-badge')).toHaveAttribute('data-confidence', 'known');

    const guessed = render(<PortBadge port={port({ port: 49664, process_name: 'mystery.exe' })} />);
    expect(guessed.container.querySelector('.pi-badge')).toHaveAttribute(
      'data-confidence',
      'range',
    );
  });

  it('can show the category instead of the service name', () => {
    render(<PortBadge port={port({ port: 9092 })} label="category" />);
    expect(screen.getByText('Messaging')).toBeInTheDocument();
  });

  it('keeps an accessible name when the text label is hidden', () => {
    render(<PortBadge port={port({ port: 3306 })} label="none" />);
    expect(screen.getByRole('img', { name: 'MySQL Database' })).toBeInTheDocument();
  });

  it('optionally shows the port number', () => {
    render(<PortBadge port={port({ port: 8080 })} showPort />);
    expect(screen.getByText('8080')).toBeInTheDocument();
  });
});

describe('PortInfoCard', () => {
  it('explains what the port does and whether it is normal', () => {
    render(<PortInfoCard port={port({ port: 3389 })} />);
    expect(screen.getByRole('heading', { name: /Port 3389/ })).toBeInTheDocument();
    expect(screen.getByText(/control this computer/i)).toBeInTheDocument();
    expect(screen.getByText('Is this normal?')).toBeInTheDocument();
  });

  it('shows the category chip and its description', () => {
    render(<PortInfoCard port={port({ port: 2375 })} />);
    expect(screen.getByText('Infrastructure')).toBeInTheDocument();
    expect(screen.getByText(/containers, clusters, metrics/i)).toBeInTheDocument();
  });

  it('can hide the context line', () => {
    render(<PortInfoCard port={port({ port: 443 })} showContext={false} />);
    expect(screen.queryByText('Is this normal?')).not.toBeInTheDocument();
  });

  it('says so when the answer is only a guess', () => {
    render(<PortInfoCard port={port({ port: 49999 })} />);
    expect(screen.getByText(/No exact match/i)).toBeInTheDocument();
  });

  it('adds no caveat when the port is an exact match', () => {
    render(<PortInfoCard port={port({ port: 5432 })} />);
    expect(screen.queryByText(/No exact match/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Identified from the name/i)).not.toBeInTheDocument();
  });

  it('names the detected project when there is one', () => {
    render(<PortInfoCard port={port({ port: 3000, project_name: 'portpal' })} />);
    expect(screen.getByRole('heading', { name: /portpal \(Dev Server\)/ })).toBeInTheDocument();
    expect(screen.getByText(/Matched to a project folder/i)).toBeInTheDocument();
  });
});

describe('PortTooltip', () => {
  it('stays closed until asked', () => {
    render(
      <PortTooltip port={port({ port: 5432 })}>
        <span>5432</span>
      </PortTooltip>,
    );
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('opens on hover and closes again', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <PortTooltip port={port({ port: 5432 })}>
        <span>5432</span>
      </PortTooltip>,
    );
    const wrapper = container.querySelector('.pi-tooltip') as HTMLElement;

    await user.hover(wrapper);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    expect(
      within(screen.getByRole('tooltip')).getByRole('heading', {
        name: 'Port 5432 (PostgreSQL Database)',
      }),
    ).toBeInTheDocument();

    await user.unhover(wrapper);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('is reachable by keyboard', async () => {
    const user = userEvent.setup();
    render(
      <PortTooltip port={port({ port: 22 })}>
        <span>22</span>
      </PortTooltip>,
    );

    await user.tab();
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
  });

  it('describes the trigger with the tooltip while it is open', async () => {
    const user = userEvent.setup();
    render(
      <PortTooltip port={port({ port: 22 })}>
        <span>22</span>
      </PortTooltip>,
    );

    await user.tab();
    const trigger = screen.getByLabelText('Port 22 (Secure Remote Login / SSH)');
    expect(trigger).toHaveAttribute('aria-describedby', screen.getByRole('tooltip').id);
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    render(
      <PortTooltip port={port({ port: 22 })}>
        <span>22</span>
      </PortTooltip>,
    );

    await user.tab();
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});

describe('CategoryIcon', () => {
  it('is hidden from screen readers when it is decorative', () => {
    const { container } = render(<CategoryIcon category="database" />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('becomes an image with a name when given a title', () => {
    render(<CategoryIcon category="database" title="Database" />);
    expect(screen.getByRole('img', { name: 'Database' })).toBeInTheDocument();
  });

  it('draws in currentColor so it inherits the surrounding text colour', () => {
    const { container } = render(<CategoryIcon category="web" />);
    expect(container.querySelector('svg')).toHaveAttribute('stroke', 'currentColor');
  });
});
