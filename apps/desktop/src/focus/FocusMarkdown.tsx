import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';

const components: Components = {
  p: (props) => <p {...props} style={{ margin: '0 0 0.45em' }} />,
  ul: (props) => (
    <ul {...props} style={{ margin: '0 0 0.45em', paddingLeft: 0, listStyle: 'none' }} />
  ),
  ol: (props) => (
    <ol {...props} style={{ margin: '0 0 0.45em', paddingLeft: 0, listStyle: 'none' }} />
  ),
  li: ({ children, ...props }) => (
    <li
      {...props}
      style={{
        display: 'grid',
        gridTemplateColumns: '10px minmax(0, 1fr)',
        columnGap: 6,
        margin: '0.08em 0',
      }}
    >
      <span aria-hidden style={{ lineHeight: 'inherit' }}>
        •
      </span>
      <span>{children}</span>
    </li>
  ),
  strong: (props) => (
    <strong {...props} style={{ color: 'var(--focus-ask-title)', fontWeight: 780 }} />
  ),
  em: (props) => <em {...props} style={{ color: 'var(--focus-ask-text)' }} />,
  a: (props) => (
    <a
      {...props}
      target="_blank"
      rel="noreferrer noopener"
      style={{ color: 'var(--color-primary-strong)', textDecoration: 'underline' }}
    />
  ),
  code: ({ className, children, ...rest }) => {
    const block = /language-/.test(className ?? '');
    return (
      <code
        {...rest}
        className={className}
        style={{
          display: block ? 'block' : 'inline',
          padding: block ? '6px 8px' : '1px 5px',
          borderRadius: block ? 10 : 5,
          background: 'var(--focus-ask-detail-bg)',
          border: block ? '1px solid var(--focus-ask-detail-border)' : 'none',
          color: 'var(--focus-ask-detail-text)',
          fontFamily: 'var(--font-mono)',
          fontSize: '0.9em',
          whiteSpace: block ? 'pre-wrap' : 'normal',
          wordBreak: 'break-word',
        }}
      >
        {children}
      </code>
    );
  },
};

export function FocusMarkdown({
  text,
  style,
}: {
  readonly text: string;
  readonly style: React.CSSProperties;
}): JSX.Element {
  return (
    <div className="focus-ask-markdown" style={style}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
