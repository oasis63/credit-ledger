import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { migrate } from './migrate.js';
import { ConsoleSender, WhatsAppCloudSender, type MessageSender } from './services/whatsapp.js';

async function main() {
  const config = loadConfig();
  const db = createPool(config.DATABASE_URL);
  await migrate(db);

  const sender: MessageSender =
    config.WHATSAPP_MODE === 'cloud'
      ? new WhatsAppCloudSender({
          token: config.WHATSAPP_TOKEN!,
          phoneNumberId: config.WHATSAPP_PHONE_NUMBER_ID!,
          reminderTemplate: config.WHATSAPP_REMINDER_TEMPLATE,
          receiptTemplate: config.WHATSAPP_RECEIPT_TEMPLATE,
        })
      : new ConsoleSender((m) => console.log(m));
  const app = await buildApp({ config, db, sender });

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    await db.end();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ port: config.PORT, host: config.HOST });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
