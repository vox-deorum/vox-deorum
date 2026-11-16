/** Check responsive paper geometry and game viewport negotiation independently of browser capture. */
import { describe, expect, it } from 'vitest';
import { computeRenderLayout, computeRenderProfileForView, defaultRenderProfile } from '../../../../src/newspaper/renderer/layout.js';
import { parseRenderProfile, validateRenderProfileForDesign } from '../../../../src/newspaper/renderer/validation.js';
import { renderCacheKey } from '../../../../src/newspaper/export/cache.js';
import { createNewspaperIssue } from '../../../helpers/newspaper-fixtures.js';

describe('newspaper responsive layout', () => {
  it.each([
    { width: 1140, height: 558, zoom: 1, paperWidth: 1140 },
    { width: 1780, height: 918, zoom: 1, paperWidth: 1200 },
    { width: 2420, height: 1278, zoom: 1, paperWidth: 1200 },
    { width: 1000, height: 600, zoom: 2, paperWidth: 500 },
    { width: 1000, height: 600, zoom: 0.5, paperWidth: 1200 },
    { width: 801, height: 600, zoom: 1.3, paperWidth: 616.140625 },
  ])('should fit physical width $width at zoom $zoom without shrinking text', ({ width, height, zoom, paperWidth }) => {
    const profile = computeRenderProfileForView({ width, height, zoom });
    expect(profile.paperWidth).toBe(paperWidth);
    expect(profile.paperWidth * zoom).toBeLessThanOrEqual(width);
    expect(profile.displayScale).toBe(zoom);
    expect(profile.textScale).toBe(1);
    expect(profile.viewportHeight).toBe(defaultRenderProfile.viewportHeight);
    expect(profile.viewportWidth * profile.rasterScale).toBeGreaterThanOrEqual(Math.ceil(paperWidth * profile.rasterScale / 4) * 4);
    validateRenderProfileForDesign(profile, 'victorian');
    validateRenderProfileForDesign(profile, 'modern');
  });

  it('should reuse expanded publication pixels and cache identity when only the game view height changes', () => {
    const shorterView = computeRenderProfileForView({ width: 1140, height: 558, zoom: 1.25 });
    const tallerView = computeRenderProfileForView({ width: 1140, height: 918, zoom: 1.25 });
    expect(shorterView).toEqual(tallerView);
    const issue = createNewspaperIssue();
    expect(renderCacheKey(issue, shorterView, 'assets', 'B8G8R8A8_UNORM'))
      .toBe(renderCacheKey(issue, tallerView, 'assets', 'B8G8R8A8_UNORM'));
  });

  it.each([
    [480, 16, 16], [480.015625, 24, 24], [760, 24, 24], [760.015625, 48, 32],
  ])('should derive content from outer width %s and responsive margins', (paperWidth, victorianPadding, modernPadding) => {
    for (const [design, padding] of [['victorian', victorianPadding], ['modern', modernPadding]] as const) {
      const profile = { ...defaultRenderProfile, paperWidth };
      const layout = computeRenderLayout(design, profile);
      expect(layout.regionWidth).toBe(paperWidth);
      expect(layout.paperPadding).toBe(padding);
      expect(layout.contentWidth + padding * 2 + layout.scrollbarGutter).toBe(paperWidth);
    }
  });

  it('should reject profiles with no content space, inadequate capture space, or alignment beyond texture limits', () => {
    expect(() => computeRenderLayout('modern', { ...defaultRenderProfile, paperWidth: 48 })).toThrow();
    expect(() => validateRenderProfileForDesign({ ...defaultRenderProfile, paperWidth: 600.015625, viewportWidth: 601 }, 'modern')).toThrow();
    expect(() => validateRenderProfileForDesign({ ...defaultRenderProfile, paperWidth: 600.015625, maxTextureWidth: 1202 }, 'modern')).toThrow();
    expect(() => parseRenderProfile({ ...defaultRenderProfile, paperWidth: undefined, contentWidth: 900 })).toThrow();
    expect(() => parseRenderProfile({ ...defaultRenderProfile, displayScale: undefined })).toThrow();
  });
});
