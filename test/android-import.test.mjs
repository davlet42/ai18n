import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const { parseAndroidStringsXml, emitAndroidXml } = await import('../dist/index.js');

describe('android plural import printf indices', () => {
  it('keeps multiple %d placeholders instead of collapsing to #', () => {
    const xml = `<resources>
  <plurals name="overview_setup_payments_counter">
    <item quantity="one">%1$d of %2$d payment request ready to pay</item>
    <item quantity="other">%1$d of %2$d payment requests ready to pay</item>
  </plurals>
</resources>`;
    const { tree } = parseAndroidStringsXml(xml);
    const canonical = tree.overview_setup_payments_counter;
    assert.ok(canonical.includes('%1$d of %2$d'));
    assert.ok(!canonical.includes('# of #'));

    const { xml: roundTrip } = emitAndroidXml(
      [{ namespace: 'android', tree, sourceTree: tree }],
      { prefixNamespace: false },
    );
    assert.ok(roundTrip.includes('%1$d of %2$d payment request ready to pay'));
    assert.ok(!roundTrip.includes('%1$d of %1$d'));
  });

  it('converts a single %d in a plural body to ICU #', () => {
    const xml = `<resources>
  <plurals name="activity_payments_added_by_person">
    <item quantity="one">%1$s added %2$d payment</item>
    <item quantity="other">%1$s added %2$d payments</item>
  </plurals>
</resources>`;
    const { tree } = parseAndroidStringsXml(xml);
    const canonical = tree.activity_payments_added_by_person;
    assert.ok(canonical.includes('%1$s added # payment'));

    const { xml: roundTrip } = emitAndroidXml(
      [{ namespace: 'android', tree, sourceTree: tree }],
      { prefixNamespace: false },
    );
    assert.ok(roundTrip.includes('%1$s added %2$d payment'));
    assert.ok(!roundTrip.includes('%1$s added %1$d payment'));
  });
});
