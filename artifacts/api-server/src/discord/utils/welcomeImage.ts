import { createCanvas, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ASSETS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "assets",
  "welcomer",
);

export const BACKGROUND_IMAGE_FILES: string[] = [
  "bg0.jpeg",
  "bg1.jpeg",
  "bg2.jpeg",
  "bg3.jpeg",
  "bg4.jpeg",
  "bg5.jpeg",
  "bg6.jpeg",
  "bg7.jpeg",
  "bg8.jpeg",
  "bg9.jpeg",
];

export const BACKGROUND_IMAGE_COUNT = BACKGROUND_IMAGE_FILES.length;

const ACCENT_COLOR = "#ffffff";

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function drawRoundedRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

export async function generateWelcomeImage(opts: {
  avatarUrl: string;
  username: string;
  memberCount: number;
  serverName: string;
  background?: number | string;
}): Promise<Buffer> {
  const W = 1024;
  const H = 400;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  const randomIdx = Math.floor(Math.random() * BACKGROUND_IMAGE_COUNT);
  const bgFile = path.join(ASSETS_DIR, BACKGROUND_IMAGE_FILES[randomIdx]);

  try {
    const bgImg = await loadImage(bgFile);
    ctx.drawImage(bgImg, 0, 0, W, H);
  } catch {
    ctx.fillStyle = "#0d0221";
    ctx.fillRect(0, 0, W, H);
  }

  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(0, 0, W, H);

  const avatarR = 90;
  const avatarX = W / 2;
  const avatarY = H / 2 - 40;

  try {
    const avatarImg = await loadImage(opts.avatarUrl + "?size=256");
    ctx.save();
    ctx.beginPath();
    ctx.arc(avatarX, avatarY, avatarR, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(avatarImg, avatarX - avatarR, avatarY - avatarR, avatarR * 2, avatarR * 2);
    ctx.restore();
  } catch {
    ctx.fillStyle = "#555";
    ctx.beginPath();
    ctx.arc(avatarX, avatarY, avatarR, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.strokeStyle = ACCENT_COLOR;
  ctx.lineWidth = 5;
  ctx.shadowColor = ACCENT_COLOR;
  ctx.shadowBlur = 18;
  ctx.beginPath();
  ctx.arc(avatarX, avatarY, avatarR + 4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.shadowBlur = 0;

  const textX = W / 2;
  const welcomeY = avatarY + avatarR + 50;

  ctx.font = "bold 72px Sans";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  ctx.shadowColor = "rgba(255,255,255,0.6)";
  ctx.shadowBlur = 20;
  ctx.fillStyle = "#ffffff";
  ctx.fillText("WELCOME", textX, welcomeY);
  ctx.shadowBlur = 0;

  ctx.font = "bold 36px Sans";
  ctx.fillStyle = "#e2e8f0";
  ctx.shadowColor = "rgba(0,0,0,0.8)";
  ctx.shadowBlur = 8;
  const displayName = opts.username.length > 28 ? opts.username.slice(0, 25) + "…" : opts.username;
  ctx.fillText(displayName, textX, welcomeY + 48);
  ctx.shadowBlur = 0;

  const countText = `Member #${ordinal(opts.memberCount)}`;
  ctx.font = "18px Sans";
  const pillW = ctx.measureText(countText).width + 32;
  const pillH = 32;
  const pillX = textX - pillW / 2;
  const pillY = welcomeY + 64;

  ctx.fillStyle = "rgba(255,255,255,0.2)";
  drawRoundedRect(ctx, pillX, pillY, pillW, pillH, 16);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.7)";
  ctx.lineWidth = 1.5;
  drawRoundedRect(ctx, pillX, pillY, pillW, pillH, 16);
  ctx.stroke();

  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(countText, textX, pillY + pillH / 2);

  return canvas.encode("png");
}
