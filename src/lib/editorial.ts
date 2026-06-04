// Carrega as peças editoriais ("Panorama do dia") geradas pelo pipeline
// (data/editorial/*.json) em tempo de build. Mesma estratégia JSON-on-Git das
// edições. Se ainda não houver nenhuma, o glob retorna vazio (build segue normal).

import type { Editorial } from './types';

const editorialModules = import.meta.glob<{ default: Editorial }>('../../data/editorial/*.json', { eager: true });

// Todas as peças, da mais nova p/ a mais antiga.
export const editorials: Editorial[] = Object.values(editorialModules)
  .map((m) => m.default)
  .sort((a, b) => b.date.localeCompare(a.date));

export const latestEditorial: Editorial | undefined = editorials[0];

export function editorialByDate(date: string): Editorial | undefined {
  return editorials.find((e) => e.date === date);
}
