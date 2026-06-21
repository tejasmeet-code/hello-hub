import { dataFile } from "../../lib/paths";
import { loadPersistentJson, persistPersistentJson } from "./persistentJson";

interface ServerVerificationConfig {
  // Roles to assign when pulling members
  rolesToAssign: string[];
  // Whether to use modal with button instead of direct confirmation
  useModal: boolean;
  // Custom message for verification
  customMessage?: string;
  // Channel used to post verification prompt messages
  verifyChannelId?: string;
}

interface VerificationConfigShape {
  // serverId -> config
  configs: Record<string, ServerVerificationConfig>;
}

const FILE_PATH = dataFile("verification-config.json");

let cache: VerificationConfigShape | null = null;
let writeQueue: Promise<void> = Promise.resolve();

async function load(): Promise<VerificationConfigShape> {
  if (cache) return cache;
  const parsed = await loadPersistentJson<Partial<VerificationConfigShape>>(
    "verification-config.json",
    FILE_PATH,
    { configs: {} },
  );
  cache = {
    configs: parsed.configs && typeof parsed.configs === "object" ? parsed.configs : {},
  };
  return cache;
}

async function persist(data: VerificationConfigShape): Promise<void> {
  await persistPersistentJson("verification-config.json", FILE_PATH, data);
}

export async function getServerConfig(serverId: string): Promise<ServerVerificationConfig> {
  const data = await load();
  return data.configs[serverId] || {
    rolesToAssign: [],
    useModal: false,
  };
}

export async function setServerConfig(serverId: string, config: ServerVerificationConfig): Promise<void> {
  const data = await load();
  data.configs[serverId] = config;
  writeQueue = writeQueue.then(() => persist(data)).catch(() => {});
  await writeQueue;
}

export async function updateServerConfig(
  serverId: string,
  updates: Partial<ServerVerificationConfig>
): Promise<void> {
  const current = await getServerConfig(serverId);
  const updated = { ...current, ...updates };
  await setServerConfig(serverId, updated);
}