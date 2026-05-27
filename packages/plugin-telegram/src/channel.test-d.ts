import { expectTypeOf } from 'vitest';
import type { Channel } from '@moxxy/sdk';
import type { TelegramChannel} from './channel.js';
import { type TelegramStartOpts } from './channel.js';

// Compile-time assertion: TelegramChannel satisfies the Channel<TelegramStartOpts> contract.
expectTypeOf<TelegramChannel>().toMatchTypeOf<Channel<TelegramStartOpts>>();
