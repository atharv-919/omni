type RequestToolIdentity = { namespace: string; name: string };

function asRequestToolIdentity(value: unknown): RequestToolIdentity | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { namespace, name } = value as Record<string, unknown>;
  return typeof namespace === "string" && namespace && typeof name === "string" && name
    ? { namespace, name }
    : null;
}

/**
 * Resolve a flattened Chat function name back to the identity declared by the
 * request's Responses namespace tool. The request path supplies this map on
 * the response translation state.
 *
 * Some model-specific tool parsers render the registered `namespace__leaf`
 * wire name as `namespace.leaf`. Accept that spelling only when it matches an
 * identity already present in the request ledger; never infer a namespace by
 * splitting an otherwise unknown tool name.
 */
export function resolveRequestToolIdentity(identityMap: unknown, toolName: string) {
  if (!toolName || !identityMap) return null;

  const getEntry = (key: string): unknown => {
    if (identityMap instanceof Map) return identityMap.get(key);
    if (typeof identityMap === "object" && !Array.isArray(identityMap)) {
      return (identityMap as Record<string, unknown>)[key];
    }
    return undefined;
  };

  // 1. Direct hit
  const direct = getEntry(toolName);
  const directIdentity = asRequestToolIdentity(direct);
  if (directIdentity) return directIdentity;

  // 2. Chained alias hit: if direct value is a string alias (e.g. "functions__exec")
  if (typeof direct === "string") {
    const aliasedIdentity = asRequestToolIdentity(getEntry(direct));
    if (aliasedIdentity) return aliasedIdentity;
  }

  // 3. Collect candidates
  const rawCandidates =
    identityMap instanceof Map
      ? Array.from(identityMap.values())
      : typeof identityMap === "object" && !Array.isArray(identityMap)
        ? Object.values(identityMap as Record<string, unknown>)
        : [];

  const candidates: RequestToolIdentity[] = [];
  for (const candidate of rawCandidates) {
    const identity = asRequestToolIdentity(candidate);
    if (identity) candidates.push(identity);
  }

  const toolLower = toolName.toLowerCase();

  // 4. Check compound variations: single underscore, double underscore, dot, hyphen
  for (const identity of candidates) {
    const ns = identity.namespace;
    const nm = identity.name;
    const single = `${ns}_${nm}`;
    const double = `${ns}__${nm}`;
    const dot = `${ns}.${nm}`;
    const hyphen = `${ns}-${nm}`;

    if (toolName === single || toolName === double || toolName === dot || toolName === hyphen) {
      return identity;
    }
    if (
      toolLower === single.toLowerCase() ||
      toolLower === double.toLowerCase() ||
      toolLower === dot.toLowerCase() ||
      toolLower === hyphen.toLowerCase()
    ) {
      return identity;
    }
  }

  // 5. Check exact or case-insensitive bare leaf name (only if unambiguous)
  const leafMatches = candidates.filter(
    (identity) => toolName === identity.name || toolLower === identity.name.toLowerCase()
  );
  if (leafMatches.length === 1) {
    return leafMatches[0];
  }

  // 6. Check underscore-delimited suffix match (e.g. tool_<hash>_exec or prefix__exec, only
  // if unambiguous). Dot notation is intentionally excluded here: a dotted name is meant to
  // spell an exact `namespace.name` pair (already handled by step 4), so a dotted prefix that
  // does not match any candidate's real namespace (e.g. "other.exec_command") must stay
  // unresolved rather than being treated as an arbitrary hash-style prefix.
  const suffixMatches = candidates.filter((identity) => {
    const nmLower = identity.name.toLowerCase();
    return (
      toolName.endsWith(`_${identity.name}`) ||
      toolName.endsWith(`__${identity.name}`) ||
      toolLower.endsWith(`_${nmLower}`) ||
      toolLower.endsWith(`__${nmLower}`)
    );
  });
  if (suffixMatches.length === 1) {
    return suffixMatches[0];
  }

  return null;
}

/**
 * Shared classification used by both emitToolCall() and closeToolCall() in
 * openai-responses.ts — kept here so the two call sites cannot drift apart
 * (see the "must stay in sync" comment at both call sites).
 */
export function resolveToolCustomStatus(
  state: {
    requestToolIdentityMap?: unknown;
    toolSchemas?: { has?: (key: string) => boolean };
    customToolNames?: { has?: (key: string) => boolean };
  },
  toolName: string,
  lowerName: string
): { identity: RequestToolIdentity | null; isCustomTool: boolean } {
  const identity = resolveRequestToolIdentity(state.requestToolIdentityMap, toolName);
  const resolvedLeaf = identity ? identity.name.toLowerCase() : lowerName;
  // "exec" only carves out as a custom tool when it resolved through a namespace identity
  // (the Codex `functions.exec`/`os.exec` sub-tool convention) — a bare, unnamespaced
  // function literally named "exec" (e.g. a Gemma tool call) must stay a regular function_call.
  const isCustomTool = Boolean(
    ((lowerName === "apply_patch" ||
      lowerName === "applypatch" ||
      resolvedLeaf === "apply_patch" ||
      resolvedLeaf === "applypatch" ||
      (identity !== null && resolvedLeaf === "exec")) &&
      !state.toolSchemas?.has?.(toolName)) ||
    state.customToolNames?.has?.(toolName) === true ||
    (identity !== null && state.customToolNames?.has?.(identity.name) === true) ||
    state.customToolNames?.has?.(resolvedLeaf) === true
  );
  return { identity, isCustomTool };
}
