/**
 * Clear persisted LKGP pins when a combo target fails or is skipped for exhaustion,
 * cooldown or unavailability (#11911 #919).
 *
 * Non-blocking by design: the fallback loop never waits on these SQLite writes. A
 * failed clear is not silent — it logs a warning carrying the combo and the
 * execution key. The returned promise never rejects: routing callers ignore it,
 * tests await it.
 *
 * @internal — re-exported by combo.ts as `clearStaleLKGP`.
 */

type WarnLogger = { warn?: (tag: string, msg: string, data?: unknown) => void } | null;
type ClearLkgp = (comboName: string, modelKey: string) => Promise<void>;

/** The target whose failure triggered the clear, when the caller has one in scope. */
export type FailedTarget = { provider?: string | null; connectionId?: string | null } | null;

async function clearPins(
  comboName: string,
  executionKey: string | null | undefined,
  comboId: string | null | undefined,
  clearLKGP: ClearLkgp | undefined,
  failed: FailedTarget | undefined
): Promise<void> {
  const settings = await import("@/lib/db/settings");
  const clear = clearLKGP ?? settings.clearLKGP;
  const comboKey = comboId || comboName;

  // The target-scoped pin is unambiguously about the target that just failed.
  const keys: string[] = executionKey ? [executionKey] : [];

  // The combo-level pin records whichever provider last SUCCEEDED, which need not
  // be the one failing now. Under `auto` it is a scoring input rather than a hoist
  // (`resolveAutoStrategy` reads it into `lastKnownGoodProvider`), so clearing it
  // unconditionally discarded a preference for a healthy provider every time an
  // unrelated target was skipped (#12235). With no `failed` in scope the previous
  // unconditional behaviour is kept, so callers without a target are unaffected.
  if (!failed?.provider) {
    keys.push(comboKey);
  } else {
    const pin = await settings.getLKGP(comboName, comboKey);
    // Same provider, and — when both sides carry one — the same connection.
    // A sibling connection failing does not make the pinned one stale.
    const namesFailedTarget =
      pin?.provider === failed.provider &&
      (!pin?.connectionId || !failed.connectionId || pin.connectionId === failed.connectionId);
    if (namesFailedTarget) keys.push(comboKey);
  }

  await Promise.all(keys.map((key) => clear(comboName, key)));
}

export function clearStaleLKGP(
  comboName: string,
  executionKey?: string | null,
  comboId?: string | null,
  log?: WarnLogger,
  tag: string = "COMBO",
  /** Test seam; the routing path always resolves clearLKGP from @/lib/db/settings. */
  clearLKGP?: ClearLkgp,
  /**
   * Seventh rather than sixth deliberately: `clearLKGP` above is passed
   * positionally by `stale-lkgp-clear-13614.test.ts`, so inserting ahead of it
   * would silently rebind that argument. Production callers pass `undefined` for
   * the seam; see the PR for an options-object alternative if this grows again.
   */
  failed?: FailedTarget
): Promise<void> {
  return clearPins(comboName, executionKey, comboId, clearLKGP, failed).catch((err: unknown) => {
    log?.warn?.(tag, "Failed to clear Last Known Good Provider. This is non-fatal.", {
      combo: comboName,
      comboId: comboId ?? null,
      executionKey: executionKey ?? null,
      err,
    });
  });
}
