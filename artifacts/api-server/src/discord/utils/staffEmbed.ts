import { EmbedBuilder, type User } from "discord.js";

export interface StaffEmbedOpts {
  title: string;
  description?: string;
  color?: number;
  target: User;
  fields?: { name: string; value: string; inline?: boolean }[];
  footer?: string;
}

export function buildStaffEmbed(opts: StaffEmbedOpts): EmbedBuilder {
  const e = new EmbedBuilder()
    .setAuthor({
      name: opts.target.tag,
      iconURL: opts.target.displayAvatarURL({ size: 128 }),
    })
    .setTitle(opts.title)
    .setColor(opts.color ?? 0x5865f2)
    .setThumbnail(opts.target.displayAvatarURL({ size: 256 }))
    .setTimestamp(new Date());
  if (opts.description) e.setDescription(opts.description);
  if (opts.fields && opts.fields.length > 0) e.addFields(opts.fields);
  if (opts.footer) e.setFooter({ text: opts.footer });
  return e;
}
