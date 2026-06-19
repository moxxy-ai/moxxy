import { createElement, type ReactNode } from 'react';
import type { ViewNode } from '@moxxy/sdk';
import { isSafeViewUrl } from './url-safety.js';

export type Dispatch = (action: { name: string }, formValues: Record<string, string>) => void;

export interface RenderHandlers {
  /** Submit/click an `action` element → agent turn. */
  dispatch: Dispatch;
  /** A `to`/`nav` element → client-side navigation (or a build turn if uncached). */
  navigate: (name: string) => void;
}

/**
 * Maps the validated AST to React elements via a FIXED tag→element switch.
 * This switch IS the allow-list (defense in depth alongside the parser): an
 * unknown tag renders an inert placeholder, never raw HTML or evaluated code.
 * Agent strings only ever land as escaped React text or typed attributes.
 *
 * Two interaction paths: `node.nav` (a `to` target) navigates client-side; an
 * `action` drives an agent turn. Neither is ever an injected handler string.
 */
export function renderNode(node: ViewNode, h: RenderHandlers, key?: number): ReactNode {
  if (node.kind === 'text') return node.value;
  const p = node.props;
  const kids = node.children.map((c, i) => renderNode(c, h, i));
  const s = (v: unknown): string | undefined => (v == null ? undefined : String(v));

  switch (node.tag) {
    case 'view':
      return (
        <div className="v-view" key={key}>
          {p.title ? <h1 className="v-title">{String(p.title)}</h1> : null}
          {kids}
        </div>
      );
    case 'stack':
      return (
        <div className="v-stack" data-gap={s(p.gap)} data-align={s(p.align)} key={key}>
          {kids}
        </div>
      );
    case 'row':
      return (
        <div className="v-row" data-gap={s(p.gap)} data-align={s(p.align)} data-justify={s(p.justify)} key={key}>
          {kids}
        </div>
      );
    case 'grid':
      return (
        <div className="v-grid" style={{ gridTemplateColumns: `repeat(${Number(p.cols) || 1}, 1fr)` }} data-gap={s(p.gap)} key={key}>
          {kids}
        </div>
      );
    case 'card':
      return (
        <div className="v-card" data-accent={s(p.accent)} key={key}>
          {p.title ? <div className="v-card-title">{String(p.title)}</div> : null}
          {kids}
        </div>
      );
    case 'divider':
      return <hr className="v-divider" key={key} />;
    case 'spinner':
      return (
        <div className="v-spinner" role="status" aria-live="polite" aria-busy="true" key={key}>
          <span className="v-spin" aria-hidden="true" />
          <span className="v-text" data-tone="muted">{p.label ? String(p.label) : 'Loading…'}</span>
        </div>
      );
    case 'skeleton': {
      const rows = Math.min(12, Math.max(1, Number(p.rows) || 3));
      return (
        <div className="v-skeleton" key={key}>
          {Array.from({ length: rows }, (_, i) => (
            <div className="v-skel-row" key={i} />
          ))}
        </div>
      );
    }
    case 'heading': {
      const lvl = Math.min(3, Math.max(1, Number(p.level) || 2));
      return createElement(`h${lvl}`, { className: 'v-heading', key }, kids);
    }
    case 'text':
      return (
        <span className="v-text" data-tone={s(p.tone)} data-weight={s(p.weight)} key={key}>
          {kids}
        </span>
      );
    case 'badge':
      return (
        <span className="v-badge" data-tone={s(p.tone)} key={key}>
          {kids}
        </span>
      );
    case 'image': {
      // Render-time URL re-validation (second wall, mirrors validateDoc):
      // an unsafe scheme renders an inert placeholder, never an <img src>.
      const src = String(p.src);
      if (!isSafeViewUrl(src, 'src')) {
        return (
          <div className="v-unknown" key={key}>
            [blocked image: disallowed URL scheme]
          </div>
        );
      }
      return <img className="v-image" src={src} alt={p.alt ? String(p.alt) : ''} key={key} />;
    }
    case 'link': {
      // A `to` link navigates client-side; otherwise it is an external anchor.
      if (node.nav) {
        return (
          <a
            className="v-link"
            href="#"
            key={key}
            onClick={(e) => {
              e.preventDefault();
              h.navigate(node.nav!);
            }}
          >
            {kids}
          </a>
        );
      }
      // Render-time URL re-validation (second wall, mirrors validateDoc):
      // an unsafe href (javascript:, data:text/*, …) renders as plain text
      // — the click-XSS payload never becomes a clickable anchor.
      const href = String(p.href);
      if (!isSafeViewUrl(href, 'href')) {
        return (
          <span className="v-link" key={key}>
            {kids}
          </span>
        );
      }
      return (
        <a className="v-link" href={href} target="_blank" rel="noreferrer" key={key}>
          {kids}
        </a>
      );
    }
    case 'list':
      return p.ordered ? (
        <ol className="v-list" key={key}>{kids}</ol>
      ) : (
        <ul className="v-list" key={key}>{kids}</ul>
      );
    case 'item':
      return <li className="v-item" key={key}>{kids}</li>;
    case 'table':
      return (
        <table className="v-table" key={key}>
          <tbody>{kids}</tbody>
        </table>
      );
    case 'tr':
      return <tr key={key}>{kids}</tr>;
    case 'th':
      // scope="col" lets screen readers associate header cells with their
      // column for the data tables agents commonly build.
      return <th scope="col" style={{ textAlign: align(p.align) }} key={key}>{kids}</th>;
    case 'td':
      return <td style={{ textAlign: align(p.align) }} key={key}>{kids}</td>;
    case 'form':
      return <FormEl node={node} dispatch={h.dispatch} key={key}>{kids}</FormEl>;
    case 'input':
      return (
        <label className="v-field" key={key}>
          {p.label ? <span className="v-label">{String(p.label)}</span> : null}
          <input
            name={String(p.name)}
            type={p.type ? String(p.type) : 'text'}
            placeholder={p.placeholder ? String(p.placeholder) : ''}
            defaultValue={p.value != null ? String(p.value) : undefined}
            required={!!p.required}
          />
        </label>
      );
    case 'select':
      return (
        <label className="v-field" key={key}>
          {p.label ? <span className="v-label">{String(p.label)}</span> : null}
          <select name={String(p.name)} defaultValue={p.value != null ? String(p.value) : undefined}>
            {kids}
          </select>
        </label>
      );
    case 'option':
      return <option value={String(p.value)} key={key}>{kids}</option>;
    case 'checkbox':
      return (
        <label className="v-check" key={key}>
          <input type="checkbox" name={String(p.name)} defaultChecked={!!p.checked} />
          {p.label ? <span>{String(p.label)}</span> : null}
        </label>
      );
    case 'button':
      return <ActionButton node={node} handlers={h} key={key} />;
    default:
      return (
        <div className="v-unknown" key={key}>
          [unsupported: {node.tag}]
        </div>
      );
  }
}

