import { expectTypeOf } from 'vitest';
import type { Channel } from '@moxxy/sdk';
import { TelegramChannel, type TelegramStartOpts } from './channel.js';

// Compile-time assertion: TelegramChannel satisfies the Channel<TelegramStartOpts> contract.
expectTypeOf<TelegramChannel>().toMatchTypeOf<Channel<TelegramStartOpts>>();
