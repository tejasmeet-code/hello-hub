import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  type ChatInputCommandInteraction,
  type Message,
} from "discord.js";
import type { SlashCommand } from "../types";

type Cell = "X" | "O" | null;

const LINES: [number, number, number][] = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

function winner(board: Cell[]): "X" | "O" | "draw" | null {
  for (const [a, b, c] of LINES) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return board[a];
    }
  }
  return board.every((c) => c !== null) ? "draw" : null;
}

function rows(board: Cell[], finished: boolean): ActionRowBuilder<ButtonBuilder>[] {
  return [0, 3, 6].map((start) =>
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      [0, 1, 2].map((offset) => {
        const idx = start + offset;
        const cell = board[idx];
        return new ButtonBuilder()
          .setCustomId(`ttt:${idx}`)
          .setLabel(cell ?? "·")
          .setStyle(
            cell === "X"
              ? ButtonStyle.Danger
              : cell === "O"
                ? ButtonStyle.Primary
                : ButtonStyle.Secondary,
          )
          .setDisabled(finished || cell !== null);
      }),
    ),
  );
}

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("tictactoe")
    .setDescription("Play Tic-Tac-Toe against another user.")
    .addUserOption((o) =>
      o
        .setName("opponent")
        .setDescription("The user you want to play against")
        .setRequired(true),
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    const opponent = interaction.options.getUser("opponent", true);
    if (opponent.bot) {
      await interaction.reply({ content: "You can't play against a bot.", ephemeral: true });
      return;
    }
    if (opponent.id === interaction.user.id) {
      await interaction.reply({ content: "You can't play against yourself.", ephemeral: true });
      return;
    }

    const board: Cell[] = Array(9).fill(null);
    const players: Record<"X" | "O", string> = {
      X: interaction.user.id,
      O: opponent.id,
    };
    let turn: "X" | "O" = "X";

    function header(): string {
      const w = winner(board);
      if (w === "draw") return "🤝 It's a draw!";
      if (w) return `🏆 <@${players[w]}> (${w}) wins!`;
      return `Turn: <@${players[turn]}> (${turn})`;
    }

    const reply = await interaction.reply({
      content: `❌ <@${players.X}> vs ⭕ <@${players.O}>\n${header()}`,
      components: rows(board, false),
      withResponse: true,
    });

    const message = reply.resource?.message as Message | undefined;
    if (!message) return;

    const collector = message.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 5 * 60_000,
    });

    collector.on("collect", async (i) => {
      if (i.user.id !== players[turn]) {
        await i.reply({ content: "Not your turn.", ephemeral: true });
        return;
      }
      const idx = Number(i.customId.split(":")[1]);
      if (board[idx] !== null) {
        await i.reply({ content: "That square is taken.", ephemeral: true });
        return;
      }
      board[idx] = turn;
      const w = winner(board);
      if (!w) turn = turn === "X" ? "O" : "X";
      const finished = w !== null;
      await i.update({
        content: `❌ <@${players.X}> vs ⭕ <@${players.O}>\n${header()}`,
        components: rows(board, finished),
      });
      if (finished) collector.stop("done");
    });

    collector.on("end", async (_, reason) => {
      if (reason === "done") return;
      await message
        .edit({
          content: "⌛ Game expired.",
          components: rows(board, true),
        })
        .catch(() => {});
    });
  },
};

export default command;
