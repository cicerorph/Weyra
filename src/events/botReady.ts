import { createEvent } from 'seyfert';
 
export default createEvent({
  // botReady is triggered when all shards and servers are ready.
  // `once` ensures the event runs only once.
  data: { once: true, name: 'botReady' },
  run(user, client) {
 
    //  We can use client.logger to display messages in the console.
    client.logger.info(`${user.username} is ready`);
 
  }
})