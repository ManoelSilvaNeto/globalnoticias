// Carrega os dados gerados pelo pipeline (JSON-on-Git) em tempo de build.

import type { Edition } from './types';
import currentJson from '../../data/current.json';

export const currentEdition = currentJson as unknown as Edition;

// Todas as edições arquivadas (data/edicoes/*.json), da mais nova p/ a mais antiga.
const editionModules = import.meta.glob<{ default: Edition }>('../../data/edicoes/*.json', { eager: true });

export const editions: Edition[] = Object.values(editionModules)
  .map((m) => m.default)
  .sort((a, b) => b.date.localeCompare(a.date));

export function editionByDate(date: string): Edition | undefined {
  return editions.find((e) => e.date === date);
}

export function hasContent(edition: Edition): boolean {
  return edition.home.length > 0;
}
