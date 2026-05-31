/**
 * Empty / loading states for the Skills tab. EmptyHero greets a user with no
 * skills yet (avatar + the two create paths); LoadingHero is the spinner shown
 * inside the editor while a skill's body streams in from disk.
 */

import { Button, Icon } from '@moxxy/desktop-ui';
import { asset } from '@/lib/asset';

export function EmptyHero({
  onCreate,
  onGenerate,
}: {
  readonly onCreate: () => void;
  readonly onGenerate: () => void;
}): JSX.Element {
  return (
    <div
      style={{
        height: '100%',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        textAlign: 'center',
      }}
    >
      <div>
        <img
          src={asset('avatar.gif')}
          alt=""
          aria-hidden
          style={{ width: 140, height: 'auto', imageRendering: 'pixelated', marginBottom: 14 }}
        />
        <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Compose a new skill</h3>
        <p style={{ margin: '6px 0 16px', color: 'var(--color-text-dim)', fontSize: 13 }}>
          Skills are Markdown files I'll read on demand to learn how to do something specific.
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          <Button variant="cta" onClick={onCreate} style={{ padding: '10px 16px' }}>
            <Icon name="plus" size={14} />
            Blank skill
          </Button>
          <Button variant="secondary" onClick={onGenerate} style={{ padding: '10px 16px' }}>
            <Icon name="spark" size={14} />
            Generate with AI
          </Button>
        </div>
      </div>
    </div>
  );
}

export function LoadingHero(): JSX.Element {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'grid',
        placeItems: 'center',
        color: 'var(--color-text-dim)',
        fontSize: 13,
        gap: 10,
      }}
    >
      <img
        src={asset('avatar.gif')}
        alt=""
        aria-hidden
        className="moxxy-avatar-loader moxxy-avatar-loader--sm"
        style={{ width: 64, height: 'auto', imageRendering: 'pixelated' }}
      />
      Loading…
    </div>
  );
}
