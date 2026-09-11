import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import './ui.css';

type ButtonVariant = 'primary' | 'secondary' | 'danger';

type ButtonProps = ComponentPropsWithoutRef<'button'> & {
  variant?: ButtonVariant;
};

export function Button({
  className,
  variant = 'secondary',
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      type={type}
      className={['ui-button', `ui-button--${variant}`, className].filter(Boolean).join(' ')}
    />
  );
}

type IconButtonProps = Omit<ButtonProps, 'children' | 'aria-label' | 'title'> & {
  children: ReactNode;
  label: string;
};

export function IconButton({ children, className, label, ...props }: IconButtonProps) {
  if (!label.trim()) {
    throw new Error('IconButton requires a nonempty label');
  }

  return (
    <Button
      {...props}
      className={['ui-icon-button', className].filter(Boolean).join(' ')}
      aria-label={label}
      title={label}
    >
      {children}
    </Button>
  );
}

type SearchInputProps = Omit<ComponentPropsWithoutRef<'input'>, 'onChange' | 'type' | 'value'> & {
  label: string;
  onChange: (value: string) => void;
  value: string;
};

export function SearchInput({ className, id, label, onChange, ...props }: SearchInputProps) {
  const inputId = id ?? `search-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

  return (
    <div className="ui-search-input-wrap">
      <label className="ui-visually-hidden" htmlFor={inputId}>
        {label}
      </label>
      <svg className="ui-search-input-icon" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="6.5" cy="6.5" r="4.5" />
        <path d="m10 10 4 4" />
      </svg>
      <input
        {...props}
        id={inputId}
        type="search"
        className={['ui-search-input', className].filter(Boolean).join(' ')}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

export type SegmentOption<T extends string> = {
  value: T;
  label: string;
  count?: number;
};

type SegmentedControlProps<T extends string> = {
  ariaLabel: string;
  onChange: (value: T) => void;
  options: readonly SegmentOption<T>[];
  value: T;
};

export function SegmentedControl<T extends string>({
  ariaLabel,
  onChange,
  options,
  value,
}: SegmentedControlProps<T>) {
  return (
    <div className="ui-segmented-control" role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="ui-segmented-control__option"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          <span>{option.label}</span>
          {option.count !== undefined && (
            <span className="ui-segmented-control__count">{option.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

type PageHeaderProps = {
  actions?: ReactNode;
  description?: ReactNode;
  title: ReactNode;
};

export function PageHeader({ actions, description, title }: PageHeaderProps) {
  return (
    <header className="ui-page-header">
      <div>
        <h1 className="ui-page-header__title">{title}</h1>
        {description && <p className="ui-page-header__description">{description}</p>}
      </div>
      {actions && <div className="ui-page-header__actions">{actions}</div>}
    </header>
  );
}

type LoadingStateProps = {
  label?: string;
};

export function LoadingState({ label = 'Loading…' }: LoadingStateProps) {
  return (
    <div className="ui-loading-state" role="status">
      <svg className="ui-loading-state__icon" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="6" />
        <path d="M8 2a6 6 0 0 1 6 6" />
      </svg>
      <span>{label}</span>
    </div>
  );
}

type EmptyStateProps = {
  children?: ReactNode;
  description?: ReactNode;
  title: ReactNode;
};

export function EmptyState({ children, description, title }: EmptyStateProps) {
  return (
    <section className="ui-empty-state">
      <svg className="ui-empty-state__icon" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="8" />
        <path d="M8.5 12h7M12 8.5v7" />
      </svg>
      <h2 className="ui-empty-state__title">{title}</h2>
      {description && <p className="ui-empty-state__description">{description}</p>}
      {children && <div className="ui-empty-state__actions">{children}</div>}
    </section>
  );
}
