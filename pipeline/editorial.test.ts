import { describe, it, expect, vi } from 'vitest';
import {
  buildEditorialPrompt,
  categoriaDistribution,
  composeDestaques,
  decideGenerate,
  editorialUnknownEntities,
  editorialCorpus,
  generateEditorial,
  validateEditorial,
} from './editorial';
import type { Edition, Story } from '../src/lib/types';
import type { GroqSummarizer } from './summarize';

const NOW = new Date('2026-06-04T12:00:00.000Z');

function story(over: Partial<Story> = {}): Story {
  return {
    clusterId: 'cl',
    slug: 's1',
    titulo: 'Lula apresenta pacote contra a inflação',
    resumo: 'O governo anunciou medidas econômicas para conter a alta dos preços de alimentos.',
    porQueImporta: 'A inflação de alimentos pressiona o orçamento das famílias.',
    category: 'economia',
    sources: [{ name: 'G1', url: 'https://g1.globo.com/n/1' }],
    updatedAt: '2026-06-04T10:00:00.000Z',
    ...over,
  };
}

function edition(home: Story[]): Edition {
  return {
    date: '2026-06-04',
    generatedAt: NOW.toISOString(),
    home,
    // categorias parcial (o código acessa com ?. e ?? 0) — cast p/ o teste.
    categorias: { economia: home, politica: home.slice(0, 1) } as unknown as Edition['categorias'],
  };
}

// Provedor falso: o gerador só usa .completeJson.
function provider(completeJson: (s: string, u: string, o: unknown) => Promise<unknown>) {
  return { completeJson: vi.fn(completeJson) } as unknown as GroqSummarizer;
}

const GOOD_RAW = {
  titulo: 'Economia e política dominam o noticiário do dia',
  linhaFina: 'Medidas econômicas e movimentações no Congresso concentraram a atenção da edição.',
  paragrafos: [
    'No campo econômico, o governo apresentou um pacote voltado a conter a alta dos preços, em meio à pressão da inflação de alimentos sobre o orçamento das famílias.',
    'No Congresso, as articulações em torno da pauta econômica reforçaram o tom de negociação entre os Poderes ao longo do dia.',
  ],
};

describe('decideGenerate', () => {
  it('força ignora janela e dedup', () => {
    expect(decideGenerate({ exists: true, hourUtc: 0, genHour: 11, force: true }).generate).toBe(true);
  });
  it('não gera se já existe o editorial do dia', () => {
    expect(decideGenerate({ exists: true, hourUtc: 15, genHour: 11, force: false }).generate).toBe(false);
  });
  it('não gera fora da janela horária', () => {
    expect(decideGenerate({ exists: false, hourUtc: 8, genHour: 11, force: false }).generate).toBe(false);
  });
  it('gera na janela quando ainda não há editorial', () => {
    expect(decideGenerate({ exists: false, hourUtc: 12, genHour: 11, force: false }).generate).toBe(true);
  });
});

describe('editorialUnknownEntities', () => {
  it('ignora entidades presentes no material e termos comuns', () => {
    const corpus = editorialCorpus([story()]);
    const unknown = editorialUnknownEntities(
      'Panorama do dia',
      ['O Governo discutiu com o Congresso o pacote de Lula em Brasília nesta terça.'],
      corpus,
    );
    expect(unknown).toEqual([]); // governo/congresso/brasilia comuns; lula no corpus
  });

  it('aponta entidade própria fora do material', () => {
    const corpus = editorialCorpus([story()]);
    const unknown = editorialUnknownEntities(
      'Panorama do dia',
      ['As negociações em Genebra avançaram durante a tarde.'],
      corpus,
    );
    expect(unknown).toContain('genebra');
  });
});

describe('validateEditorial', () => {
  it('aprova um output completo e ancorado', () => {
    const v = validateEditorial(GOOD_RAW, [story()], 6);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.paragrafos).toHaveLength(2);
  });

  it('reprova título curto', () => {
    const v = validateEditorial({ ...GOOD_RAW, titulo: 'Curto' }, [story()], 6);
    expect(v.ok).toBe(false);
  });

  it('reprova quando sobram poucos parágrafos (descarta os curtos)', () => {
    const v = validateEditorial({ ...GOOD_RAW, paragrafos: ['curto', 'tb curto'] }, [story()], 6);
    expect(v.ok).toBe(false);
  });

  it('TOLERA poucas entidades fora do material (abaixo do teto)', () => {
    const raw = {
      ...GOOD_RAW,
      paragrafos: [...GOOD_RAW.paragrafos, 'As conversas em Genebra e Paris seguiram durante o dia, segundo o material.'],
    };
    const v = validateEditorial(raw, [story()], 6);
    expect(v.ok).toBe(true); // genebra + paris = 2 ≤ 6
  });

  it('reprova quando há MUITAS entidades fora do material (egrégio)', () => {
    const raw = {
      ...GOOD_RAW,
      paragrafos: [
        ...GOOD_RAW.paragrafos,
        'O encontro reuniu Zarvon, Klepio, Brunor, Talnex, Vornika, Quespar e Drelmon na capital.',
      ],
    };
    const v = validateEditorial(raw, [story()], 6);
    expect(v.ok).toBe(false); // 7 entidades inventadas > 6
  });
});

describe('composeDestaques', () => {
  it('limita e mapeia para refs com slug/categoria-legível', () => {
    const stories = [story({ slug: 'a', category: 'economia' }), story({ slug: 'b', category: 'geral' })];
    const refs = composeDestaques(stories, 2);
    expect(refs).toHaveLength(2);
    expect(refs[0]).toMatchObject({ slug: 'a', categoria: 'Economia' });
    expect(refs[1]!.categoria).toBe('Geral');
  });
});

describe('buildEditorialPrompt / categoriaDistribution', () => {
  it('inclui a distribuição de categorias e as histórias', () => {
    const ed = edition([story()]);
    expect(categoriaDistribution(ed)).toContain('Economia (1)');
    const prompt = buildEditorialPrompt(ed.home, ed);
    expect(prompt).toContain('Distribuição por categoria');
    expect(prompt).toContain('inflação');
  });
});

describe('generateEditorial', () => {
  it('gera a peça com o provedor', async () => {
    const ed = edition([story()]);
    const p = provider(async () => GOOD_RAW);
    const out = await generateEditorial(ed, [p], NOW, 12, 6, 6);
    expect(out).not.toBeNull();
    expect(out!.titulo).toBe(GOOD_RAW.titulo);
    expect(out!.date).toBe('2026-06-04');
    expect(out!.destaques.length).toBeGreaterThan(0);
  });

  it('retorna null quando a IA dá 429', async () => {
    const ed = edition([story()]);
    const p = provider(async () => {
      throw Object.assign(new Error('429'), { status: 429 });
    });
    const out = await generateEditorial(ed, [p], NOW, 12, 6, 6);
    expect(out).toBeNull();
  });

  it('retorna null quando a validação reprova', async () => {
    const ed = edition([story()]);
    const p = provider(async () => ({ titulo: 'x', linhaFina: 'y', paragrafos: [] }));
    const out = await generateEditorial(ed, [p], NOW, 12, 6, 6);
    expect(out).toBeNull();
  });
});
