import { A2UICanvas, type A2UITheme } from '@/canvas/a2ui.js';

export interface MusicLyricLine {
  text: string;
  timeMs?: number;
}

export interface MusicPlayerOptions {
  title: string;
  artist: string;
  audioUrl: string;
  coverUrl?: string;
  album?: string;
  lyrics?: string | readonly MusicLyricLine[];
  theme?: A2UITheme;
}

export function musicPlayer(options: MusicPlayerOptions): A2UICanvas {
  const canvas = new A2UICanvas({
    theme: options.theme ?? {
      primaryColor: '#25D366',
      agentDisplayName: 'WhaNext Music',
    },
  });
  const content: string[] = [];

  if (options.coverUrl) {
    content.push(canvas.image(options.coverUrl, {
      description: `Capa de ${options.title}`,
      fit: 'cover',
      variant: 'largeFeature',
    }));
  }

  content.push(canvas.text(options.title, { variant: 'h1' }));
  content.push(canvas.text(options.artist, { variant: 'h3' }));
  if (options.album) content.push(canvas.text(`💿 ${options.album}`, { variant: 'caption' }));
  content.push(canvas.audio(options.audioUrl, {
    description: `${options.title} — ${options.artist}`,
  }));

  const lyrics = formatLyrics(options.lyrics);
  if (lyrics) {
    content.push(canvas.divider());
    content.push(canvas.text('Letra', { variant: 'h2' }));
    content.push(canvas.text(lyrics, { variant: 'body' }));
  }

  return canvas.root([canvas.card(canvas.column(content))]);
}

function formatLyrics(lyrics: MusicPlayerOptions['lyrics']): string | undefined {
  if (typeof lyrics === 'string') return lyrics.trim() || undefined;
  if (!lyrics || lyrics.length === 0) return undefined;

  return lyrics
    .filter((line) => line.text.trim().length > 0)
    .map((line) => line.timeMs === undefined
      ? line.text
      : `${timestamp(line.timeMs)}  ${line.text}`)
    .join('\n\n');
}

function timestamp(timeMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(timeMs / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `[${minutes}:${seconds.toString().padStart(2, '0')}]`;
}
