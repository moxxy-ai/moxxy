/**
 * Pure helper for the workflows → builder navigation. Building the
 * `/workflow-edit` href (with an optional, URL-encoded `name` query) is the
 * only non-trivial local logic the workflows screen owns, so it lives here as a
 * testable function rather than inline in the component (mobile test convention:
 * cover pure logic, not RN render).
 */
export function workflowEditHref(name: string | null): string {
  return name ? `/workflow-edit?name=${encodeURIComponent(name)}` : '/workflow-edit';
}
