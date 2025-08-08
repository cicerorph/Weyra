import { Client } from 'seyfert';
import { ActivityType, PresenceUpdateStatus } from 'seyfert/lib/types';
import { RedisAdapter } from '@slipher/redis-adapter';

const client = new Client({
    gateway: { // Put the discord mobile status
        properties: {
            os: 'android',
            browser: 'Discord Android',
            device: 'android'
        }
    },
    presence: (_shardId) => ({ // presence, doesn't work well with the discord mobile status but it's a fallback
        status: PresenceUpdateStatus.Online,
        activities: [{
            name: "I'm Weyra, your friendly bot!",
            type: ActivityType.Custom,
        }],
        since: Date.now(),
        afk: false,
    }),
    commands: {
        prefix: (_msg) => {
            return ["w-"];
        },
        reply: (_ctx) => true,
        deferReplyResponse: (_ctx) => ({ content: 'Please wait, processing your request...' })
    },
    allowedMentions: { // so the bot doesnt mention people
        parse: [],
    },
});

client.setServices({ // redis cache
    cache: {
        adapter: new RedisAdapter({
            redisOptions: {
                url: process.env.REDIS_URL || 'redis://localhost:6379',
            },
            namespace: 'weyra',
        })
    }
});

// starts the bot
client.start()
  .then(() => {
    console.log(`Bot started as ${client.botId}`);
    return client.uploadCommands({ cachePath: './commands.json' });
  });


export { client as sclient }; // export so we can use it in other files
