import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SlashCommand } from "../types";
import { CE } from "../utils/embedStyle";

interface MemeApiResponse {
  title?: string;
  url?: string;
  postLink?: string;
  subreddit?: string;
  author?: string;
  ups?: number;
  nsfw?: boolean;
  spoiler?: boolean;
}

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("meme")
    .setDescription("Fetch a random meme."),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const res = await fetch("https://meme-api.com/gimme", {
        signal: controller.signal,
      });
      if (!res.ok) {
        await interaction.editReply("The meme service didn't respond well. Try again.");
        return;
      }
      const data = (await res.json()) as MemeApiResponse;
      if (!data.url) {
        await interaction.editReply("Got an empty response from the meme service.");
        return;
      }
      if (data.nsfw || data.spoiler) {
        // Fetch one more time, otherwise bail
        const retry = await fetch("https://meme-api.com/gimme");
        const retryData = (await retry.json()) as MemeApiResponse;
        if (retryData.nsfw || retryData.spoiler || !retryData.url) {
          await interaction.editReply("Couldn't find a clean meme right now. Try again.");
          return;
        }
        Object.assign(data, retryData);
      }

      const embed = new EmbedBuilder()
        .setTitle(data.title ?? "Meme")
        .setURL(data.postLink ?? null)
        .setImage(data.url ?? null)
        .setColor(0xff4500)
        .setFooter({
          text: `r/${data.subreddit ?? "?"} • by u/${data.author ?? "?"} • ${CE.upvote.str} ${data.ups ?? 0}`,
        });

      await interaction.editReply({ embeds: [embed] });
    } catch {
      await interaction.editReply("Couldn't reach the meme service. Try again.");
    } finally {
      clearTimeout(timeout);
    }
  },
};

export default command;
