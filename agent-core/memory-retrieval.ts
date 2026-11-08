export interface SearchableMemory {
  id: string;
  category: string;
  title: string;
  content: string;
  updatedAt?: string;
}
export interface RetrievedMemory {
  id: string;
  category: string;
  title: string;
  excerpt: string;
  score: number;
}
const STOP_WORDS = new Set(["the","and","for","with","from","that","this","have","your","you","are","was","were","will","would","could","should","about","into","onto","then","than","what","when","where","which","who","how","why","does","did","can","may","might","not","but","all","any","our","their","them","they","its","it's","is","a","an","to","of","in","on","at","by","as","or","be","if","it","we","i","me","my"]);
function terms(value: string): string[] {
  return [...new Set(value.toLowerCase().match(/[a-z0-9]{2,}/g) || [])].filter(term => !STOP_WORDS.has(term));
}

/** Keyword retrieval for explicitly saved Founder notes; it does not learn or write memories. */
export function retrieveRelevantMemories(
  query: string,
  memories: readonly SearchableMemory[],
  options: { limit?: number; maxExcerptChars?: number } = {},
): RetrievedMemory[] {
  const queryTerms = terms(query);
  if (queryTerms.length === 0) return [];
  const limit = Math.max(1, Math.min(options.limit ?? 5, 10));
  const maxExcerptChars = Math.max(100, Math.min(options.maxExcerptChars ?? 1200, 3000));
  const queryPhrase = query.toLowerCase().trim();
  return memories.map(memory => {
    const titleTerms = new Set(terms(memory.title));
    const categoryTerms = new Set(terms(memory.category));
    const contentTerms = new Set(terms(memory.content));
    let score = 0;
    for (const term of queryTerms) {
      if (titleTerms.has(term)) score += 5;
      if (categoryTerms.has(term)) score += 2;
      if (contentTerms.has(term)) score += 1;
    }
    if (queryPhrase.length >= 4 && memory.title.toLowerCase().includes(queryPhrase)) score += 8;
    const excerpt = memory.content.length > maxExcerptChars
      ? memory.content.slice(0, maxExcerptChars) + "…"
      : memory.content;
    return { id: memory.id, category: memory.category, title: memory.title, excerpt, score };
  }).filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function formatMemoryContext(memories: readonly RetrievedMemory[]): string {
  if (memories.length === 0) return "No relevant saved Founder notes were retrieved.";
  return JSON.stringify(memories.map(({ id, category, title, excerpt }) => ({ id, category, title, excerpt })));
}
