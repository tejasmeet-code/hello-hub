import type { SlashCommand } from "./types";
import afk from "./commands/afk";
import adduser from "./commands/adduser";
import aiAdmin from "./commands/ai-admin";
import botCheck from "./commands/bot-check";
import announce from "./commands/announce";
import automod from "./commands/automod";
import automations from "./commands/automations";
import appeal from "./commands/appeal";
import avatar from "./commands/avatar";
import banRequest from "./commands/ban-request";
import ban from "./commands/ban";
import blacklist from "./commands/blacklist";
import botAdmin from "./commands/bot-admin";
import botAnnounce from "./commands/bot-announce";
import botinfo from "./commands/botinfo";
import caseCommand from "./commands/case";
import channelGuess from "./commands/channelGuess";
import channelLock from "./commands/channelLock";
import channelShuffle from "./commands/channelShuffle";
import choice from "./commands/choice";
import closeTicket from "./commands/close-ticket";
import coinflip from "./commands/coinflip";
import config from "./commands/config";
import intro from "./commands/intro";
import connectServers from "./commands/connect-servers";
import connect4 from "./commands/connect4";
import cursedNicknames from "./commands/cursedNicknames";
import customerPoints from "./commands/customer-points";
import demote from "./commands/demote";
import dm from "./commands/dm";
import editCase from "./commands/edit-case";
import eightball from "./commands/eightball";
import emojiChannels from "./commands/emojiChannels";
import fortune from "./commands/fortune";
import globalBackup from "./commands/global-backup";
import guess from "./commands/guess";
import hangman from "./commands/hangman";
import help from "./commands/help";
import higherlower from "./commands/higherlower";
import highfi from "./commands/highfi";
import infraction from "./commands/infraction";
import infractions from "./commands/infractions";
import jail from "./commands/jail";
import kick from "./commands/kick";
import loa from "./commands/loa";
import lock from "./commands/lock";
import maintenance from "./commands/maintenance";
import meme from "./commands/meme";
import modhistory from "./commands/modhistory";
import modstats from "./commands/modstats";
import mute from "./commands/mute";
import nickname from "./commands/nickname";
import note from "./commands/note";
import nuke from "./commands/nuke";
import nukeAntiWhitelist from "./commands/nukeAntiWhitelist";
import partnershipScore from "./commands/partnership-score";
import partnership from "./commands/partnership";
import ping from "./commands/ping";
import poll from "./commands/poll";
import postProof from "./commands/post-proof";
import preset from "./commands/preset";
import privateTicket from "./commands/private-ticket";
import profile from "./commands/profile";
import promote from "./commands/promote";
import pull from "./commands/pull";
import pullable from "./commands/pullable";
import purge from "./commands/purge";
import quota from "./commands/quota";
import randomcolor from "./commands/randomcolor";
import rate from "./commands/rate";
import roleMystery from "./commands/roleMystery";
import roleRainbow from "./commands/roleRainbow";
import rolegive from "./commands/rolegive";
import roleinfo from "./commands/roleinfo";
import roleremove from "./commands/roleremove";
import roll from "./commands/roll";
import rps from "./commands/rps";
import russianroulette from "./commands/russianroulette";
import say from "./commands/say";
import scrambleChannels from "./commands/scrambleChannels";
import scrambleRoles from "./commands/scrambleRoles";
import serverBackup from "./commands/server-backup";
import servercount from "./commands/servercount";
import serverinfo from "./commands/serverinfo";
import setavatar from "./commands/setavatar";
import ship from "./commands/ship";
import shopTopStaff from "./commands/shop-top-staff";
import slots from "./commands/slots";
import slowmode from "./commands/slowmode";
import spooky from "./commands/spooky";
import staffDatabase from "./commands/staff-database";
import staffHistory from "./commands/staff-history";
import staffProfile from "./commands/staff-profile";
import staffReport from "./commands/staff-report";
import staffRoleAdd, { removeCommand as staffRoleRemove } from "./commands/staff-role-add";
import staffRoles from "./commands/staff-roles";
import staffShopScore from "./commands/staff-shop-score";
import staffUpdateReport from "./commands/staff-update-report";
import tictactoe from "./commands/tictactoe";
import timeout from "./commands/timeout";
import trivia from "./commands/trivia";
import unbanAll from "./commands/unban-all";
import unban from "./commands/unban";
import unclaim from "./commands/unclaim";
import unjail from "./commands/unjail";
import unlock from "./commands/unlock";
import unmute from "./commands/unmute";
import untimeout from "./commands/untimeout";
import unwarn from "./commands/unwarn";
import upsideDown from "./commands/upsideDown";
import userinfo from "./commands/userinfo";
import vcdeafen from "./commands/vcdeafen";
import vckick from "./commands/vckick";
import vcmove from "./commands/vcmove";
import vcmute from "./commands/vcmute";
import verifyConfig from "./commands/verify-config";
import verifyOwnerCommands from "./commands/verify-owner-commands";
import setupWizardCommand from "./commands/setupWizard";
import autoReactCommand from "./commands/autoReact";
import { premiumUserCommand, premiumServerCommand, premiumGenerateCommand } from "./commands/premium";
import verify from "./commands/verify";
import verifyOwner from "./commands/verifyOwner";
import warn from "./commands/warn";
import whitelistGlobal from "./commands/whitelist-global";
import whitelist from "./commands/whitelist";
import whitelistAll from "./commands/whitelistAll";
import wordscramble from "./commands/wordscramble";
import wouldyourather from "./commands/wouldyourather";
import giveaway from "./commands/giveaway";
import rank from "./commands/rank";
import leaderboard from "./commands/leaderboard";
import giveXp from "./commands/give-xp";

