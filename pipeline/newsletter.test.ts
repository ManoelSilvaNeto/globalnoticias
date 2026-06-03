import { describe, it, expect } from 'vitest';
import { composeEmail, decideSend, formatDateLabel, type Edition, type NewsletterState } from './newsletter';

const edition: Edition = {
  date: '2026-06-03',
  home: [
    { clusterId: 'c1', slug: 's1', titulo: 'Banco Central mantém Selic', resumo: 'Resumo da Selic.', porQueImporta: 'Afeta crédito e investimentos.', category: 'economia' },
    { clusterId: 'c2', titulo: 'Manchete geral do dia', resumo: 'Resumo geral.', category: 'geral' },
  ],
};
const emptyState: NewsletterState = { updatedAt: '', lastSentDate: '', sent: [] };

describe('formatDateLabel', () => {
  it('formata data ISO em pt-BR', () => {
    expect(formatDateLabel('2026-06-03')).toBe('3 de junho de 2026');
    expect(formatDateLabel('2026-01-09')).toBe('9 de janeiro de 2026');
  });
  it('devolve a entrada quando não é data ISO', () => {
    expect(formatDateLabel('xpto')).toBe('xpto');
  });
});

describe('composeEmail', () => {
  it('monta assunto com nome do site + data', () => {
    const email = composeEmail(edition, 8)!;
    expect(email.subject).toBe('GlobalNotícias · 3 de junho de 2026');
  });
  it('inclui título, URL canônica, porQueImporta e o rótulo da categoria', () => {
    const email = composeEmail(edition, 8)!;
    expect(email.body).toContain('## Banco Central mantém Selic');
    expect(email.body).toContain('https://noticias.globalnote.com.br/noticia/s1/');
    expect(email.body).toContain('Afeta crédito e investimentos.'); // porQueImporta
    expect(email.body).toContain('**Economia** ·'); // rótulo via CATEGORY_LABELS
  });
  it('omite o selo de categoria para "geral" e usa clusterId sem slug', () => {
    const email = composeEmail(edition, 8)!;
    expect(email.body).toContain('Resumo geral.');
    expect(email.body).toContain('https://noticias.globalnote.com.br/noticia/c2/');
    expect(email.body).not.toContain('**Geral**');
  });
  it('respeita maxStories', () => {
    const email = composeEmail(edition, 1)!;
    expect(email.body).toContain('Banco Central mantém Selic');
    expect(email.body).not.toContain('Manchete geral do dia');
  });
  it('devolve null para edição vazia', () => {
    expect(composeEmail({ date: '2026-06-03', home: [] }, 8)).toBeNull();
  });
});

describe('decideSend', () => {
  const base = { state: emptyState, editionDate: '2026-06-03', hourUtc: 12, sendHour: 12, force: false };
  it('envia quando a edição é nova e está na janela', () => {
    expect(decideSend(base).send).toBe(true);
  });
  it('não reenvia a mesma edição', () => {
    const state: NewsletterState = { updatedAt: '', lastSentDate: '2026-06-03', sent: ['2026-06-03'] };
    expect(decideSend({ ...base, state }).send).toBe(false);
  });
  it('não envia fora da janela horária', () => {
    expect(decideSend({ ...base, hourUtc: 4 }).send).toBe(false);
  });
  it('force ignora janela e dedup', () => {
    const state: NewsletterState = { updatedAt: '', lastSentDate: '2026-06-03', sent: ['2026-06-03'] };
    expect(decideSend({ ...base, state, hourUtc: 0, force: true }).send).toBe(true);
  });
});
