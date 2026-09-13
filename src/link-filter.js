const DISCORD_INVITE_PATTERN = /(?:https?:\/\/)?(?:www\.)?(?:discord\.gg|discord(?:app)?\.com\/invite)\/[a-z0-9-]+/i;

export function containsDiscordInviteLink(content) {
  return DISCORD_INVITE_PATTERN.test(String(content || ''));
}
