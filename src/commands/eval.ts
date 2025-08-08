import { Declare, Command, type CommandContext } from 'seyfert';
 
@Declare({
  name: 'ping',
  description: 'check my latency'
})
export default class PingCommand extends Command {
  async run(ctx: CommandContext) {
    // Average latency between existing connections
    //@ts-ignore
    const ping = ctx.client.gateway.latency;
 
    await ctx.write({
      content: `The latency is \`${ping}\``
    });
  }
}