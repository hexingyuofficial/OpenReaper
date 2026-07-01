/**
 * Descriptor types that flow back from the bridge to the agent.
 * Mutating templates MUST populate `id` with a guid:{...} reference so the
 * agent can promote `selected:` / `last_result:` references to stable ones.
 *
 * Naming convention: `name` and `track_name` are REQUIRED strings. When the
 * underlying REAPER object has no user-assigned name, the value is `""` —
 * "the user did not set a name" is real state, not a missing field. We never
 * return `null` or omit the key. See docs/RESPONSE_BUDGET.md §
 * "Empty Strings vs Missing Fields" for why this is locked.
 */

export interface ItemDescriptor {
  /** guid:{...} reference. Stable across commands and sessions. */
  id: string;
  /** Active take name. `""` when the take is unnamed. */
  name: string;
  /** Parent track name. `""` when the track is unnamed. */
  track_name: string;
  position: number;
  length: number;
}

export interface TrackDescriptor {
  /** guid:{...} reference. */
  id: string;
  /** Track name. `""` when the track is unnamed. */
  name: string;
  /** Zero-based REAPER track index. Display/order hint, not a stable ref. */
  index: number;
  /** Folder display depth before this track's folder-depth delta is applied. */
  depth: number;
  volume: number;
  pan: number;
  mute: boolean;
  solo: boolean;
  recarm: boolean;
  /**
   * Present only when `get_state({ scope: "tracks", include: ["fx"] })`
   * is requested. Omitted by default to preserve the response budget.
   */
  fx?: FxDescriptor[];
}

export interface FxDescriptor {
  /** Zero-based FX slot index within the track. Not a stable ref. */
  index: number;
  /** FX display name. `""` if REAPER cannot provide one. */
  name: string;
  /** REAPER fx_ident named-config value. `""` if unavailable. */
  ident: string;
  enabled: boolean;
  /** Active preset name/path. `""` when no preset name is reported. */
  preset_name: string;
}

export interface RegionDescriptor {
  /** Region names are user-facing references in v0.1; indices are not stable. */
  name: string;
  start: number;
  end: number;
}

export interface ProjectDescriptor {
  bpm: number;
  time_sig_num: number;
  time_sig_den: number;
  sample_rate: number;
  length_seconds: number;
}

export interface ArtifactState {
  ref: string;
  id: string;
  scope: string;
  owner_pack: string;
  producer_template: string;
  schema: string;
  created_at: string;
  summary: Record<string, unknown>;
  payload?: Record<string, unknown>;
  view: "summary" | "payload";
  truncated: false;
  response_bytes: number;
}

/**
 * Response-budget metadata attached to every list-shaped response.
 * See docs/RESPONSE_BUDGET.md for the contract.
 *
 * - `total`         — true count in REAPER, regardless of what was returned.
 * - `returned`      — how many items are in this response.
 * - `truncated`     — `returned < total`, for whatever reason
 *                     (limit hit OR byte cap hit at item boundary).
 * - `response_bytes`— rough size of the items payload after JSON encoding.
 */
export interface ResponseBudgetMeta {
  total: number;
  returned: number;
  truncated: boolean;
  response_bytes: number;
}

export interface SelectionState extends ResponseBudgetMeta {
  items: ItemDescriptor[];
}

export interface TracksState extends ResponseBudgetMeta {
  items: TrackDescriptor[];
}

export interface RegionsState extends ResponseBudgetMeta {
  items: RegionDescriptor[];
}

export interface ProjectState {
  selection?: SelectionState;
  project?: ProjectDescriptor;
  tracks?: TracksState;
  regions?: RegionsState;
  artifact?: ArtifactState;
}

/** REAPER major.minor.patch version string, e.g. "7.21". */
export type ReaperVersion = string;

/**
 * Locked v0.1 shape returned by every `call_template` invocation, regardless
 * of the underlying template. See docs/RESPONSE_BUDGET.md § `call_template`
 * for the rationale.
 *
 * Rules (enforced at the Lua dispatcher, not in individual templates):
 *
 * - `changed_count` is the **true** count of items the template mutated.
 * - `changed_ids` is capped at 50 entries in mutation order. If
 *   `changed_count > 50` then `truncated: true` and the array contains the
 *   first 50.
 * - The result NEVER embeds `ItemDescriptor` or other rich payloads, even
 *   for single-item mutations. Agents read post-state via
 *   `get_state(ids=[...])` (v0.1: ids filter unimplemented — the agent
 *   reads `selection` and matches on returned GUIDs).
 *
 * This shape is the same for read-only, write-safe, filesystem-touching,
 * and (eventually) destructive templates. Bridge dispatcher normalizes —
 * individual handlers only return `{ changed_ids = [...] }`.
 *
 * `changed_ids` entry shapes:
 *
 * Most templates use project-entity refs:
 *   "guid:{...}"  — item or track GUID
 *   "region:NAME" — region (no native GUID API in REAPER 7)
 *   "track:Name"  — bare track name (rare)
 *
 * JSON artifact producers use pack-qualified artifact refs:
 *   "artifact:<owner_pack>:<scope>:<id>"
 *
 * `render_region` is the legacy external-file carve-out: its
 * `changed_ids` carries absolute WAV paths (e.g.
 * `["/Users/.../var_01.wav"]`). Do not copy that shape for JSON
 * artifacts; use artifact refs and read details through
 * `get_state(scope:"artifact")`.
 */
export interface CallTemplateResult {
  template: string;
  changed_count: number;
  /**
   * Per-template entry shape; see the interface doc for the rule. Most
   * templates fill this with project-entity refs (`guid:{...}`,
   * `region:NAME`, `track:Name`). JSON artifact producers fill it with
   * `artifact:<owner_pack>:<scope>:<id>` refs. `render_region` fills it
   * with absolute WAV paths instead — the documented legacy carve-out.
   */
  changed_ids: string[];
  truncated: boolean;
}
