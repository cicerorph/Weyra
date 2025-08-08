import { Pool, PoolClient } from 'pg';
import { sclient } from '../index';

class Database {
  private pool: Pool;

  constructor() {
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    });

    // Test the connection
    this.testConnection();
  }

  private async testConnection() {
    try {
      const client = await this.pool.connect();
      sclient.logger.info('Connected to database successfully');
      client.release();
    } catch (error) {
      sclient.logger.error('Failed to connect to the database:', error);
    }
  }

  async query(text: string, params?: any[]): Promise<any> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(text, params);
      return result;
    } catch (error) {
      sclient.logger.error('Database query error:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async getClient(): Promise<PoolClient> {
    return await this.pool.connect();
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  // Channel tracking methods only
  async markChannelActive(channelId: string): Promise<void> {
    // First ensure the table exists
    await this.query(`
      CREATE TABLE IF NOT EXISTS active_channels (
        channel_id VARCHAR(20) PRIMARY KEY,
        last_interaction TIMESTAMP DEFAULT NOW()
      )
    `);
    
    // Then insert/update the channel
    await this.query(`
      INSERT INTO active_channels (channel_id, last_interaction)
      VALUES ($1, NOW())
      ON CONFLICT (channel_id) 
      DO UPDATE SET last_interaction = NOW()
    `, [channelId]);
  }

  async isChannelActive(channelId: string): Promise<boolean> {
    // First ensure the table exists
    await this.query(`
      CREATE TABLE IF NOT EXISTS active_channels (
        channel_id VARCHAR(20) PRIMARY KEY,
        last_interaction TIMESTAMP DEFAULT NOW()
      )
    `);
    
    // Then check if channel exists
    const result = await this.query(`
      SELECT 1 FROM active_channels WHERE channel_id = $1
    `, [channelId]);
    
    return result.rows.length > 0;
  }
}

export default new Database();