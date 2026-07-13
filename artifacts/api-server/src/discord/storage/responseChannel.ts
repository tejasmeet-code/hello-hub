import { dataFile } from "../../lib/paths";
import { loadPersistentJson, persistPersistentJson } from "./persistentJson";

interface ResponseChannelShape {
  channelId: string | null;
}

const STORE_NAME = "responseChannel.json";
const FILE_PATH = dataFile("responseChannel.json");

let cache: ResponseChannelShape | null = null;
let writeQueue: Promise<void> = Promise.resolve();

async function load(): Promise<ResponseChannelShape> {
  if (cache) return cache;
  cache = await loadPersistentJson<ResponseChannelShape>(STORE_NAME, FILE_PATH, { channelId: null });
  return cache;
}

async function persist(data: ResponseChannelShape): Promise<void> {
  await persistPersistentJson(STORE_NAME, FILE_PATH, data);
}

export async function getResponseChannelId(): Promise<string | null> {
  const data = await load();
  return data.channelId;
}

export async function setResponseChannelId(channelId: string): Promise<void> {
  const data = await load();
  data.channelId = channelId;
  writeQueue = writeQueue.then(() => persist(data)).catch(() => {});
  await writeQueue;
}

export async function clearResponseChannelId(): Promise<void> {
  const data = await load();
  data.channelId = null;
  writeQueue = writeQueue.then(() => persist(data)).catch(() => {});
  await writeQueue;
}
