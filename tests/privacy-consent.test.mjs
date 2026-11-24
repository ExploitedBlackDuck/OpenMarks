import test from 'node:test';
import assert from 'node:assert/strict';
import { FaviconConsentModal } from '../.test-build/ui.mjs';

test('dismissing the favicon consent modal records disabled retrieval once', async () => {
  const state = { automaticFavicons: true, faviconPrivacyChoice: false, calls: 0 };
  const host = {
    async setAutomaticFavicons(enabled) {
      state.calls++;
      state.automaticFavicons = enabled;
      state.faviconPrivacyChoice = true;
    },
  };
  const modal = new FaviconConsentModal({}, host);
  modal.onClose();
  modal.onClose();
  await Promise.resolve();
  assert.equal(state.automaticFavicons, false);
  assert.equal(state.faviconPrivacyChoice, true);
  assert.equal(state.calls, 1);
});
