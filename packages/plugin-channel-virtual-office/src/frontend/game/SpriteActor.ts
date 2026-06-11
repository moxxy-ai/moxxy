/**
 * One office worker on screen: shadow + character sprite + name tag + status
 * icon + speech bubble, grouped in a Container positioned at the actor's feet.
 * A pure renderer — every frame it just reflects the {@link ActorSnapshot}
 * the simulation produced.
 */

import Phaser from 'phaser';

import type { ActorSnapshot, BubbleTone } from '../sim/types.js';
import { ensureCharTexture, poseFrame } from './textures.js';

const NAME_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Menlo, Consolas, monospace',
  fontSize: '7px',
  color: '#f4efe2',
  backgroundColor: 'rgba(31, 24, 51, 0.65)',
  padding: { x: 2, y: 1 },
  resolution: 4,
} as const;

const BUBBLE_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Menlo, Consolas, monospace',
  fontSize: '7px',
  color: '#1f1833',
  resolution: 4,
  wordWrap: { width: 96, useAdvancedWrap: true },
  align: 'left',
} as const;

export class SpriteActor extends Phaser.GameObjects.Container {
  private readonly select: Phaser.GameObjects.Image;
  private readonly shadow: Phaser.GameObjects.Image;
  private readonly sprite: Phaser.GameObjects.Sprite;
  private readonly nameTag: Phaser.GameObjects.Text;
  private readonly icon: Phaser.GameObjects.Image;
  private bubbleGroup: Phaser.GameObjects.Container | null = null;
  private bubbleKey = '';
  private readonly lookIdx: number;
  private iconBob = 0;

  constructor(
    scene: Phaser.Scene,
    snapshot: ActorSnapshot,
    onClick: (id: string) => void,
  ) {
    super(scene, snapshot.x, snapshot.y);
    this.lookIdx = snapshot.lookIdx;
    const texKey = ensureCharTexture(scene, snapshot.lookIdx);

    this.select = scene.add.image(0, -1, 'actor-select').setOrigin(0.5, 0.5).setVisible(false);
    this.shadow = scene.add.image(0, -1, 'actor-shadow').setOrigin(0.5, 0.5);
    this.sprite = scene.add.sprite(0, 0, texKey, 'idleDown').setOrigin(0.5, 1);
    this.nameTag = scene.add.text(0, -25, snapshot.name, NAME_STYLE).setOrigin(0.5, 1);
    this.icon = scene.add.image(7, -28, 'icon-alert').setOrigin(0.5, 1).setVisible(false);
    this.add([this.select, this.shadow, this.sprite, this.nameTag, this.icon]);
    scene.add.existing(this);

    // Click → open this worker's chat. Subagents are informational only, but
    // selecting them is harmless (the panel just has nothing to drive).
    // Fires on pointerUP with a movement threshold so camera drags that start
    // on a sprite pan the view instead of opening the panel.
    this.sprite.setInteractive({ useHandCursor: true });
    this.sprite.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      if (pointer.getDistance() < 6) onClick(snapshot.id);
    });
  }

  /** Reflect this frame's snapshot. `timeMs` drives idle micro-animation. */
  sync(snapshot: ActorSnapshot, timeMs: number, selected: boolean): void {
    this.setPosition(Math.round(snapshot.x), Math.round(snapshot.y));
    this.setDepth(snapshot.y);
    this.nameTag.setText(snapshot.name);
    this.select.setVisible(selected);

    // Pose / animation
    if (snapshot.seated && snapshot.typing) {
      this.sprite.setFlipX(false);
      this.playIfNot(`type-${this.lookIdx}`);
    } else if (snapshot.moving) {
      const dir = snapshot.facing === 'left' ? 'right' : snapshot.facing;
      this.sprite.setFlipX(snapshot.facing === 'left');
      this.playIfNot(`walk-${dir === 'up' ? 'up' : dir === 'down' ? 'down' : 'right'}-${this.lookIdx}`);
    } else if (!snapshot.seated && snapshot.facing === 'down') {
      // Standing front-on: gentle breath + blink loop.
      this.sprite.setFlipX(false);
      this.playIfNot(`idle-down-${this.lookIdx}`);
    } else {
      const pose = poseFrame(snapshot.facing, snapshot.seated);
      this.sprite.anims.stop();
      this.sprite.setFlipX(pose.flipX);
      this.sprite.setFrame(pose.frame);
    }

    // Status icon (bobbing)
    if (snapshot.icon) {
      this.icon.setTexture(`icon-${snapshot.icon}`);
      this.icon.setVisible(true);
      this.iconBob = Math.sin(timeMs / 180) * 1.5;
      this.icon.setY(-28 + this.iconBob);
    } else {
      this.icon.setVisible(false);
    }

    // Bubble
    this.syncBubble(snapshot.bubble);
    // Shadow hides while seated (the chair is the ground contact).
    this.shadow.setVisible(!snapshot.seated);
  }

  private playIfNot(key: string): void {
    if (this.sprite.anims.currentAnim?.key !== key || !this.sprite.anims.isPlaying) {
      this.sprite.play(key, true);
    }
  }

  private syncBubble(bubble: { text: string; tone: BubbleTone } | null): void {
    const key = bubble ? `${bubble.tone}:${bubble.text}` : '';
    if (key === this.bubbleKey) return;
    this.bubbleKey = key;
    this.bubbleGroup?.destroy(true);
    this.bubbleGroup = null;
    if (!bubble) return;

    const scene = this.scene;
    const text = scene.add.text(0, 0, bubble.text, BUBBLE_STYLE).setOrigin(0.5, 0.5);
    const w = Math.max(24, Math.ceil(text.width) + 10);
    const h = Math.max(16, Math.ceil(text.height) + 8);
    const body = scene.add
      .nineslice(0, 0, `bubble-${bubble.tone}`, undefined, w, h, 6, 6, 6, 6)
      .setOrigin(0.5, 0.5);
    const tail = scene.add
      .image(0, h / 2 + 2, `bubble-tail-${bubble.tone}`)
      .setOrigin(0.5, 0.5);
    const group = scene.add.container(0, -34 - h / 2, [body, tail, text]);
    this.add(group);
    this.bubbleGroup = group;
  }

  destroyActor(): void {
    this.bubbleGroup?.destroy(true);
    this.destroy(true);
  }
}
