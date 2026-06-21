import { createCanvas, loadImage, type SKRSContext2D } from "@napi-rs/canvas";

interface GradientPreset {
  name: string;
  from: string;
  to: string;
  accent: string;
  textColor: string;
}

export const BACKGROUND_PRESETS: GradientPreset[] = [
  { name: "Deep Space",    from: "#0d0221", to: "#180135", accent: "#7b2fff", textColor: "#ffffff" },
  { name: "Sunset",        from: "#b91c1c", to: "#f97316", accent: "#fbbf24", textColor: "#ffffff" },
  { name: "Ocean",         from: "#0c4a6e", to: "#0284c7", accent: "#38bdf8", textColor: "#ffffff" },
  { name: "Forest",        from: "#14532d", to: "#166534", accent: "#4ade80", textColor: "#ffffff" },
  { name: "Crimson Night", from: "#1c0000", to: "#450a0a", accent: "#ef4444", textColor: "#ffffff" },
  { name: "Sakura",        from: "#831843", to: "#9d174d", accent: "#f9a8d4", textColor: "#ffffff" },
  { name: "Galaxy",        from: "#1e1b4b", to: "#4c1d95", accent: "#c084fc", textColor: "#ffffff" },
  { name: "Emerald",       from: "#022c22", to: "#064e3b", accent: "#34d399", textColor: "#ffffff" },
  { name: "Golden",        from: "#431407", to: "#78350f", accent: "#fbbf24", textColor: "#ffffff" },
  { name: "Midnight Rose", from: "#1a0020", to: "#3b0764", accent: "#e879f9", textColor: "#ffffff" },
];

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function hexToRgb(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
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

  const bgSetting = opts.background ?? 0;

  // ─── Background ───────────────────────────────────────────────────────────
  if (typeof bgSetting === "string" && bgSetting.startsWith("http")) {
    try {
      const bgImg = await loadImage(bgSetting);
      ctx.drawImage(bgImg, 0, 0, W, H);
    } catch {
      drawGradient(ctx, W, H, BACKGROUND_PRESETS[0]);
    }
  } else {
    const idx = typeof bgSetting === "number" ? bgSetting : 0;
    const preset = BACKGROUND_PRESETS[Math.max(0, Math.min(9, idx))];
    drawGradient(ctx, W, H, preset);
  }

  // ─── Dark overlay for readability ────────────────────────────────────────
  ctx.fillStyle = "rgba(0,0,0,0.42)";
  ctx.fillRect(0, 0, W, H);

  // ─── Accent glow strip at bottom ─────────────────────────────────────────
  const preset = BACKGROUND_PRESETS[typeof bgSetting === "number" ? Math.max(0, Math.min(9, bgSetting)) : 0];
  const [ar, ag, ab] = hexToRgb(preset.accent);
  const glow = ctx.createLinearGradient(0, H - 6, 0, H);
  glow.addColorStop(0, `rgba(${ar},${ag},${ab},0.9)`);
  glow.addColorStop(1, `rgba(${ar},${ag},${ab},0.3)`);
  ctx.fillStyle = glow;
  ctx.fillRect(0, H - 6, W, 6);

  // ─── Avatar ───────────────────────────────────────────────────────────────
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

  // Avatar ring
  ctx.strokeStyle = preset.accent;
  ctx.lineWidth = 5;
  ctx.shadowColor = preset.accent;
  ctx.shadowBlur = 18;
  ctx.beginPath();
  ctx.arc(avatarX, avatarY, avatarR + 4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.shadowBlur = 0;

  // ─── WELCOME text ─────────────────────────────────────────────────────────
  const textX = W / 2;
  const welcomeY = avatarY + avatarR + 50;

  ctx.font = "bold 72px Sans";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  // Text glow
  ctx.shadowColor = preset.accent;
  ctx.shadowBlur = 20;
  const grad = ctx.createLinearGradient(textX - 200, 0, textX + 200, 0);
  grad.addColorStop(0, preset.textColor);
  grad.addColorStop(0.5, preset.accent);
  grad.addColorStop(1, preset.textColor);
  ctx.fillStyle = grad;
  ctx.fillText("WELCOME", textX, welcomeY);
  ctx.shadowBlur = 0;

  // ─── Username ─────────────────────────────────────────────────────────────
  ctx.font = "bold 36px Sans";
  ctx.fillStyle = "#e2e8f0";
  ctx.shadowColor = "rgba(0,0,0,0.8)";
  ctx.shadowBlur = 8;
  const displayName = opts.username.length > 28 ? opts.username.slice(0, 25) + "…" : opts.username;
  ctx.fillText(displayName, textX, welcomeY + 48);
  ctx.shadowBlur = 0;

  // ─── Member count pill ────────────────────────────────────────────────────
  const countText = `Member #${ordinal(opts.memberCount)}`;
  ctx.font = "18px Sans";
  const pillW = ctx.measureText(countText).width + 32;
  const pillH = 32;
  const pillX = textX - pillW / 2;
  const pillY = welcomeY + 64;

  ctx.fillStyle = `rgba(${ar},${ag},${ab},0.3)`;
  drawRoundedRect(ctx, pillX, pillY, pillW, pillH, 16);
  ctx.fill();
  ctx.strokeStyle = `rgba(${ar},${ag},${ab},0.7)`;
  ctx.lineWidth = 1.5;
  drawRoundedRect(ctx, pillX, pillY, pillW, pillH, 16);
  ctx.stroke();

  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(countText, textX, pillY + pillH / 2);

  return canvas.encode("png");
}

function drawGradient(ctx: SKRSContext2D, W: number, H: number, preset: GradientPreset) {
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, preset.from);
  grad.addColorStop(1, preset.to);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Decorative circles
  const [ar, ag, ab] = hexToRgb(preset.accent);
  ctx.fillStyle = `rgba(${ar},${ag},${ab},0.08)`;
  ctx.beginPath();
  ctx.arc(W * 0.15, H * 0.3, 140, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(W * 0.85, H * 0.7, 100, 0, Math.PI * 2);
  ctx.fill();
}
