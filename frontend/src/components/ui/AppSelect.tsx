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
        className={`w-full appearance-none rounded-md border border-[#d1d5db] bg-white px-3 py-2 pr-9 text-sm leading-5 text-[#111827] transition-colors hover:border-[#94a3b8] focus:border-[#2563eb] focus:outline-none focus:ring-1 focus:ring-[#2563eb]/20 disabled:cursor-not-allowed disabled:bg-[#f8fafc] disabled:text-[#94a3b8] ${className}`.trim()}
      >
        {children}
      </select>
      <ChevronDown
        size={14}
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#64748b]"
        aria-hidden="true"
      />
    </div>
  );
}
