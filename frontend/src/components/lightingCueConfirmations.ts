export const confirmClearSelectedLightingCues = (songTitle: string) =>
  window.confirm(`Clear the lighting cues for "${songTitle}"? This cannot be undone.`);

export const confirmClearAllLightingCues = (songTitles: string[], planTitle: string | null) => {
  const target = songTitles.length === 1
    ? `"${songTitles[0]}"`
    : `every song in "${planTitle ?? "the current service plan"}"`;
  return window.confirm(`Clear all lighting cues for ${target}? This cannot be undone.`);
};
