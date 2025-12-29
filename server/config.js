import 'dotenv/config';

export default {
  discord: {
    clientId: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
  },
  consumetApi: process.env.CONSUMET_API_URL || 'https://api.consumet.org',
  server: {
    port: parseInt(process.env.PORT) || 3000,
    host: process.env.HOST || 'localhost',
  },
  proxySecret: process.env.PROXY_SECRET || 'dev-secret-change-me-in-prod-12345',
};
