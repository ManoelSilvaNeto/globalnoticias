import { describe, it, expect } from 'vitest';
import { hashtagsFor, tagFacets, clip } from './social';

type Story = Parameters<typeof hashtagsFor>[0];
const story = (over: Partial<Story> = {}): Story => ({
  clusterId: 'c1',
  titulo: 'T',
  resumo: 'R',
  ...over,
});

describe('hashtagsFor', () => {
  it('inclui sempre noticias e brasil', () => {
    expect(hashtagsFor(story())).toContain('noticias');
    expect(hashtagsFor(story())).toContain('brasil');
  });

  it('adiciona a categoria quando ela é conhecida', () => {
    expect(hashtagsFor(story({ category: 'politica' }))).toContain('politica');
    expect(hashtagsFor(story({ category: 'esportes' }))).toContain('esportes');
  });

  it('ignora categoria desconhecida (geral, vazia, inválida)', () => {
    expect(hashtagsFor(story({ category: 'geral' }))).toEqual(['noticias', 'brasil']);
    expect(hashtagsFor(story({ category: undefined }))).toEqual(['noticias', 'brasil']);
    expect(hashtagsFor(story({ category: 'inexistente' }))).toEqual(['noticias', 'brasil']);
  });

  it('não duplica tag quando categoria coincide com tag padrão', () => {
    // Defensivo: hashtagsFor já tem brasil; categoria custom não-listada não entra.
    const tags = hashtagsFor(story({ category: 'tecnologia' }));
    expect(tags.filter((t) => t === 'tecnologia')).toHaveLength(1);
  });
});

describe('tagFacets', () => {
  it('gera facet por tag com offset em bytes UTF-8', () => {
    const text = 'Manchete bem boa\n\n#noticias #brasil';
    const facets = tagFacets(text, ['noticias', 'brasil']);
    expect(facets).toHaveLength(2);
    const first = facets[0] as { index: { byteStart: number; byteEnd: number }; features: Array<{ tag: string }> };
    expect(first.features[0]!.tag).toBe('noticias');
    // "Manchete bem boa\n\n" = 18 chars ASCII = 18 bytes.
    expect(first.index.byteStart).toBe(18);
    expect(first.index.byteEnd).toBe(18 + '#noticias'.length); // 18 + 9 = 27
  });

  it('calcula offset em BYTES, não em chars, quando há emoji/acento antes', () => {
    // "📰" = 4 bytes em UTF-8 (mas 2 chars JS por causa do surrogate pair).
    // "ç" = 2 bytes. Garantia: offset != string.indexOf.
    const text = '📰 ação #brasil';
    const facets = tagFacets(text, ['brasil']) as Array<{ index: { byteStart: number; byteEnd: number } }>;
    const enc = new TextEncoder();
    // byteStart deve bater com o length do TextEncoder até o "#".
    const expected = enc.encode(text.slice(0, text.indexOf('#brasil'))).length;
    expect(facets[0]!.index.byteStart).toBe(expected);
    // E NÃO deve ser igual ao indexOf em chars (que é menor).
    expect(facets[0]!.index.byteStart).toBeGreaterThan(text.indexOf('#brasil'));
  });

  it('pula tag que não aparece no texto', () => {
    const facets = tagFacets('texto sem hash', ['noticias']);
    expect(facets).toHaveLength(0);
  });

  it('avança o cursor para não recasar a mesma posição', () => {
    // Duas ocorrências da mesma tag — deve casar uma vez por chamada (1 tag → 1 facet).
    const text = '#brasil e mais #brasil';
    const facets = tagFacets(text, ['brasil']);
    expect(facets).toHaveLength(1);
  });
});

describe('clip', () => {
  it('mantém string que cabe no limite', () => {
    expect(clip('curto', 10)).toBe('curto');
    expect(clip('exato', 5)).toBe('exato');
  });

  it('corta com reticência quando ultrapassa', () => {
    expect(clip('umtextolongo', 8)).toBe('umtexto…');
    expect(clip('abcdefghij', 5)).toBe('abcd…');
  });

  it('reticência conta no limite (saída tem exatamente n chars)', () => {
    const out = clip('abcdefghijklmno', 10);
    expect(out).toHaveLength(10);
    expect(out.endsWith('…')).toBe(true);
  });
});
