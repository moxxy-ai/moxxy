/**
 * About / Update tab — a single unified updater. There is no longer a separate
 * "Update CLI" / "Update dashboard" / "Update app" control: {@link UpdateSection}
 * shows both the app and the runner version and exposes ONE "Update" button that
 * brings both to the latest version together.
 */

import { UpdateSection } from './UpdateSection';

export function AboutTab(): JSX.Element {
  return <UpdateSection />;
}
