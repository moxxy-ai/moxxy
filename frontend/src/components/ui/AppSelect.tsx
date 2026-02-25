import type { SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';

interface AppSelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  wrapperClassName?: string;
}

export function AppSelect({
  wrapperClassName = '',
  className = '',
  children,
  ...props
}: AppSelectProps) {
  return (
    <div className={`relative ${wrapperClassName}`.trim()}>
      <select
        {...props}
        className={`input-dark w-full pr-9 transition-colors hover:border-border-light focus:ring-1 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50 ${className}`.trim()}
      >
        {children}
      </select>
      <ChevronDown
        size={14}
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text-muted"
        aria-hidden="true"
      />
    </div>
  );
}