const allCommands: SlashCommand[] = [
  afk,
  adduser,
  aiAdmin,
  botCheck,
  announce,
  automod,
  automations,
  appeal,
  avatar,
  banRequest,
  ban,
  blacklist,
  botAdmin,
  botAnnounce,
  botinfo,
  caseCommand,
  channelGuess,
  channelLock,
  channelShuffle,
  choice,
  closeTicket,
  coinflip,
  config,
  connectServers,
  connect4,
  cursedNicknames,
  customerPoints,
  demote,
  dm,
  editCase,
  eightball,
  emojiChannels,
  fortune,
  globalBackup,
  guess,
  hangman,
  help,
  higherlower,
  highfi,
  infraction,
  infractions,
  jail,
  kick,
  loa,
  lock,
  maintenance,
  meme,
  modhistory,
  modstats,
  mute,
  nickname,
  note,
  nuke,
  nukeAntiWhitelist,
  partnershipScore,
  partnership,
  ping,
  poll,
  postProof,
  preset,
  privateTicket,
  profile,
  promote,
  pull,
  pullable,
  purge,
  quota,
  randomcolor,
  rate,
  roleMystery,
  roleRainbow,
  rolegive,
  roleinfo,
  roleremove,
  roll,
  rps,
  russianroulette,
  say,
  scrambleChannels,
  scrambleRoles,
  serverBackup,
  servercount,
  serverinfo,
  setavatar,
  ship,
  shopTopStaff,
  slots,
  slowmode,
  spooky,
  staffDatabase,
  intro,
  staffHistory,
  staffProfile,
  staffReport,
  staffRoleAdd,
  staffRoleRemove,
  staffRoles,
  staffShopScore,
  staffUpdateReport,
  tictactoe,
  timeout,
  trivia,
  unbanAll,
  unban,
  unclaim,
  unjail,
  unlock,
  unmute,
  untimeout,
  unwarn,
  upsideDown,
  userinfo,
  vcdeafen,
  vckick,
  vcmove,
  vcmute,
  verifyConfig,
  verifyOwnerCommands,
  verify,
  verifyOwner,
  warn,
  whitelistGlobal,
  whitelist,
  whitelistAll,
  wordscramble,
  wouldyourather,
  giveaway,
  rank,
  leaderboard,
  giveXp,
  setupWizardCommand,
  autoReactCommand,
  premiumUserCommand,
  premiumServerCommand,
  premiumGenerateCommand,
];

// Discord allows max 100 application commands per scope. The old registry was
// sending 140+ commands because it generated one /whitelist-<command> command
// for every moderation command. That makes Discord reject the entire bulk
// update, so nothing appears. Keep /whitelist as the single manager command and
// keep lower-priority prank/game commands out of slash registration.
const REGISTRATION_EXCLUDED_COMMAND_NAMES = new Set([
  // prank / chaos commands
  "channel-shuffle",
  "cursed-nicknames",
  "emoji-channels",
  "role-mystery",
  "role-rainbow",
  "russianroulette",
  "scramble-channels",
  "scramble-roles",
  "slots",
  "spooky",
  "upside-down",
  "wordscramble",
  // trivia / quiz
  "trivia",
  // pure fun / game commands (keep handler but no autocomplete entry)
  "choice",
  "coinflip",
  "fortune",
  "meme",
  "randomcolor",
  "rate",
  "roll",
  "rps",
  "tictactoe",
  "wouldyourather",
]);

// Dedupe by command name as a safety net: Discord rejects the entire bulk
// command payload if any two commands share a name, which silently breaks
// EVERY command registration. Keep the first occurrence and warn about dupes.
const seen = new Set<string>();
const commands: SlashCommand[] = [];
for (const cmd of allCommands) {
  const name = cmd.data.name;
  if (seen.has(name)) {
    console.warn(`[registry] Duplicate command name "${name}" — skipping.`);
    continue;
  }
  seen.add(name);
  commands.push(cmd);
}

export function getCommands(): SlashCommand[] {
  return commands;
}

export function getGlobalCommands(): SlashCommand[] {
  return commands.filter((cmd) => cmd.globalOnly && !cmd.globalWhitelistOnly);
}

export function getGuildCommands(): SlashCommand[] {
  return commands.filter(
    (cmd) =>
      !cmd.globalOnly &&
      !cmd.globalWhitelistOnly &&
      !REGISTRATION_EXCLUDED_COMMAND_NAMES.has(cmd.data.name),
  );
}

export function getCommandMap(): Map<string, SlashCommand> {
  const map = new Map<string, SlashCommand>();
  for (const cmd of commands) {
    map.set(cmd.data.name, cmd);
  }
  return map;
}