function align(v: unknown): 'left' | 'center' | 'right' {
  return v === 'center' || v === 'right' ? v : 'left';
}

function gatherFormValues(form: HTMLFormElement | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!form) return out;
  new FormData(form).forEach((value, key) => {
    out[key] = String(value);
  });
  return out;
}

function pick(values: Record<string, string>, fields: ReadonlyArray<string>): Record<string, string> {
  if (fields.length === 0) return values;
  const out: Record<string, string> = {};
  for (const f of fields) if (f in values) out[f] = values[f]!;
  return out;
}

function FormEl(props: { node: Extract<ViewNode, { kind: 'element' }>; dispatch: Dispatch; children: ReactNode }): ReactNode {
  const { node, dispatch, children } = props;
  const name = node.action?.name ?? '';
  const submitLabel = node.props.submit ? String(node.props.submit) : 'Submit';
  return (
    <form
      className="v-form"
      onSubmit={(e) => {
        e.preventDefault();
        dispatch({ name }, gatherFormValues(e.currentTarget));
      }}
    >
      {children}
      <div className="v-form-actions">
        <button type="submit" className="v-btn" data-variant="primary">
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

function ActionButton(props: { node: Extract<ViewNode, { kind: 'element' }>; handlers: RenderHandlers }): ReactNode {
  const { node, handlers } = props;
  return (
    <button
      type="button"
      className="v-btn"
      data-variant={node.props.variant != null ? String(node.props.variant) : undefined}
      onClick={(e) => {
        // `to`/nav takes precedence (client-side); else fire the agent action.
        if (node.nav) {
          handlers.navigate(node.nav);
          return;
        }
        if (node.action) {
          const values = gatherFormValues((e.currentTarget as HTMLButtonElement).closest('form'));
          handlers.dispatch({ name: node.action.name }, pick(values, node.action.fields));
        }
      }}
    >
      {String(node.props.label ?? 'OK')}
    </button>
  );
}
