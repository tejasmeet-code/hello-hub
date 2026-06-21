import { dataFile } from "../../lib/paths";
import { loadPersistentJson, persistPersistentJson } from "./persistentJson";

const STORE = "notes";
const FILE = () => dataFile("notes.json");

export interface Note {
  id: string;
  userId: string;
  guildId: string;
  note: string;
  addedBy: string;
  addedAt: number;
}

interface Store {
  [guildId: string]: Note[];
}

let cache: Store | null = null;
let writeQueue: Promise<void> = Promise.resolve();

async function load(): Promise<Store> {
  if (cache) return cache;
  cache = await loadPersistentJson<Store>(STORE, FILE(), {});
  return cache;
}

async function save(store: Store): Promise<void> {
  cache = store;
  writeQueue = writeQueue.then(() => persistPersistentJson(STORE, FILE(), store));
  return writeQueue;
}

export async function addNote(
  guildId: string,
  userId: string,
  note: string,
  addedBy: string,
): Promise<Note> {
  const store = await load();
  if (!store[guildId]) store[guildId] = [];
  const entry: Note = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    userId, guildId, note, addedBy, addedAt: Date.now(),
  };
  store[guildId].push(entry);
  await save(store);
  return entry;
}

export async function getNotes(guildId: string, userId: string): Promise<Note[]> {
  const store = await load();
  return (store[guildId] ?? []).filter((n) => n.userId === userId);
}

export async function deleteNote(guildId: string, noteId: string): Promise<boolean> {
  const store = await load();
  const list = store[guildId] ?? [];
  const idx = list.findIndex((n) => n.id === noteId);
  if (idx === -1) return false;
  list.splice(idx, 1);
  store[guildId] = list;
  await save(store);
  return true;
}