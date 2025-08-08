import OpenAI from 'openai';
import { sclient } from '../index';
import Database from './database';
import { readFileSync } from 'fs';
import { join } from 'path';

interface CooldownEntry {
  userId: string;
  lastUsed: number;
}

interface ToolExecutionContext {
  message: any; // Seyfert message object with reply method
  user: any; // Seyfert user object
  client: any; // Seyfert client object
}

interface MessageHistory {
  id: number;
  user_id: string;
  channel_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: Date;
}

class WeyraAI {
  private client: OpenAI;
  private tools: Array<any> = [];
  private cooldowns: Map<string, CooldownEntry> = new Map();
  private aiPrompt: string = '';

  constructor() {
    this.client = new OpenAI({
        apiKey: process.env['OPENAI_API_KEY'], // api key
    });

    this.tools = this.initializeTools();
    this.initializeDatabase();
    this.loadAIPrompt();
  }

  private loadAIPrompt() {
    try {
      const promptPath = join(__dirname, '../../ai_prompt.txt');
      this.aiPrompt = readFileSync(promptPath, 'utf-8').trim();
      sclient.logger.info('AI prompt loaded successfully');
    } catch (error) {
      sclient.logger.warn('Failed to load AI prompt, using default:', error);
      this.aiPrompt = `Error`;
    }
  }

  private cleanMessageContent(message: any, client: any): string {
    let content = message.content;
    
    // Remove bot mention from the beginning of the message
    const mentionPattern = new RegExp(`^<@!?${client.botId}>\\s*`, 'i');
    content = content.replace(mentionPattern, '').trim();
    
    return content;
  }

