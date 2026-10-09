/**
 * The onboarding frame: one form in the middle of the window, with a line of
 * steps over it. Stateless: it draws the step list it is given, marks
 * `currentIndex`, and slots the current step into the card.
 *
 * It has no sidebar. First run has nothing to move between yet, and a column of
 * step names beside the form read as navigation that could not be used. The
 * card is the app's own: its ground, its radius, its type.
 */

import { MoxxyMark } from '@/components/MoxxyMark';

function stateOf(index: number, current: number): 'done' | 'current' | 'ahead' {
  if (index < current) return 'done';
  return index === current ? 'current' : 'ahead';
}

export function Shell({
  steps,
  currentIndex,
  children,
}: {
  readonly steps: ReadonlyArray<{ readonly id: string; readonly label: string }>;
  readonly currentIndex: number;
  readonly children: React.ReactNode;
}): JSX.Element {
  // A recovery gate can be a single step; one mark out of one counts nothing.
  const counted = steps.length > 1;
  return (
    <div className="onboard">
      <main className="onboard__column">
        <header className="onboard__brand">
          <MoxxyMark size={22} />
          <span>moxxy</span>
        </header>
        <section className="onboard__card">
          {counted && (
            <div className="onboard__progress">
              <span className="onboard__count">
                Step {currentIndex + 1} of {steps.length}
              </span>
              <ol className="onboard__marks" aria-label="Setup steps">
                {steps.map((step, index) => (
                  <li
                    key={step.id}
                    className="onboard__mark"
                    data-state={stateOf(index, currentIndex)}
                    aria-current={index === currentIndex ? 'step' : undefined}
                  >
                    <span className="sr-only">{step.label}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
          {/* Keyed by the step so each one arrives, not just swaps its text. */}
          <div className="onboard__step" key={steps[currentIndex]?.id ?? 'step'}>
            {children}
          </div>
        </section>
      </main>
    </div>
  );
}
