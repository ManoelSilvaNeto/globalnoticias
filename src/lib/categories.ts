// Categorias do GlobalNoticias — fonte única, compartilhada entre o pipeline e o site.

export const CATEGORIES = [
  'politica',
  'economia',
  'mundo',
  'tecnologia',
  'ciencia',
  'saude',
  'esportes',
  'entretenimento',
] as const;

export type Category = (typeof CATEGORIES)[number];

// Artigos podem cair em "geral" quando a fonte não indica categoria.
// "geral" aparece só na home (nunca vira página de categoria).
export type ArticleCategory = Category | 'geral';

export const CATEGORY_LABELS: Record<Category, string> = {
  politica: 'Política',
  economia: 'Economia',
  mundo: 'Mundo',
  tecnologia: 'Tecnologia',
  ciencia: 'Ciência',
  saude: 'Saúde',
  esportes: 'Esportes',
  entretenimento: 'Entretenimento',
};

export function isCategory(value: string): value is Category {
  return (CATEGORIES as readonly string[]).includes(value);
}
