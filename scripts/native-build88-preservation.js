// Preserve the entire historical native audio/auth/scene fingerprint, not just
// an updated whole-file hash. Only the five exact reviewed Build88 edits are
// normalized; arbitrary changes to the new restore hook also fail closed.
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const patch = require('./native-build88-patch.json')
function legacyNativeSource(source) {
  let text = source
  assert.equal(patch.replacements.length, 5, 'Unexpected native change scope')
  for (const { old, new: replacement } of patch.replacements) {
    assert.ok(replacement.length > 0)
    assert.equal(text.split(replacement).length - 1, 1, 'Reviewed native hook changed or is duplicated')
    text = text.replace(replacement, old)
  }
  assert.equal(crypto.createHash('sha256').update(text).digest('hex'), patch.baseSHA256, 'Native code outside reviewed Build88 changes differs')
  return text
}
module.exports = { legacyNativeSource }
