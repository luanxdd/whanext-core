import { describe, expect, it } from 'vitest';

import { A2UICanvas } from '@/canvas/a2ui.js';
import { musicPlayer } from '@/canvas/music-player.js';

describe('A2UI canvas', () => {
  it('builds a WhatsApp A2UI surface with typed components', () => {
    const canvas = new A2UICanvas({
      surfaceId: 'profile',
      theme: { primaryColor: '#25D366', agentDisplayName: 'WhaNext' },
    });
    const title = canvas.text('Olá', { id: 'title', variant: 'h1' });
    const cover = canvas.image('https://cdn.example.com/cover.jpg', {
      id: 'cover',
      variant: 'header',
    });
    canvas.root([canvas.card(canvas.column([cover, title]))]);

    const widget = canvas.build('Olá');
    const payload = JSON.parse(widget.data) as any;

    expect(widget.type).toBe('im_a2ui');
    expect(widget.fallback).toBe('Olá');
    expect(payload).toMatchObject({
      version: 'v0.9',
      createSurface: {
        surfaceId: 'profile',
        theme: { primaryColor: '#25D366', agentDisplayName: 'WhaNext' },
      },
    });
    expect(payload.createSurface.components).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'root', component: 'Column' }),
      expect.objectContaining({ id: 'title', component: 'Text', text: 'Olá', variant: 'h1' }),
      expect.objectContaining({ id: 'cover', component: 'Image' }),
    ]));
  });

  it('builds a music player with cover, audio and timestamped lyrics', () => {
    const canvas = musicPlayer({
      title: 'Starboy',
      artist: 'The Weeknd',
      album: 'Starboy',
      coverUrl: 'https://cdn.example.com/starboy.jpg',
      audioUrl: 'https://cdn.example.com/starboy.m4a',
      lyrics: [
        { timeMs: 12_340, text: 'I am trying to put you in the worst mood' },
        { timeMs: 18_000, text: 'P1 cleaner than your church shoes' },
      ],
    });
    const payload = JSON.parse(canvas.build('🎵 Starboy — The Weeknd').data) as any;
    const components = payload.createSurface.components as any[];

    expect(components).toEqual(expect.arrayContaining([
      expect.objectContaining({ component: 'Image' }),
      expect.objectContaining({ component: 'AudioPlayer', url: 'https://cdn.example.com/starboy.m4a' }),
      expect.objectContaining({ component: 'Text', text: expect.stringContaining('[0:12]') }),
    ]));
  });

  it('rejects duplicate ids, unsafe media URLs and missing references', () => {
    const canvas = new A2UICanvas();
    canvas.text('A', { id: 'same' });
    expect(() => canvas.text('B', { id: 'same' })).toThrow(/already in use/);
    expect(() => canvas.audio('file:///tmp/song.m4a')).toThrow(/HTTP or HTTPS/);

    const broken = new A2UICanvas();
    broken.root(['missing']);
    expect(() => broken.build('Fallback')).toThrow(/unknown id/);
  });
});
