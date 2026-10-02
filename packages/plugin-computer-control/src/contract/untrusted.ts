const CLOSING_TAG = /<\/(app_content)(\s*)>/gi;

/** Fence text read from an application so the model treats it as data, never as instructions. */
export function wrapUntrusted(text: string, app: string): string {
  const attribute = app.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const body = text.replace(CLOSING_TAG, '<\\/$1$2>');
  return `<app_content app="${attribute}" trust="untrusted">\n${body}\n</app_content>`;
}
