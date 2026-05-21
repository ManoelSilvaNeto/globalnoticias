import type { Story } from './types';

// Identificador estável da história para a URL /noticia/<slug>. Edições antigas,
// arquivadas antes do campo slug existir, caem no clusterId (ainda navegável).
export const storySlug = (s: Story): string => s.slug ?? s.clusterId;
