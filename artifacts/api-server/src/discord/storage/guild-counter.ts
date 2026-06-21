import { dataFile } from "../../lib/paths";
import { loadPersistentJson, persistPersistentJson } from "./persistentJson";

const STORE = "guild-counter";
const FILE = () => dataFile("guild-count.json");

interface Store {
  count: number;
}

let cache: Store | null = null;
let writeQueue: Promise<void> = Promise.resolve();

async function load(): Promise<Store> {
  if (cache) return cache;
  cache = await loadPersistentJson<Store>(STORE, FILE(), { count: 0 });
  return cache;
}

async function save(store: Store): Promise<void> {
  cache = store;
  writeQueue = writeQueue.then(() => persistPersistentJson(STORE, FILE(), store));
  return writeQueue;
}

export async function incrementGuildCount(): Promise<number> {
  const store = await load();
  store.count = (store.count ?? 0) + 1;
  await save(store);
  return store.count;
}

export async function readGuildCount(): Promise<number> {
  const store = await load();
  return store.count ?? 0;
}