export const VENUE_PALETTE = ["#2f7d5b", "#2f6fb5", "#b5562f", "#8a4fb8", "#b58a1d", "#c0477a", "#3a8f99", "#6b7a2f"];

export function venueColor(venue: { id: string; color?: string | null }, all: { id: string }[]): string {
  if (venue.color && /^#[0-9a-fA-F]{6}$/.test(venue.color)) return venue.color;
  const index = Math.max(0, all.findIndex((v) => v.id === venue.id));
  return VENUE_PALETTE[index % VENUE_PALETTE.length];
}
