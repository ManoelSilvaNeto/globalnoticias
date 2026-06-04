// Carrega os intros originais das páginas-tema (data/tema-intros.json) gerados pelo
// pipeline. Mesma estratégia JSON-on-Git do editorial. Se o arquivo ainda não tiver
// intros, o lookup devolve undefined e a página-tema renderiza sem o parágrafo.

import type { TemaIntrosFile } from './types';
import introsFile from '../../data/tema-intros.json';

const data = introsFile as unknown as TemaIntrosFile;

export function temaIntro(slug: string): string | undefined {
  return data.intros?.[slug]?.intro;
}
