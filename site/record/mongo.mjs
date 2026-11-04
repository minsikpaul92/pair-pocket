// Local MongoDB for recording, no install or admin rights needed: downloads the
// official mongod binary once, then runs a one-node replica set (the app needs
// transactions) on 127.0.0.1:27017. Data persists in site/record/.mongo-data.
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const dbPath = fileURLToPath(new URL('./.mongo-data', import.meta.url));
mkdirSync(dbPath, { recursive: true });

const replSet = await MongoMemoryReplSet.create({
  replSet: { count: 1, name: 'rs0', storageEngine: 'wiredTiger' },
  instanceOpts: [{ port: 27017, ip: '127.0.0.1', dbPath }],
});
console.log('MongoDB ready at', replSet.getUri());

process.on('SIGINT', async () => {
  await replSet.stop({ doCleanup: false });
  process.exit(0);
});
setInterval(() => {}, 1 << 30);
