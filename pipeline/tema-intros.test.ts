import { describe, it, expect, vi } from 'vitest';
import {
  buildTemaPrompt,
  editionStories,
  generateTemaIntro,
  selectPending,
  validateTemaIntro,
} from './tema-intros';
import type { Edition, Story, TemaIntrosFile } from '../src/lib/types';
import type { Topic } from '../src/lib/topics-core';
import type { GroqSummarizer } from './summarize';

const NOW = new Date('2026-06-04T12:00:00.000Z');

function story(over: Partial<Story> = {}): Story {
  return {
    clusterId: 'cl',
    slug: 's1',
    titulo: 'Copa do Mundo confirma 48 seleções',
    resumo: 'A Copa do Mundo terá um formato ampliado com mais seleções na próxima edição.',
    porQueImporta: 'A mudança altera o calendário do futebol internacional.',
    category: 'esportes',
    sources: [{ name: 'G1', url: 'https://g1.globo.com/n/1' }],
    updatedAt: '2026-06-04T10:00:00.000Z',
    ...over,
  };
}

function topic(over: Partial<Topic> = {}): Topic {
  return {
    slug: 'copa-do-mundo',
    label: 'Copa do Mundo',
    stories: [story()],
    indexable: true,
    ...over,
  };
}

// Provedor falso: o gerador só usa .completeJson.
function provider(completeJson: (s: string, u: string, o: unknown) => Promise<unknown>) {
  return { completeJson: vi.fn(completeJson) } as unknown as GroqSummarizer;
}

const GOOD_INTRO =
  'A Copa do Mundo reúne as principais seleções de futebol em uma competição internacional. As notícias acompanham mudanças de formato e seus efeitos sobre o calendário do esporte.';

describe('validateTemaIntro', () => {
  it('aprova um parágrafo único, ancorado e no tamanho', () => {
    const v = validateTemaIntro({ intro: GOOD_INTRO }, topic(), 4);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.intro).toBe(GOOD_INTRO);
  });

  it('reprova intro curto/ausente', () => {
    expect(validateTemaIntro({ intro: 'curto' }, topic(), 4).ok).toBe(false);
    expect(validateTemaIntro({}, topic(), 4).ok).toBe(false);
  });

  it('reprova bullet/heading no início', () => {
    expect(validateTemaIntro({ intro: '- ' + GOOD_INTRO }, topic(), 4).ok).toBe(false);
    expect(validateTemaIntro({ intro: '# ' + GOOD_INTRO }, topic(), 4).ok).toBe(false);
  });

  it('achata quebras de linha em um parágrafo único', () => {
    const v = validateTemaIntro({ intro: GOOD_INTRO.replace('. ', '.\n') }, topic(), 4);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.intro).not.toContain('\n');
  });

  it('trunca intro acima do teto, sem reprovar', () => {
    const long = 'A Copa do Mundo é um torneio. '.repeat(40);
    const v = validateTemaIntro({ intro: long }, topic(), 4);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.intro.length).toBeLessThanOrEqual(601);
      expect(v.intro.endsWith('…')).toBe(true);
    }
  });

  it('reprova quando há entidades demais fora do material', () => {
    const intro =
      'A Copa do Mundo terá jogos em Genebra, Lisboa, Tóquio, Nairóbi e Helsinque conforme novas definições recentes.';
    const v = validateTemaIntro({ intro }, topic(), 4);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.unknownEntities.length).toBeGreaterThan(4);
  });

  it('normaliza espaços em branco', () => {
    const v = validateTemaIntro({ intro: `  ${GOOD_INTRO}  ` }, topic(), 4);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.intro).toBe(GOOD_INTRO);
  });
});

describe('buildTemaPrompt', () => {
  it('inclui o rótulo do tema e as notícias', () => {
    const p = buildTemaPrompt(topic());
    expect(p).toContain('"Copa do Mundo"');
    expect(p).toContain('48 seleções');
  });
  it('limita a 10 notícias no material', () => {
    const many = Array.from({ length: 15 }, (_, i) => story({ slug: `s${i}`, titulo: `Notícia ${i}` }));
    const p = buildTemaPrompt(topic({ stories: many }));
    expect(p).toContain('[10]');
    expect(p).not.toContain('[11]');
  });
});

describe('selectPending', () => {
  const cache = (intros: Record<string, unknown>): TemaIntrosFile =>
    ({ v: 1, updatedAt: '', intros } as unknown as TemaIntrosFile);

  it('só temas indexáveis sem intro em cache', () => {
    const ts = [
      topic({ slug: 'a', indexable: true }),
      topic({ slug: 'b', indexable: false }), // noindex: não gasta IA
      topic({ slug: 'c', indexable: true }),
    ];
    const pending = selectPending(ts, cache({ a: { intro: 'x' } }), false);
    expect(pending.map((t) => t.slug)).toEqual(['c']);
  });

  it('force regenera mesmo os já em cache (mas ainda só indexáveis)', () => {
    const ts = [topic({ slug: 'a', indexable: true }), topic({ slug: 'b', indexable: false })];
    const pending = selectPending(ts, cache({ a: { intro: 'x' } }), true);
    expect(pending.map((t) => t.slug)).toEqual(['a']);
  });
});

describe('editionStories', () => {
  it('junta home e categorias deduplicando por slug', () => {
    const a = story({ slug: 'a' });
    const b = story({ slug: 'b' });
    const edition = {
      date: '2026-06-04',
      generatedAt: NOW.toISOString(),
      home: [a, b],
      categorias: { esportes: [a], mundo: [b] },
    } as unknown as Edition;
    expect(editionStories(edition).map((s) => s.slug).sort()).toEqual(['a', 'b']);
  });
});

describe('generateTemaIntro', () => {
  it('devolve o intro quando a IA acerta', async () => {
    const p = provider(async () => ({ intro: GOOD_INTRO }));
    const res = await generateTemaIntro(topic(), [p], NOW, 4);
    expect(res?.slug).toBe('copa-do-mundo');
    expect(res?.intro).toBe(GOOD_INTRO);
    expect(res?.generatedAt).toBe(NOW.toISOString());
  });

  it('cai pro próximo provedor quando o primeiro dá 429', async () => {
    const quota = provider(async () => {
      throw { status: 429 };
    });
    const ok = provider(async () => ({ intro: GOOD_INTRO }));
    const diag: string[] = [];
    const res = await generateTemaIntro(topic(), [quota, ok], NOW, 4, diag);
    expect(res?.intro).toBe(GOOD_INTRO);
    expect(diag.some((d) => d.includes('sem cota'))).toBe(true);
  });

  it('devolve null e diagnostica quando a validação reprova', async () => {
    const p = provider(async () => ({ intro: 'curto' }));
    const diag: string[] = [];
    const res = await generateTemaIntro(topic(), [p], NOW, 4, diag);
    expect(res).toBeNull();
    expect(diag.some((d) => d.includes('reprovado'))).toBe(true);
  });
});
