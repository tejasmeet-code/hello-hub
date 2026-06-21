import type {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandsOnlyBuilder,
} from "discord.js";

export interface SlashCommand {
  data:
    | SlashCommandBuilder
    | SlashCommandOptionsOnlyBuilder
    | SlashCommandSubcommandsOnlyBuilder
    | Omit<SlashCommandBuilder, "addSubcommand" | "addSubcommandGroup">;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
  /**
   * If true, this command is NOT registered globally with Discord, so it
   * does not appear in the slash-command picker for any user. It can only
   * be invoked via prefix command (?nuke / ?highfi) by global-whitelist users.
   */
  globalWhitelistOnly?: boolean;
  /**
   * If true, this command is registered ONLY globally (not per-guild).
   * Use for commands that need to work in DMs, e.g. /appeal.
   */
  globalOnly?: boolean;
}
