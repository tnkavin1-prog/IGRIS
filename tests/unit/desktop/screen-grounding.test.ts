import { describe, it, expect, vi } from 'vitest';
import { CDPClient } from '../../../apps/desktop-hud/src/main/cdp-client.js';
import { ScreenGroundingService } from '../../../apps/desktop-hud/src/main/screen-grounding.js';

describe('read-only screen grounding', () => {
  it('locates without clicking and dispatches exactly one browser click in viewport coordinates', async () => {
    const cdp = new CDPClient();
    vi.spyOn(cdp, 'findElementByText').mockResolvedValue({
      text: 'Save',
      x: 120,
      y: 60,
      width: 80,
      height: 25,
      tabId: 'tab1',
      coordinateSpace: 'css_viewport',
    });
    const click = vi.spyOn(cdp, 'clickAt').mockResolvedValue(true);
    const textClick = vi.spyOn(cdp, 'clickElementByText');
    const grounding = new ScreenGroundingService({ cdpClient: cdp });
    expect(await grounding.findElement('Save')).toMatchObject({
      x: 120,
      coordinateSpace: 'css_viewport',
    });
    expect(click).not.toHaveBeenCalled();
    expect(textClick).not.toHaveBeenCalled();
    expect((await grounding.clickElement('Save')).ok).toBe(true);
    expect(click).toHaveBeenCalledExactlyOnceWith(120, 60, 'tab1', {});
    expect(textClick).not.toHaveBeenCalled();
  });

  it('does not search an unrelated browser when a native window is requested', async () => {
    const cdp = new CDPClient();
    const find = vi.spyOn(cdp, 'findElementByText');
    const grounding = new ScreenGroundingService({ cdpClient: cdp });
    expect(await grounding.findElement('Save', { containerTitle: 'Notepad' })).toBeNull();
    expect(find).not.toHaveBeenCalled();
  });
});
