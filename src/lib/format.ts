// Formatação de datas em PT-BR, sempre no fuso de Brasília (o site é estático,
// então datas são absolutas — relativo ficaria desatualizado).

const TZ = 'America/Sao_Paulo';

// "20 de mai • 14h30"
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const data = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: 'short' }).format(d);
  const hora = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })
    .format(d)
    .replace(':', 'h');
  return `${data} • ${hora}`;
}

// "terça-feira, 20 de maio de 2026" a partir de uma data AAAA-MM-DD.
export function formatDateFull(date: string): string {
  const d = new Date(`${date}T12:00:00-03:00`);
  if (Number.isNaN(d.getTime())) return date;
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: TZ,
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(d);
}
