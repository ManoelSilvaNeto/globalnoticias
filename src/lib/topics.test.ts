import { describe, it, expect } from 'vitest';
import { slugifyTopic, candidatesFrom, isValidTopic, buildTopics, MIN_STORIES, INDEX_MIN } from './topics';
import type { Story } from './types';

function story(titulo: string, clusterId: string, updatedAt = '2026-05-20T12:00:00.000Z'): Story {
  return {
    clusterId,
    slug: clusterId,
    titulo,
    resumo: 'r',
    porQueImporta: 'p',
    category: 'politica',
    sources: [{ name: 'G1', url: `https://x.com/${clusterId}` }],
    updatedAt,
  };
}

describe('slugifyTopic', () => {
  it('remove acentos, espaços e símbolos', () => {
    expect(slugifyTopic('Copa do Mundo')).toBe('copa-do-mundo');
    expect(slugifyTopic('São Paulo')).toBe('sao-paulo');
    expect(slugifyTopic('Lula 2026!')).toBe('lula-2026');
    expect(slugifyTopic('Athletico-PR')).toBe('athletico-pr');
  });

  it('retorna string vazia pra entrada só com símbolos', () => {
    expect(slugifyTopic('!!! ???')).toBe('');
  });
});

describe('candidatesFrom', () => {
  it('extrai runs de capitalizadas, permitindo conectores em minúsculas', () => {
    expect(candidatesFrom('Supremo Tribunal Federal mantém prisão')).toContain('Supremo Tribunal Federal');
    expect(candidatesFrom('Brasil avança à final da Copa do Mundo')).toContain('Copa do Mundo');
  });

  it('separa runs quando há palavra comum no meio (e une com conector ligando 2 properas)', () => {
    // "Lula" sai sozinho; "recebe" quebra o run; "Trump em Brasília" gruda
    // porque "em" é conector e está entre duas capitalizadas.
    const cands = candidatesFrom('Lula recebe Trump em Brasília');
    expect(cands).toContain('Lula');
    expect(cands).toContain('Trump em Brasília');
  });

  it('descarta conector pendurado no final do run', () => {
    // "Tribunal de" — o "de" final deve ser cortado.
    const cands = candidatesFrom('Tribunal de decide pela prisão');
    expect(cands).toContain('Tribunal');
    expect(cands).not.toContain('Tribunal de');
  });

  it('ignora pontuação grudada na palavra', () => {
    const cands = candidatesFrom('"Lula" assina decreto.');
    expect(cands).toContain('Lula');
  });
});

describe('isValidTopic', () => {
  it('aceita expressões multi-palavra distintivas', () => {
    expect(isValidTopic('Copa do Mundo')).toBe(true);
    expect(isValidTopic('Supremo Tribunal Federal')).toBe(true);
  });

  it('rejeita termos genéricos (GENERIC)', () => {
    expect(isValidTopic('Brasil')).toBe(false);
    expect(isValidTopic('Governo')).toBe(false);
    expect(isValidTopic('Senado')).toBe(false);
    expect(isValidTopic('Janeiro')).toBe(false); // mês
    expect(isValidTopic('Segunda')).toBe(false); // dia da semana
  });

  it('rejeita uma palavra com menos de 4 chars', () => {
    expect(isValidTopic('PT')).toBe(false);
    expect(isValidTopic('Rio')).toBe(false);
  });

  it('aceita uma palavra distintiva com 4+ chars', () => {
    expect(isValidTopic('Petrobras')).toBe(true);
    expect(isValidTopic('Embraer')).toBe(true);
  });

  it('rejeita expressão só com conectores/vazia', () => {
    expect(isValidTopic('')).toBe(false);
    expect(isValidTopic('de da do')).toBe(false);
  });
});

describe('buildTopics', () => {
  it('filtra por MIN_STORIES (precisa de pelo menos N histórias distintas)', () => {
    // 2 histórias falam de "Copa do Mundo" — abaixo de MIN_STORIES (3) → não vira tema.
    const stories = [
      story('Brasil joga na Copa do Mundo amanhã', 'c1'),
      story('Treino da seleção para a Copa do Mundo', 'c2'),
    ];
    const topics = buildTopics(stories);
    expect(topics.find((t) => t.slug === 'copa-do-mundo')).toBeUndefined();
  });

  it('inclui tema com >= MIN_STORIES histórias', () => {
    // "Brasil joga amanhã na Copa do Mundo" produz candidates ['Brasil', 'Copa do Mundo'];
    // 'Brasil' é GENERIC e fica de fora — sobra slug 'copa-do-mundo'.
    const stories = Array.from({ length: MIN_STORIES }, (_, i) => story(`Brasil joga amanhã na Copa do Mundo, partida ${i}`, `c${i}`));
    const topics = buildTopics(stories);
    expect(topics.find((t) => t.slug === 'copa-do-mundo')).toBeDefined();
  });

  it('marca indexable=true só quando >= INDEX_MIN histórias', () => {
    const just = Array.from({ length: INDEX_MIN - 1 }, (_, i) => story(`Petrobras anuncia algo ${i}`, `a${i}`));
    const enough = Array.from({ length: INDEX_MIN }, (_, i) => story(`Petrobras anuncia algo ${i}`, `b${i}`));
    expect(buildTopics(just).find((t) => t.slug === 'petrobras')?.indexable).toBe(false);
    expect(buildTopics(enough).find((t) => t.slug === 'petrobras')?.indexable).toBe(true);
  });

  it('uma história nunca conta mais de uma vez no mesmo tema (dedup por slug-no-título)', () => {
    // Mesmo se a entidade aparece duas vezes no título, conta uma vez só.
    const stories = [
      story('Petrobras anuncia, Petrobras confirma', 'a'),
      story('Petrobras revela balanço trimestral', 'b'),
      story('Petrobras lança nova plataforma', 'c'),
    ];
    const topics = buildTopics(stories);
    const t = topics.find((x) => x.slug === 'petrobras');
    expect(t).toBeDefined();
    expect(t!.stories).toHaveLength(3); // 3 stories, não 4 (o título com "Petrobras" 2× não duplica)
  });
});
