import { createEvent, Message, UsingClient } from 'seyfert';
import WeyraAI from '../utils/WeryaAI';
import database from '../utils/database';

function isToBot(message: Message, client: UsingClient): boolean {
  // check if it starts with the bot's mention
  const mentionPattern = new RegExp(`^<@!?${client.botId}>`, 'i');
  if (mentionPattern.test(message.content)) {
    return true;
  }

  // check if message is a reply to the bot
  if (message.referencedMessage && message.referencedMessage.author.id === client.botId) {
    return true;
  }
  // check if bot its mentioned
  if (message.mentions && message.mentions.users.some(user => user.id === client.botId)) {
    return true;
  }

  return false;
}
 
export default createEvent({
  data: { name: 'messageCreate' },
  async run(message, client) {
    // ignore bots for AI responses
    if (message.author.bot) return;

    // check if its for the bot
    if (isToBot(message, client)) {
      try {
        // Mark channel as active when bot is mentioned/replied to
        await database.markChannelActive(message.channelId);

        await WeyraAI.handleMessage(message, message.author, client);
      } catch (error) {
        console.error('AI error:', error);
        await message.reply({
          content: "my head hurts"
        });
      }
    } else {
      // Only mark channel as active for context, WeyraAI handles its own message storage
      try {
        const isActive = await database.isChannelActive(message.channelId);
        if (isActive) {
          // Channel is active, WeyraAI will handle message storage in its own format
        }
      } catch (error) {
        console.error('Error checking channel activity:', error);
      }
    }
  }
})