// jsdom has `WebkitAnimation` on styles but no `AnimationEvent`, so react-dom
// would listen for `webkitAnimationEnd` and miss the `animationend` Chromium
// fires. Must run before react-dom is first imported.
if (typeof window !== 'undefined' && !('AnimationEvent' in window)) {
  class AnimationEvent extends Event {
    readonly animationName: string;
    readonly elapsedTime: number;
    readonly pseudoElement: string;

    constructor(type: string, init: AnimationEventInit = {}) {
      super(type, init);
      this.animationName = init.animationName ?? '';
      this.elapsedTime = init.elapsedTime ?? 0;
      this.pseudoElement = init.pseudoElement ?? '';
    }
  }
  Object.defineProperty(window, 'AnimationEvent', {
    value: AnimationEvent,
    configurable: true,
    writable: true,
  });
}
