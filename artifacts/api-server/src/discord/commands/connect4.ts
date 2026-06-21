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
import { CE } from "../utils/embedStyle";

type Cell = "R" | "Y" | null;

const COLS = 7;
const ROWS = 6;

function emptyBoard(): Cell[][] {
  return Array.from({ length: ROWS }, () => Array<Cell>(COLS).fill(null));
}

function dropPiece(board: Cell[][], col: number, piece: "R" | "Y"): number {
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r][col] === null) {
      board[r][col] = piece;
      return r;
    }
  }
  return -1;
}

function checkWin(board: Cell[][], piece: "R" | "Y"): boolean {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (board[r][c] !== piece) continue;
      // horizontal
      if (c + 3 < COLS && [1, 2, 3].every((k) => board[r][c + k] === piece)) return true;
      // vertical
      if (r + 3 < ROWS && [1, 2, 3].every((k) => board[r + k][c] === piece)) return true;
      // diag down-right
      if (
        r + 3 < ROWS &&
        c + 3 < COLS &&
        [1, 2, 3].every((k) => board[r + k][c + k] === piece)
      )
        return true;
      // diag down-left
      if (
        r + 3 < ROWS &&
        c - 3 >= 0 &&
        [1, 2, 3].every((k) => board[r + k][c - k] === piece)
      )
        return true;
    }
  }
  return false;
}

function isFull(board: Cell[][]): boolean {
  return board[0].every((c) => c !== null);
}

function render(board: Cell[][]): string {
  const rows = board.map((row) =>
    row
      .map((c) => (c === "R" ? CE.c4_red.str : c === "Y" ? CE.c4_yellow.str : CE.c4_empty.str))
      .join(""),
  );
  rows.push("1️⃣2️⃣3️⃣4️⃣5️⃣6️⃣7️⃣");
  return rows.join("\n");
}

function buttonRows(board: Cell[][], finished: boolean): ActionRowBuilder<ButtonBuilder>[] {
  const labels = ["1", "2", "3", "4", "5", "6", "7"];
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      labels.slice(0, 4).map((label, i) =>
        new ButtonBuilder()
          .setCustomId(`c4:${i}`)
          .setLabel(label)
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(finished || board[0][i] !== null),
      ),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      labels.slice(4).map((label, i) =>
        new ButtonBuilder()
          .setCustomId(`c4:${i + 4}`)
          .setLabel(label)
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(finished || board[0][i + 4] !== null),
      ),
    ),
  ];
}

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("connect4")
    .setDescription("Play Connect 4 against another user.")
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

    const board = emptyBoard();
    const players: Record<"R" | "Y", string> = {
      R: interaction.user.id,
      Y: opponent.id,
    };
    let turn: "R" | "Y" = "R";

    function header(): string {
      return `${CE.c4_red.str} <@${players.R}> vs ${CE.c4_yellow.str} <@${players.Y}>\nTurn: <@${players[turn]}> ${turn === "R" ? CE.c4_red.str : CE.c4_yellow.str}`;
    }

    const reply = await interaction.reply({
      content: `${header()}\n\n${render(board)}`,
      components: buttonRows(board, false),
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
      const col = Number(i.customId.split(":")[1]);
      const placed = dropPiece(board, col, turn);
      if (placed === -1) {
        await i.reply({ content: "That column is full.", ephemeral: true });
        return;
      }
      const won = checkWin(board, turn);
      const draw = !won && isFull(board);
      let body: string;
      if (won) {
        body = `${CE.trophy.str} <@${players[turn]}> wins!\n\n${render(board)}`;
      } else if (draw) {
        body = `${CE.draw.str} Draw.\n\n${render(board)}`;
      } else {
        turn = turn === "R" ? "Y" : "R";
        body = `${header()}\n\n${render(board)}`;
      }
      await i.update({
        content: body,
        components: buttonRows(board, won || draw),
      });
      if (won || draw) collector.stop("done");
    });

    collector.on("end", async (_, reason) => {
      if (reason === "done") return;
      await message
        .edit({
          content: `⌛ Game expired.\n\n${render(board)}`,
          components: buttonRows(board, true),
        })
        .catch(() => {});
    });
  },
};

export default command;