  private async initializeDatabase() {
    try {
      // create memories table
      await Database.query(`
        CREATE TABLE IF NOT EXISTS memories (
          id SERIAL PRIMARY KEY,
          user_id VARCHAR(255) NOT NULL,
          keywords TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      // create message history table
      await Database.query(`
        CREATE TABLE IF NOT EXISTS message_history (
          id SERIAL PRIMARY KEY,
          user_id VARCHAR(255) NOT NULL,
          channel_id VARCHAR(255) NOT NULL,
          role VARCHAR(50) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
          content TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      // create index for keywords
      await Database.query(`
        CREATE INDEX IF NOT EXISTS idx_memories_keywords 
        ON memories USING gin(to_tsvector('english', keywords))
      `);
      
      // create indexes for message history
      await Database.query(`
        CREATE INDEX IF NOT EXISTS idx_message_history_user_channel 
        ON message_history (user_id, channel_id, created_at DESC)
      `);
      
      sclient.logger.info('Database tables initialized');
    } catch (error) {
      sclient.logger.error('Failed to initialize Database:', error);
    }
  }

  private initializeTools() {
    return [
      {
        type: "function",
        function: {
          name: "reply_to_user",
          description: "Send reply messages to the user. Can send multiple messages with individual cooldowns to simulate natural human conversation",
          parameters: {
            type: "object",
            properties: {
              messages: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    content: {
                      type: "string",
                      description: "The message content to send"
                    },
                    cooldown: {
                      type: "number",
                      description: "Cooldown in milliseconds before sending this message (default: 1000ms for natural typing speed)"
                    }
                  },
                  required: ["content"]
                },
                description: "Array of message objects with content and optional individual cooldowns. Use multiple messages to break long responses into natural chunks like a real person would type."
              },
              timeout: {
                type: "number",
                description: "Optional initial timeout in milliseconds before sending the first reply"
              }
            },
            required: ["messages"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "get_memory",
          description: "Retrieve saved memory using keywords from the database",
          parameters: {
            type: "object",
            properties: {
              keywords: {
                type: "string",
                description: "Keywords to search for in saved memories"
              },
              user_id: {
                type: "string",
                description: "User ID to search memories for (optional, defaults to current user)"
              }
            },
            required: ["keywords"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "save_memory",
          description: "Save a memory with keywords to the database",
          parameters: {
            type: "object",
            properties: {
              keywords: {
                type: "string",
                description: "Keywords associated with this memory for future retrieval"
              },
              content: {
                type: "string",
                description: "The content/memory to save"
              },
              user_id: {
                type: "string",
                description: "User ID to save memory for (optional, defaults to current user)"
              }
            },
            required: ["keywords", "content"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "get_user_info",
          description: "Get information about a Discord user",
          parameters: {
            type: "object",
            properties: {
              user_id: {
                type: "string",
                description: "User ID to get info for (optional, defaults to current user)"
              }
            }
          }
        }
      },
      {
        type: "function",
        function: {
          name: "get_time",
          description: "Get current time for a specific timezone",
          parameters: {
            type: "object",
            properties: {
              timezone: {
                type: "string",
                description: "Timezone to get time for (e.g., 'America/New_York', 'Europe/London')"
              }
            },
            required: ["timezone"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "get_weather",
          description: "Get weather information for a specific city",
          parameters: {
            type: "object",
            properties: {
              city: {
                type: "string",
                description: "City name to get weather for"
              }
            },
            required: ["city"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "get_server_info",
          description: "Get information about the Discord server",
          parameters: {
            type: "object",
            properties: {}
          }
        }
      },
      {
        type: "function",
        function: {
          name: "clear_history",
          description: "Clear conversation history for the current user and channel",
          parameters: {
            type: "object",
            properties: {
              confirm: {
                type: "boolean",
                description: "Confirmation to clear history (must be true)"
              }
            },
            required: ["confirm"]
          }
        }
      }
    ];
  }

  async generateResponse(messages: Array<{ role: 'user' | 'assistant' | 'system', content: string }>, context?: ToolExecutionContext) {
    let typingInterval: NodeJS.Timeout | null = null;
    
    try {
        const response = await this.client.chat.completions.create({
            model: process.env['OPENAI_MODEL'] || 'gpt-4o-mini',
            messages: messages,
            tools: this.tools,
            tool_choice: 'auto'
        });

        const choice = response.choices[0];
        if (!choice?.message) {
            throw new Error('No response from OpenAI');
        }

        // handle tool calls
        if (choice.message.tool_calls && context) {
            for (const toolCall of choice.message.tool_calls) {
                try {
                    const result = await this.executeTool(toolCall, context);
                    // add tool result to conversation history
                    messages.push({
                        role: 'assistant',
                        content: choice.message.content || ''
                    });
                    messages.push({
                        role: 'system',
                        content: `Tool ${toolCall.function.name} executed with result: ${JSON.stringify(result)}`
                    });
                } catch (toolError) {
                    sclient.logger.error(`Tool execution error for ${toolCall.function.name}:`, toolError);
                    messages.push({
                        role: 'system',
                        content: `Tool ${toolCall.function.name} failed: ${toolError}`
                    });
                }
            }
            
            // Get final response after tool execution
            const finalResponse = await this.client.chat.completions.create({
                model: process.env['OPENAI_MODEL'] || 'gpt-4o-mini',
                messages: messages,
            });
            return finalResponse.choices[0]?.message?.content || '';
        }

        return choice.message.content || '';
    } catch (error) {
        sclient.logger.error('generateResponse error:', error);
        throw error;
    } finally {
        // Clear typing interval
        if (typingInterval) {
          clearInterval(typingInterval);
        }
    }
  }

  private async executeTool(toolCall: any, context: ToolExecutionContext) {
    const { name, arguments: args } = toolCall.function;
    const parsedArgs = JSON.parse(args);

    switch (name) {
      case 'reply_to_user':
        return await this.replyToUser(parsedArgs, context);
      case 'get_memory':
        return await this.getMemory(parsedArgs, context);
      case 'save_memory':
        return await this.saveMemory(parsedArgs, context);
      case 'get_user_info':
        return await this.getUserInfo(parsedArgs, context);
      case 'get_time':
        return await this.getTime(parsedArgs);
      case 'get_weather':
        return await this.getWeather(parsedArgs);
      case 'get_server_info':
        return await this.getServerInfo(context);
      case 'clear_history':
        return await this.clearHistory(parsedArgs, context);
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  private async replyToUser(args: any, context: ToolExecutionContext) {
    const { messages, timeout = 0 } = args;
    const userId = context.user.id;
    const channelId = context.message.channelId;
    
    // Normalize messages - handle both string and array formats
    let normalizedMessages: Array<{ content: string; cooldown: number }>;
    
    if (typeof messages === 'string') {
      // Single string message
      normalizedMessages = [{ content: messages, cooldown: 0 }];
    } else if (Array.isArray(messages)) {
      // Array of messages
      normalizedMessages = messages.map((msg: any, index: number) => {
        if (typeof msg === 'string') {
          return { content: msg, cooldown: index > 0 ? 1000 : 0 };
        } else {
          return { 
            content: msg.content, 
            cooldown: msg.cooldown || (index > 0 ? 1000 : 0) 
          };
        }
      });
    } else {
      throw new Error('Messages must be a string or array of message objects');
    }
    
    // Check global cooldown for multiple messages
    if (normalizedMessages.length > 1) {
      const cooldownKey = `reply_${userId}`;
      const lastUsed = this.cooldowns.get(cooldownKey);
      const globalCooldown = 2000; // 2 seconds global cooldown for multiple messages
      
      if (lastUsed && Date.now() - lastUsed.lastUsed < globalCooldown) {
        throw new Error(`Please wait ${Math.ceil((globalCooldown - (Date.now() - lastUsed.lastUsed)) / 1000)} seconds before sending multiple messages again.`);
      }
      
      this.cooldowns.set(cooldownKey, { userId, lastUsed: Date.now() });
    }

    try {
      // Apply initial timeout if specified
      if (timeout > 0) {
        await new Promise(resolve => setTimeout(resolve, timeout));
      }

      const results = [];
      for (let i = 0; i < normalizedMessages.length; i++) {
        const { content, cooldown } = normalizedMessages[i];
        
        // Apply cooldown before sending (except for first message)
        if (i > 0 && cooldown > 0) {
          await new Promise(resolve => setTimeout(resolve, cooldown));
        }
        
        await context.message.reply({ content: content });
        // Save each reply to history
        await this.saveMessageToHistory(userId, channelId, 'assistant', content);
        results.push(`Message ${i + 1} sent successfully (cooldown: ${cooldown}ms)`);
      }

      return { success: true, messages_sent: normalizedMessages.length, results };
    } catch (error) {
      sclient.logger.error('Reply error:', error);
      throw error;
    }
  }

  private async getMemory(args: any, context: ToolExecutionContext) {
    const { keywords, user_id = context.user.id } = args;
    
    try {
      const result = await Database.query(`
        SELECT * FROM memories 
        WHERE user_id = $1 
        AND to_tsvector('english', keywords) @@ plainto_tsquery('english', $2)
        ORDER BY ts_rank(to_tsvector('english', keywords), plainto_tsquery('english', $2)) DESC
        LIMIT 5
      `, [user_id, keywords]);

      return {
        found: result.rows.length > 0,
        memories: result.rows,
        search_keywords: keywords
      };
    } catch (error) {
      sclient.logger.error('Get memory error:', error);
      throw error;
    }
  }

  private async saveMemory(args: any, context: ToolExecutionContext) {
    const { keywords, content, user_id = context.user.id } = args;
    
    try {
      const result = await Database.query(`
        INSERT INTO memories (user_id, keywords, content)
        VALUES ($1, $2, $3)
        RETURNING id
      `, [user_id, keywords, content]);

      return {
        success: true,
        memory_id: result.rows[0].id,
        keywords,
        content_length: content.length
      };
    } catch (error) {
      sclient.logger.error('Save memory error:', error);
      throw error;
    }
  }

  private async getUserInfo(args: any, context: ToolExecutionContext) {
    const { user_id = context.user.id } = args;
    
    try {
      let user;
      if (user_id === context.user.id) {
        user = context.user;
      } else {
        // Fetch user from Discord API if different user requested
        user = await context.client.users.fetch(user_id);
      }

      return {
        id: user.id,
        username: user.username,
        discriminator: user.discriminator,
        avatar: user.avatar,
        bot: user.bot,
        created_at: new Date(parseInt(user.id) / 4194304 + 1420070400000).toISOString()
      };
    } catch (error) {
      sclient.logger.error('Get user info error:', error);
      throw error;
    }
  }

  private async getTime(args: any) {
    const { timezone } = args;
    
    try {
      const now = new Date();
      const timeInTimezone = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZoneName: 'short'
      }).format(now);

      return {
        timezone,
        current_time: timeInTimezone,
        utc_time: now.toISOString(),
        timestamp: now.getTime()
      };
    } catch (error) {
      sclient.logger.error('Get time error:', error);
      throw error;
    }
  }

  private async getWeather(args: any) {
    const { city } = args;
    
    try {
      const response = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1`);
      
      if (!response.ok) {
        throw new Error(`wttr.in error: ${response.status}`);
      }
      
      const data = await response.json();
      
      return {
        city,
        current_condition: data.current_condition[0],
        weather: data.weather[0],
        nearest_area: data.nearest_area[0]
      };
    } catch (error) {
      sclient.logger.error('weather error:', error);
      throw error;
    }
  }

  private async getServerInfo(context: ToolExecutionContext) {
    try {
      const guild = context.message.guild();
      if (!guild) {
        throw new Error('This command can only be used in a server');
      }

      return {
        id: guild.id,
        name: guild.name,
        description: guild.description,
        member_count: guild.memberCount,
        created_at: new Date(parseInt(guild.id) / 4194304 + 1420070400000).toISOString(),
        owner_id: guild.ownerId,
        verification_level: guild.verificationLevel,
        boost_level: guild.premiumTier,
        boost_count: guild.premiumSubscriptionCount
      };
    } catch (error) {
      sclient.logger.error('Get server info error:', error);
      throw error;
    }
  }

  private async saveMessageToHistory(userId: string, channelId: string, role: 'user' | 'assistant' | 'system', content: string) {
    try {
      await Database.query(`
        INSERT INTO message_history (user_id, channel_id, role, content)
        VALUES ($1, $2, $3, $4)
      `, [userId, channelId, role, content]);
    } catch (error) {
      sclient.logger.error('Save message to history error:', error);
    }
  }

  private async getMessageHistory(userId: string, channelId: string, limit: number = 10): Promise<MessageHistory[]> {
    try {
      const result = await Database.query(`
        SELECT * FROM message_history 
        WHERE user_id = $1 AND channel_id = $2
        ORDER BY created_at DESC
        LIMIT $3
      `, [userId, channelId, limit]);

      return result.rows.reverse(); // Return in chronological order
    } catch (error) {
      sclient.logger.error('Get message history error:', error);
      return [];
    }
  }

  private async cleanOldHistory(userId: string, channelId: string, keepLast: number = 20) {
    try {
      await Database.query(`
        DELETE FROM message_history 
        WHERE user_id = $1 AND channel_id = $2
        AND id NOT IN (
          SELECT id FROM message_history 
          WHERE user_id = $1 AND channel_id = $2
          ORDER BY created_at DESC 
          LIMIT $3
        )
      `, [userId, channelId, keepLast]);
    } catch (error) {
      sclient.logger.error('Clean old history error:', error);
    }
  }

  private async clearHistory(args: any, context: ToolExecutionContext) {
    const { confirm } = args;
    const userId = context.user.id;
    const channelId = context.message.channelId;
    
    if (!confirm) {
      throw new Error('History clearing requires confirmation');
    }

    try {
      const result = await Database.query(`
        DELETE FROM message_history 
        WHERE user_id = $1 AND channel_id = $2
      `, [userId, channelId]);

      return {
        success: true,
        messages_deleted: result.rowCount || 0,
        user_id: userId,
        channel_id: channelId
      };
    } catch (error) {
      sclient.logger.error('Clear history error:', error);
      throw error;
    }
  }

  async handleMessage(message: any, user: any, client: any) {
    const context: ToolExecutionContext = { message, user, client };
    
    try {
      const guild = await message.guild();
      const cleanContent = this.cleanMessageContent(message, client);
      const channelId = message.channelId;
      const userId = user.id;
      
      // Start typing indicator
      await client.channels.typing(channelId);
      
      // Save user message to history
      await this.saveMessageToHistory(userId, channelId, 'user', cleanContent || message.content);
      
      // Get conversation history
      const history = await this.getMessageHistory(userId, channelId, 8); // Last 8 messages
      
      // Build messages array with system prompt and history
      const messages: Array<{ role: 'user' | 'assistant' | 'system', content: string }> = [
        {
          role: 'system' as const,
          content: `${this.aiPrompt}
          
          Current context:
          - User: ${user.username} (${user.id})
          - Server: ${guild?.name || 'DM'}
          - Channel: ${message.channel?.name || 'Unknown'}
          
          Available tools:
          - reply_to_user: Send multiple messages with individual cooldowns to simulate natural human conversation. Break long responses into shorter, natural chunks like a real person would type. Use format: [{ content: "message", cooldown: 1000 }, ...]
          - get_memory/save_memory: Store and retrieve user memories
          - get_user_info: Get Discord user information  
          - get_time: Get time in any timezone
          - get_weather: Get weather for any city
          - get_server_info: Get Discord server information
          - clear_history: Clear conversation history for current user/channel
          
          IMPORTANT: When responding with longer information (like weather, explanations, etc), break it into multiple natural messages like a real person would type. Example:
          Instead of: "It's cloudy and 23°C, but feels warmer, around 25°C. Very calm, no rain."
          Use: [{ content: "ta nublado com 23°", cooldown: 1500 }, { content: "mas parece mais quente tipo 25°", cooldown: 2000 }, { content: "bem tranquilo sem chuva", cooldown: 1000 }]`
        }
      ];

      // Add conversation history
      for (const historyMsg of history) {
        messages.push({
          role: historyMsg.role as 'user' | 'assistant' | 'system',
          content: historyMsg.content
        });
      }

      // Add current message if not already in history
      if (history.length === 0 || history[history.length - 1].content !== (cleanContent || message.content)) {
        messages.push({
          role: 'user' as const,
          content: cleanContent || message.content
        });
      }

      const response = await this.generateResponse(messages, context);
      
      // If no tools were called, send a regular reply
      if (response) {
        await message.reply({ content: response + "\u200B" });
        // Save assistant response to history
        await this.saveMessageToHistory(userId, channelId, 'assistant', response);
      }
      
      // Clean old history periodically (keep last 20 messages)
      if (Math.random() < 0.1) { // 10% chance to clean
        await this.cleanOldHistory(userId, channelId, 20);
      }
      
    } catch (error) {
      sclient.logger.error('Handle message error:', error);
      await message.reply({ 
        content: 'my head hurts' 
      });
    }
  }
}

export default new WeyraAI();