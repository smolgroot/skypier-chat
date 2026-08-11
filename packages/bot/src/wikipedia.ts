export const WIKIPEDIA_RANDOM_URL = 'https://en.wikipedia.org/wiki/Special:Random';

export function buildRandomWikipediaMessage(prefix = 'Random Wikipedia article'): string {
  return `${prefix}: ${WIKIPEDIA_RANDOM_URL}`;
}
