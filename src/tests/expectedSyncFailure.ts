/** Simulator-only assertion: retain unexpected failures rather than reducing
 * network/protocol/native failures to a misleading missing-code boolean.
 */
const safe = (value: unknown) => String(value ?? '')
  .replace(/https?:\/\/\S+/gi, '[server]')
  .replace(/(password|authCode|privateKey|authorization|token)\s*[=:]\s*\S+/gi, '$1=[redacted]')
  .slice(0, 320)

export const expectSyncFailure = async(
  action: () => Promise<unknown>,
  expected: string,
  context: () => { status: { status: boolean, message: string }, diagnostic: string },
) => {
  let rejected = false
  let failure: unknown
  try { await action() } catch (error) { rejected = true; failure = error }
  const received = rejected ? String((failure as { message?: unknown })?.message ?? failure) : '[resolved without rejection]'
  if (rejected && received === expected) return { expected, received }
  const state = context()
  throw new Error('Expected sync rejection ' + expected + '; actual=' + safe(received) +
    '; name=' + safe((failure as { name?: unknown })?.name) +
    '; stage=' + safe((failure as { syncStage?: unknown })?.syncStage) +
    '; status=' + String(state.status.status) + ':' + safe(state.status.message) +
    '; diagnostic=' + safe(state.diagnostic))
}
