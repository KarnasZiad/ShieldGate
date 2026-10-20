import { type Db, MongoClient } from 'mongodb';

export async function connectMongo(
  url: string,
  database: string,
): Promise<{ client: MongoClient; db: Db }> {
  const client = new MongoClient(url, {
    appName: 'shieldgate-api',
    serverSelectionTimeoutMS: 5_000,
  });
  await client.connect();
  return { client, db: client.db(database) };
}
