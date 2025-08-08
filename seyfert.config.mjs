import { config } from "seyfert";
 
export default config.bot({
    token: process.env.BOT_TOKEN ?? "",
    locations: {
        base: "src",
        commands: "commands",
        events: 'events' // - src/events will be our folder for events
    },
    intents: ["MessageContent", "GuildMessages", "GuildPresences"],
    // This configuration is optional, in case you want to receive interactions via HTTP
    // This allows you to use both the gateway and the HTTP webhook
    //publicKey: "...", // replace with your public key
    //port: 4444, // replace with your application's port 
});