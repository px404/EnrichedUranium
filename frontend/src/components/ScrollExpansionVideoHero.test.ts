import { describe, expect, it } from 'vitest';

import { frameIndexForProgress, frameUrl } from './scrollExpansionFrames';

describe('ScrollExpansionVideoHero frame helpers', () => {
  it('maps scroll progress across the full frame range', () => {
    expect(frameIndexForProgress(-0.2, 240)).toBe(0);
    expect(frameIndexForProgress(0, 240)).toBe(0);
    expect(frameIndexForProgress(0.5, 240)).toBe(120);
    expect(frameIndexForProgress(1, 240)).toBe(239);
    expect(frameIndexForProgress(1.4, 240)).toBe(239);
  });

  it('formats one-based frame URLs from the manifest pattern', () => {
    expect(frameUrl('/frames/agentmesh-demo/{INDEX:03}.jpg', 0)).toBe(
      '/frames/agentmesh-demo/001.jpg',
    );
    expect(frameUrl('/frames/agentmesh-demo/{INDEX:03}.jpg', 239)).toBe(
      '/frames/agentmesh-demo/240.jpg',
    );
  });
});
