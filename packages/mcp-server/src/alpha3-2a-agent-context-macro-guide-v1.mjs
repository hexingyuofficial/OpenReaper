import {
  ALPHA3_2_5_0_EXECUTABLE_TARGET_IDS,
} from "./alpha3-2-5-0-macro-inventory-v1.mjs";

export const ALPHA3_2A_AGENT_CONTEXT_MACRO_GUIDE_CONTRACT = "alpha3.2.agent_context_macro_guide.v1";
export const ALPHA3_2A_AGENT_CONTEXT_MACRO_GUIDE_VERSION = "1.0.0";
export const ALPHA3_2A_AGENT_CONTEXT_MACRO_GUIDE_PHASE = "Alpha3.2-A";

export const ALPHA3_2A_PRIMARY_MACRO_IDS = deepFreeze([
  "macro.project.inspect",
  "macro.project.query",
  "macro.project.delete_targets",
  "macro.project.apply_layout",
  "macro.routing.apply",
  "macro.media.place_assets",
  "macro.render.targets",
]);

export const ALPHA3_2A_ACTION_MANUAL_FIELDS = deepFreeze([
  "when_to_use",
  "when_not_to_use",
  "required_readiness",
  "input_shape",
  "preflight_steps",
  "underlying_actions",
  "readback_steps",
  "success_criteria",
  "common_blockers",
  "recovery_steps",
  "dry_run_shape",
  "resume_or_retry_policy",
  "examples",
]);

export const ALPHA3_2A_DEFAULT_GUIDE_MAX_BYTES = 24_576;
export const ALPHA3_2A_DEFAULT_GUIDE_DELTA_MAX_BYTES = 24_576;
export const ALPHA3_2A_DEFAULT_PRODUCT_SURFACE_BASELINE_MAX_BYTES = 73_728;
export const ALPHA3_2A_DEFAULT_LIST_TEMPLATES_MAX_BYTES = 98_304;
export const ALPHA3_2A_EXACT_MANUAL_MAX_BYTES = 24_576;
export const ALPHA3_2A_REQUESTED_EXPANSIONS_CONTRACT = "alpha3.2.agent_context_macro_guide.requested_expansions.v1";
export const ALPHA3_2_5_E_MACRO_FIRST_ROUTING_CONTRACT = "alpha3.2.5.e.macro_first_routing.v1";
export const ALPHA3_2_5_E_FALLBACK_GAP_REASONS = deepFreeze([
  "macro_missing_for_task",
  "macro_task_out_of_scope",
  "macro_target_ambiguous_or_unavailable",
  "macro_domain_not_accepted",
  "macro_budget_prefers_atomic_template",
]);

export const ALPHA3_2A_PROJECT_QUERY_ENTITIES = deepFreeze([
  "status",
  "selected_context",
  "tracks",
  "items",
  "takes",
  "fx",
  "routing",
  "automation",
  "markers_regions",
  "media_sources",
  "duplicates",
  "changed_since",
]);

export const ALPHA3_2A_PROJECT_FILE_TEMPLATE_POSTURE = deepFreeze({
  status: "reads_and_writes_accepted_live_smoked",
  accepted_mutation_routes: [
    "template.project.save_current_project",
    "template.project.save_project_as",
  ],
  ids: [
    { id: "template.project.read_current_project_path", role: "read current project path", status: "accepted_live_smoked" },
    { id: "template.project.read_dirty_state", role: "read current dirty state", status: "accepted_live_smoked" },
    { id: "template.project.save_current_project", role: "save current project", status: "accepted_live_smoked" },
    { id: "template.project.save_project_as", role: "save current project as a validated path", status: "accepted_live_smoked" },
  ],
  current_read_boundary: "Use the two accepted exact read templates; summary/metadata remain insufficient substitutes.",
  current_write_boundary: "macro.project.file executes the accepted save_current/save_as program with exact path and dirty-state readback; new/open/create and atomic overwrite=false remain held.",
});

const CONTRACT_ONLY_BLOCKER = "contract_only_pending_alpha3_2_c_d_e_implementation";

const PRIMARY_DEFINITIONS = deepFreeze([
  primaryDefinition({
    id: "macro.project.inspect",
    title: "Inspect current project",
    summary: "Return compact project identity, selection, entity rows, canonical refs, and readiness flags.",
    pack: "project",
    risk: "read",
    entity_kind: "macro.project.inspect",
    task_intents: ["inspect project", "show selected context", "check project readiness"],
    rollout_slice: "3.2.5-B",
    known_blocker: null,
    implementation_status: "executable_registered_program",
    runnable: true,
    manual: actionManual({
      when_to_use: [
        "Inspect current project identity, selection, compact entity rows, path, dirty state, render posture, and index readiness in one executable Macro call.",
        "Collect a compact bounded snapshot before a write, delete, routing, media, or render operation.",
      ],
      when_not_to_use: [
        "Do not use it as an unbounded project dump or as a substitute for a focused SQLite query.",
        "Do not infer success for a later mutation from this preflight snapshot.",
      ],
      required_readiness: [
        "The MCP server must answer ping.",
        "Live project reads require the configured OpenReaper bridge; otherwise return a typed readiness blocker.",
        "Requested include/fields/limit values must stay within bounded discovery and readback budgets.",
      ],
      input_shape: {
        include: "Optional ordered subset of project_identity, project_path, dirty_state, selected_context, tracks, items, markers_regions, render, and index_status.",
        fields: "Optional compact field selection for exactly one requested indexed row scope; mixed row scopes must use fields_by_scope.",
        fields_by_scope: "Optional per-scope compact fields for selected_context, tracks, items, and markers_regions; each key must also be present in include.",
        limit: "Positive bounded row limit per requested entity family.",
        compact_response: "Boolean; defaults true and never enables full descriptor or project dumps.",
        ref_policy: "canonical_only | include_missing_reasons; never fabricate refs.",
      },
      preflight_steps: [
        "Read server/bridge readiness without starting REAPER or using direct bridge files.",
        "Validate include, fields or fields_by_scope, limit, compact_response, and ref_policy before any live revision probe.",
        "Probe the live REAPER change-count, hydrate or reuse the matching SQLite index, then run only requested bounded direct reads.",
      ],
      underlying_actions: [
        "template.project.read_summary",
        "template.project.create_observation_bundle when the index is cold or stale",
        "SQLite Project Index queries for requested entity scopes",
        "template.render.read_settings",
        "template.project.read_dirty_state",
      ],
      readback_steps: [
        "Return macro.execution.v1 with completed registered stages, SQLite source/freshness/revision, and compact task-shaped data.",
        "Report project identity/path from the live summary, exact dirty state, render settings, and requested SQLite candidate rows.",
        "Return canonical candidate refs and budget truncation facts instead of child-request plans.",
      ],
      success_criteria: [
        "The response identifies current project context and reports requested path/dirty/render/index facts from executed reads.",
        "Requested rows are bounded, ordered, and carry canonical refs when resolvable.",
        "No write, render job, project save, model-supplied execution graph, or hidden recipe execution occurred.",
      ],
      common_blockers: [
        blocker("BRIDGE_NOT_READY", "Live project identity or entity reads are unavailable."),
        blocker("PROJECT_INDEX_REFRESH_FAILED", "The bounded read-only hydration could not produce fresh requested scopes."),
        blocker("PROJECT_REVISION_RECONCILE_FAILED", "The live REAPER change-count could not be reconciled with the managed index."),
        blocker("RESPONSE_BUDGET_EXCEEDED", "The requested include/fields/limit shape is too broad."),
      ],
      recovery_steps: [
        "For bridge readiness, use ping/startup guidance; never write direct bridge request files.",
        "For index/revision failure, restore the managed bridge/index route and retry the same Macro once; stale rows remain candidates only.",
        "For budget errors, reduce include families, fields, or limit and retry from the project-identity checkpoint.",
      ],
      dry_run_shape: {
        supported: false,
        behavior: "Inspection is already read-only and executes its registered bounded program; no separate dry-run planning mode is exposed.",
        output: ["macro_execution", "sqlite_evidence", "compact_project_data", "typed_blockers"],
      },
      resume_or_retry_policy: {
        resume_from: "latest project-identity read for the same bridge owner/generation",
        retry: "Retry once after readiness or budget repair; refresh refs after any project-generation change.",
        hard_stop: "Stop after the same typed blocker repeats twice.",
      },
      examples: [
        example("compact readiness", { include: ["project_identity", "selected_context", "render", "index_status", "project_path", "dirty_state"], fields_by_scope: { selected_context: ["ref", "scope_kind", "owner_ref"] }, limit: 25, compact_response: true, ref_policy: "canonical_only" }),
        example("tracks and items", { include: ["tracks", "items"], fields_by_scope: { tracks: ["ref", "name", "index"], items: ["ref", "track_ref", "start_seconds"] }, limit: 100, compact_response: true }),
      ],
    }),
  }),
  primaryDefinition({
    id: "macro.project.query",
    title: "Query current project index",
    summary: "Check/refresh the project SQLite index and return compact, freshness-qualified entity rows and optional refs.",
    pack: "core",
    risk: "read",
    entity_kind: "macro.project.query",
    task_intents: ["query project", "find tracks or items", "find duplicates", "changed since"],
    rollout_slice: "3.2.5-B",
    implementation_status: "executable_registered_program",
    runnable: true,
    known_blocker: null,
    manual: actionManual({
      when_to_use: [
        "Query exactly one supported entity: status, selected_context, tracks, items, takes, fx, routing, automation, markers_regions, media_sources, duplicates, or changed_since.",
        "Use a compact query result as the selector/ref source for a later audited template or macro.",
      ],
      when_not_to_use: [
        "Do not treat SQLite as the authority for a write; re-resolve write targets in live REAPER first.",
        "Do not use a broad query when one direct atomic read template answers the question more cheaply.",
      ],
      required_readiness: [
        "The managed Project Index store and live read route must be reachable when the requested scope needs hydration.",
        "The query must name one supported entity and bounded fields/limit.",
        "hydrate_refs requires live read support and must remain opt-in.",
      ],
      input_shape: {
        entity: "status | selected_context | tracks | items | takes | fx | routing | automation | markers_regions | media_sources | duplicates | changed_since",
        filters: "Bounded structured filters; no raw SQL string.",
        fields: "Compact allowlisted columns for the selected entity.",
        refresh_policy: "never | if_stale | required | force_read_only_refresh",
        hydrate_refs: "Boolean opt-in; false by default.",
        cursor: "Opaque continuation cursor.",
        limit: "Positive bounded page size.",
        selectors: "Optional safe common selectors such as selected, name, track_ref, time range, or changed-since token.",
      },
      preflight_steps: [
        "Validate entity against the exact Alpha3.2 vocabulary, then validate filters, selectors, fields, cursor, and limit without accepting raw SQL.",
        "Read index status, session identity, freshness, and entity coverage.",
        "Apply refresh_policy inside the registered Macro program; execute at most one bounded hydration flow and observe successful readback into the managed index.",
      ],
      underlying_actions: [
        "template.project.read_summary for live project revision reconciliation",
        "template.project.create_observation_bundle for bounded cold hydration",
        "accepted entity-specific read templates selected by the code-owned refresh policy",
        "internal covered macro.index_status/macro.query_* query planners",
      ],
      readback_steps: [
        "Validate that returned rows match the current project/session and requested entity.",
        "Return freshness, coverage, cursor, truncation, hydration evidence, and SQLite source with every page.",
        "Return canonical candidate refs; every later write must live re-resolve them and never fabricate missing refs.",
      ],
      success_criteria: [
        "The response contains a bounded page of rows or an explicit empty result.",
        "Freshness and coverage are stated, and any hydrated refs are current and canonical.",
        "No raw SQL, direct database write, REAPER mutation, model-supplied child graph, or generic hidden executor was used.",
      ],
      common_blockers: [
        blocker("INDEX_NOT_READY", "The project index is missing, stale, or bound to another session."),
        blocker("ENTITY_NOT_SUPPORTED", "The selected entity or field set is not in the bounded query schema."),
        blocker("REF_HYDRATION_UNAVAILABLE", "Live read support is unavailable for requested ref hydration."),
      ],
      recovery_steps: [
        "For INDEX_NOT_READY, let the same Macro perform its one bounded read-only refresh; retry only after a typed bridge/artifact recovery blocker.",
        "For unsupported fields, request a smaller allowlisted projection instead of raw SQL.",
        "For hydration failure, keep candidate rows, disable hydrate_refs, or restore bridge readiness before retrying.",
      ],
      dry_run_shape: {
        supported: false,
        behavior: "The read Macro executes its registered query/hydration program directly; no separate dry-run planning mode is exposed.",
        output: ["macro_execution", "sqlite_evidence", "candidate_rows", "canonical_refs", "typed_blockers"],
      },
      resume_or_retry_policy: {
        resume_from: "latest successful freshness checkpoint and opaque cursor",
        retry: "Refresh once when policy permits, then rerun the same normalized query.",
        hard_stop: "Stop on repeated refresh failure, session mismatch, or unsupported schema.",
      },
      examples: [
        example("find named tracks", { entity: "tracks", filters: { name_contains: "drum" }, fields: ["name", "folder_depth", "color"], refresh_policy: "if_stale", hydrate_refs: true, limit: 50 }),
        example("changed items", { entity: "changed_since", filters: { entity: "items", since_token: "snapshot:latest_verified" }, fields: ["change_kind", "name", "position_seconds"], refresh_policy: "required", hydrate_refs: false, limit: 100 }),
      ],
    }),
  }),
  primaryDefinition({
    id: "macro.project.delete_targets",
    title: "Delete scoped project targets",
    summary: "Preview and delete only explicitly scoped project objects or exact Track/Take FX instances with undo evidence and absence readback.",
    pack: "project",
    risk: "destructive",
    entity_kind: "macro.project.delete_targets",
    task_intents: ["delete tracks", "delete items", "delete markers or regions", "delete exact FX instances", "scoped cleanup"],
    rollout_slice: "Alpha3.3 lifecycle",
    known_blocker: null,
    implementation_status: "executable",
    runnable: true,
    manual: actionManual({
      when_to_use: [
        "Delete an explicit bounded set of project-owned tracks, items, markers, regions, or exact Track/Take FX instances after preview and confirmation.",
        "Apply a query-derived selector only when the resulting exact target set is shown and confirmed.",
      ],
      when_not_to_use: [
        "Never delete source media files from disk by default.",
        "Do not accept broad delete-everything, ambiguous selection, hardware/device, or unsupported take/automation deletion requests.",
      ],
      required_readiness: [
        "Current project identity and canonical target refs must be known.",
        "dry_run must be completed before destructive execution unless a future audited policy explicitly narrows the exception.",
        "confirm_scope must exactly match the previewed target kinds/counts and undo/readback must be available.",
      ],
      input_shape: {
        refs: "Explicit canonical project-object refs grouped by tracks/items/markers/regions/fx. FX rows must be exact fx:track:guid or fx:take:guid slot refs.",
        selectors: "Optional bounded query-derived selectors; must resolve to exact refs before execution.",
        dry_run: "Boolean; true by default and required for first pass.",
        confirm_scope: "Explicit confirmation token or object containing target kinds and expected counts.",
        delete_policy: "project_objects_only; filesystem deletion is not accepted.",
        compact_response: "Boolean; returns counts and bounded failure rows.",
      },
      preflight_steps: [
        "Inspect the current project and resolve every supplied/query-derived target to a canonical current-generation ref.",
        "Reject duplicate, stale, cross-project, filesystem, hardware, unsupported take, and unsupported automation targets.",
        "Return a dry-run preview with effective counts, collapsed Track/Track-FX overlaps, skipped refs, and exact confirmation scope.",
      ],
      underlying_actions: [
        "template.tracks.delete_track or template.tracks.delete_tracks",
        "template.items.delete_item or template.items.delete_items",
        "template.project.delete_marker",
        "template.project.delete_region",
        "template.fx.delete_fx",
        "matching accepted list/read templates for preflight and absence readback",
      ],
      readback_steps: [
        "Re-read each affected scope and prove targeted refs are absent; exact FX rows use native GUID absence readback from the complete owner chain.",
        "Return deleted/skipped/failed counts and bounded per-ref reasons.",
        "Retain request ids and undo evidence for successfully executed destructive calls.",
      ],
      success_criteria: [
        "Only previewed and confirmed project objects were deleted.",
        "Absence readback matches the deleted count, with exact skipped/failed rows reported.",
        "No source file, hardware route, or unsupported object family was deleted.",
      ],
      common_blockers: [
        blocker("DELETE_TARGETS_PREVIEW_REQUIRED", "Run the delete-targets dry-run preview and use its matching confirmation scope before destructive execution."),
        blocker("CONFIRM_SCOPE_REQUIRED", "The exact previewed target set has not been confirmed."),
        blocker("STALE_OR_AMBIGUOUS_TARGET", "A target is missing, stale, duplicated, or cross-project."),
        blocker("FILESYSTEM_DELETE_FORBIDDEN", "The request would delete media files from disk."),
        blocker("TARGET_KIND_UNSUPPORTED", "Take or automation deletion lacks an accepted audited template."),
      ],
      recovery_steps: [
        "For preview blockers, rerun dry-run, use the matching confirmation scope, and call the same registered Macro for bounded execution and readback.",
        "Regenerate the preview after any project change; never reuse an old confirmation scope.",
        "Remove unsupported/filesystem targets and retry only the accepted project-object subset.",
        "Use undo evidence when a partial execution succeeded, then re-inspect before retrying failed refs.",
      ],
      dry_run_shape: {
        supported: true,
        required_first: true,
        output: ["target_counts_by_kind", "exact_target_refs", "skipped_refs", "blocked_refs", "required_confirm_scope", "undo_plan"],
      },
      resume_or_retry_policy: {
        resume_from: "fresh preview plus surviving-target readback",
        retry: "Retry failed refs only after re-resolution and a new confirmation scope.",
        hard_stop: "Stop on filesystem deletion, unsupported target kind, cross-project refs, or repeated mismatch.",
      },
      examples: [
        example("preview two items", { refs: { items: ["item:guid:{ITEM-A}", "item:guid:{ITEM-B}"] }, dry_run: true, delete_policy: "project_objects_only", compact_response: true }),
        example("preview exact FX cleanup", { refs: { fx: ["fx:track:guid:{TRACK}:3", "fx:track:guid:{TRACK}:1"] }, dry_run: true, delete_policy: "project_objects_only" }),
        example("confirmed marker cleanup", { refs: { markers: ["marker:project:12"] }, dry_run: false, confirm_scope: { target_kinds: ["marker"], expected_counts: { marker: 1 } }, delete_policy: "project_objects_only" }),
      ],
    }),
  }),
  primaryDefinition({
    id: "macro.project.apply_layout",
    title: "Apply project layout",
    summary: "Create or update a declared folder/track hierarchy and create exact Marker/Region timeline annotations with live readback.",
    pack: "tracks",
    risk: "write",
    entity_kind: "macro.project.apply_layout",
    task_intents: ["build folder layout", "create tracks", "organize track order", "apply colors", "create marker", "create region"],
    rollout_slice: "3.2-E",
    known_blocker: null,
    implementation_status: "executable",
    runnable: true,
    manual: actionManual({
      when_to_use: [
        "Apply an explicit JSON layout of folder tracks and child tracks to the current project.",
        "Reconcile an existing track structure using an explicit matching policy.",
        "Create bounded exact Marker/Region annotations on the project timeline.",
      ],
      when_not_to_use: [
        "Do not use it as a genre, arrangement, composition, or music-style generator.",
        "Do not silently rename, delete, or repurpose unmatched existing tracks.",
      ],
      required_readiness: [
        "Current track/folder structure must be readable with canonical refs.",
        "Layout rows must have stable local ids/names, deterministic order, and valid nesting.",
        "Existing-track matching and conflict policy must be explicit before writes.",
      ],
      input_shape: {
        layout: "Ordered folders/tracks with local ids, names, colors, optional recursive children arrays, and optional desired refs. Recursive children are flattened deterministically to the existing flat parent_id ABI; flat parent_id rows remain accepted.",
        annotations: "Optional create-only Marker/Region rows with stable ids, names, and exact position or start/end seconds.",
        match_policy: "by_ref | exact_name | create_only; ambiguous matches are blocked.",
        conflict_policy: "skip | update_declared_fields | stop; no implicit delete.",
        dry_run: "Boolean; previews create/update/move/nesting actions.",
        compact_response: "Boolean; returns bounded created/updated/skipped/mismatch rows.",
      },
      preflight_steps: [
        "Read existing tracks and folder structure.",
        "For annotations, require one complete non-truncated live Marker/Region inventory before any write.",
        "Flatten recursive children in deterministic pre-order, then validate at most 100 total layout nodes, at most 8 nesting levels, acyclicity, unique local ids, parent_id agreement, color/name bounds, and deterministic order.",
        "Resolve exact matches and return a dry-run diff for creates, updates, moves, and nesting.",
      ],
      underlying_actions: [
        "template.tracks.list_tracks",
        "template.tracks.read_folder_structure",
        "template.tracks.create_folder_track",
        "template.tracks.create_track",
        "template.tracks.rename_track",
        "template.tracks.set_color",
        "template.tracks.move_track or template.tracks.move_tracks",
        "template.tracks.set_folder_depth or template.tracks.nest_tracks_in_folder",
        "template.project.list_markers_regions plus create_marker/create_region for timeline annotations",
      ],
      readback_steps: [
        "Read tracks and folder structure after writes.",
        "Read the complete Marker/Region inventory and compare each new canonical ref, kind, name, and timeline boundary.",
        "Map each declared local id to a canonical track ref and actual position/depth.",
        "Report any name, color, order, parent, or folder-depth mismatch.",
      ],
      success_criteria: [
        "Every declared row is created or matched according to policy and has a canonical ref.",
        "Actual order, nesting, names, and declared colors match the requested layout.",
        "Unmatched existing tracks remain unchanged unless an explicit accepted action covered them.",
      ],
      common_blockers: [
        blocker("LAYOUT_PREVIEW_REQUIRED", "Run the layout dry-run preview before applying the bounded registered layout program."),
        blocker("LAYOUT_INVALID", "The layout contains duplicate ids, recursive/object cycles, excessive nesting, conflicting parent declarations, or invalid fields."),
        blocker("MATCH_AMBIGUOUS", "More than one existing track matches a declared row."),
        blocker("READBACK_MISMATCH", "The resulting folder depth/order differs from the declared layout."),
        blocker("LAYOUT_ANNOTATION_UPDATE_UNSUPPORTED", "The accepted owner can create annotations but cannot yet move Markers or change Region bounds."),
      ],
      recovery_steps: [
        "For preview blockers, rerun dry-run, then call the same registered Macro after repairing the typed blocker.",
        "Fix invalid/ambiguous rows and rerun dry-run; do not guess a match.",
        "On partial success, keep the returned local-id-to-ref map, reread structure, and retry only remaining mismatches.",
        "Use undo evidence if structural readback cannot be reconciled safely.",
      ],
      dry_run_shape: {
        supported: true,
        output: ["matched_rows", "create_actions", "update_actions", "move_actions", "nesting_actions", "skipped_rows", "blockers"],
      },
      resume_or_retry_policy: {
        resume_from: "latest verified folder-structure readback and local-id-to-ref map",
        retry: "Apply only unresolved declared rows after a fresh diff.",
        hard_stop: "Stop on ambiguity, cycles, repeated folder-depth mismatch, or unexpected destructive change.",
      },
      examples: [
        example("create drum folder", { layout: [{ id: "drums", kind: "folder", name: "DRUMS", color: "#E05A47", children: [{ id: "kick", kind: "track", name: "Kick" }, { id: "snare", kind: "track", name: "Snare" }] }], match_policy: "exact_name", conflict_policy: "update_declared_fields", dry_run: true }),
        example("create-only utility tracks", { layout: [{ id: "print", kind: "track", name: "PRINT" }, { id: "ref", kind: "track", name: "REFERENCE" }], match_policy: "create_only", conflict_policy: "stop", dry_run: false }),
        example("create timeline annotations", { annotations: [{ id: "intro", kind: "marker", name: "Intro", position_seconds: 0 }, { id: "chorus", kind: "region", name: "Chorus", start_seconds: 8, end_seconds: 16 }], dry_run: true }),
      ],
    }),
  }),
  primaryDefinition({
    id: "macro.routing.apply",
    title: "Apply internal project routing",
    summary: "Preview and apply declared internal sends, exact send removals, master-parent posture, channels, and bounded send controls.",
    pack: "routing",
    risk: "write",
    entity_kind: "macro.routing.apply",
    task_intents: ["create sends", "update routing", "remove exact internal sends", "route tracks", "inspect routing graph"],
    rollout_slice: "Alpha3.3 lifecycle",
    known_blocker: null,
    implementation_status: "executable",
    runnable: true,
    manual: actionManual({
      when_to_use: [
        "Create, update, or remove explicit internal track-to-track routes and related bounded send settings.",
        "Apply a declared routing patch after inspecting the current routing graph.",
      ],
      when_not_to_use: [
        "Do not configure hardware outputs, device I/O, feedback-prone ambiguous routes, or irreversible external routing.",
        "Do not infer source/target tracks from names when matches are ambiguous.",
      ],
      required_readiness: [
        "Source and target tracks must resolve to distinct current canonical refs.",
        "The current routing graph must be readable before mutation.",
        "dry_run/confirm_scope and readback_policy must cover every proposed create/update/delete route action.",
      ],
      input_shape: {
        routes: "Ordered rows. create uses exact source/destination Track refs; update uses exact send_ref plus controls; delete uses only id/action/exact send_ref.",
        master_parent: "Optional declared per-track master-parent posture.",
        track_channel_counts: "Optional bounded per-track channel counts.",
        dry_run: "Boolean; previews graph delta.",
        confirm_scope: "Required exact route count/scope before writes.",
        readback_policy: "full_affected_graph | changed_routes_only.",
      },
      preflight_steps: [
        "Read the project routing graph and resolve source/target refs.",
        "Reject self-feedback, cycles that violate policy, duplicate routes, hardware endpoints, and ambiguous selectors.",
        "Return a dry-run graph delta with create/update/delete/skipped rows and required confirmation scope.",
      ],
      underlying_actions: [
        "template.routing.read_project_routing_graph",
        "template.routing.read_track_routing",
        "template.routing.create_track_send",
        "template.routing.resolve_send_ref",
        "template.routing.set_send_volume",
        "template.routing.set_send_pan",
        "template.routing.set_send_mute",
        "template.routing.set_send_mode",
        "template.routing.set_send_audio_channels",
        "template.routing.set_send_midi_channels",
        "template.routing.set_master_parent_send",
        "template.routing.set_track_channel_count",
        "template.routing.remove_send",
      ],
      readback_steps: [
        "Re-read the affected routing graph after each bounded patch batch.",
        "Return created/updated/deleted route refs, failed rows, and actual send settings.",
        "Report graph mismatches and possible feedback posture without claiming success.",
      ],
      success_criteria: [
        "Every confirmed internal route exists with the declared settings or is reported as a bounded failure.",
        "Readback graph contains no unapproved hardware endpoint or ambiguous feedback path.",
        "Canonical route/send refs and request/undo evidence are retained.",
      ],
      common_blockers: [
        blocker("ROUTING_APPLY_PREVIEW_REQUIRED", "Run a dry-run routing preview and planned readback before applying routing changes."),
        blocker("HARDWARE_IO_FORBIDDEN", "A route targets hardware/device I/O."),
        blocker("ROUTE_AMBIGUOUS_OR_FEEDBACK", "Source/target resolution or feedback posture is unsafe."),
        blocker("READBACK_MISMATCH", "Actual routing differs from the confirmed patch."),
      ],
      recovery_steps: [
        "For preview blockers, rerun dry-run, then call the same registered internal-routing Macro and require graph readback.",
        "Remove hardware/external endpoints and replace ambiguous selectors with canonical refs.",
        "For removal, use one exact category-0 send ref; never redirect the request to hardware outputs or infer a different send after indices shift.",
        "On partial success, reread the graph and retry only mismatched accepted rows with a new confirmation scope.",
      ],
      dry_run_shape: {
        supported: true,
        required_first: true,
        output: ["current_graph_summary", "create_rows", "update_rows", "delete_rows", "skipped_rows", "feedback_checks", "required_confirm_scope"],
      },
      resume_or_retry_policy: {
        resume_from: "latest verified affected routing graph",
        retry: "Retry only accepted mismatched route rows after re-resolution.",
        hard_stop: "Stop on hardware I/O, unsafe feedback, stale exact send identity, or repeated graph mismatch.",
      },
      examples: [
        example("create reverb send", { routes: [{ source_ref: "track:guid:{VOCAL}", target_ref: "track:guid:{VERB}", volume: 0.5, pan: 0, mute: false }], dry_run: true, readback_policy: "changed_routes_only" }),
        example("remove exact send", { routes: [{ id: "old_verb", action: "delete", send_ref: "send:track:guid:{VOCAL}:2" }], dry_run: true }),
        example("disable master parent", { routes: [], master_parent: [{ track_ref: "track:guid:{BUS}", enabled: false }], track_channel_counts: [{ track_ref: "track:guid:{BUS}", channels: 4 }], dry_run: false, confirm_scope: { route_rows: 0, track_rows: 1 } }),
      ],
    }),
  }),
  primaryDefinition({
    id: "macro.media.place_assets",
    title: "Place media assets",
    summary: "Validate, probe, import, place, name, and optionally region-wrap a bounded asset batch.",
    pack: "media",
    risk: "write",
    entity_kind: "macro.media.place_assets",
    task_intents: ["import audio", "place assets", "probe media", "create regions for assets"],
    rollout_slice: "3.2-E",
    known_blocker: null,
    implementation_status: "executable",
    runnable: true,
    manual: actionManual({
      when_to_use: [
        "Probe and place a bounded batch of existing media files into explicit target tracks.",
        "Apply deterministic position, item naming, and optional region policies to imported assets.",
      ],
      when_not_to_use: [
        "Do not delete, move, transcode, or overwrite source media files on disk.",
        "Do not guess missing paths, ambiguous target tracks, unsupported formats, or unmanaged output locations.",
      ],
      required_readiness: [
        "Every source path must pass validation and media probe before import.",
        "Each target track must resolve canonically or be created only through an explicit accepted layout/create path.",
        "Placement and collision policies must be deterministic and bounded.",
      ],
      input_shape: {
        assets: "Ordered rows containing path, optional item_name, target track ref/name selector, and optional position override.",
        placement_policy: "explicit | sequential | append_on_track with start/gap bounds.",
        target_policy: "require_existing | allow_explicit_create through accepted track template.",
        region_policy: "none | per_asset with bounded naming/color rules.",
        dry_run: "Boolean; probes and plans without import.",
        compact_response: "Boolean; returns refs, next positions, and bounded failures.",
      },
      preflight_steps: [
        "Validate path shape and file existence without changing the filesystem.",
        "Probe duration/type for every asset and reject unsupported or unreadable files.",
        "Resolve/create target refs only through accepted paths, then compute non-ambiguous positions and region bounds.",
      ],
      underlying_actions: [
        "template.media.probe_file",
        "template.tracks.resolve_track_ref or template.tracks.list_tracks",
        "template.tracks.create_track only when target_policy explicitly permits it",
        "template.media.import_file_to_track or template.media.import_file_section_to_track",
        "template.items.rename_take when item/take naming is requested",
        "template.project.create_region when region_policy is per_asset",
        "template.items.read_item_summary and template.project.list_markers_regions for readback",
      ],
      readback_steps: [
        "Read each imported item/take source and confirm target track, position, duration, and name.",
        "Read optional regions and verify names/bounds.",
        "Return file refs, item refs, region refs, next positions, warnings, and per-asset failures.",
      ],
      success_criteria: [
        "Every successful asset maps to the expected source file, target track, position, and duration.",
        "Optional names/regions match policy and all returned refs are canonical.",
        "Source files remain unchanged on disk and failures do not shift later explicit placements silently.",
      ],
      common_blockers: [
        blocker("MEDIA_PLACE_ASSETS_PREVIEW_REQUIRED", "Run a dry-run media placement preview and planned readback before importing assets."),
        blocker("PATH_INVALID_OR_UNREADABLE", "A source path is missing, inaccessible, or unsupported."),
        blocker("TARGET_TRACK_AMBIGUOUS", "The requested target track cannot be resolved exactly."),
        blocker("PLACEMENT_COLLISION", "The requested placement/collision policy cannot produce deterministic positions."),
        blocker("RESPONSE_BUDGET_EXCEEDED", "The asset batch or readback is too large."),
      ],
      recovery_steps: [
        "For preview blockers, rerun dry-run, then call the same registered media Macro and require item readback.",
        "Repair or remove invalid paths; never substitute a different file silently.",
        "Replace ambiguous track names with canonical refs or apply an explicit layout first.",
        "Split large batches and resume from the returned next_positions plus verified imported refs.",
      ],
      dry_run_shape: {
        supported: true,
        output: ["probe_rows", "resolved_targets", "planned_positions", "planned_regions", "next_positions", "blocked_assets"],
      },
      resume_or_retry_policy: {
        resume_from: "verified imported item refs and per-track next_positions",
        retry: "Retry failed assets only; do not re-import verified rows without an explicit replace policy.",
        hard_stop: "Stop on path substitution, filesystem mutation, unresolved target, or repeated placement mismatch.",
      },
      examples: [
        example("sequential stems", { assets: [{ path: "/audio/kick.wav", target_ref: "track:guid:{KICK}", item_name: "Kick" }, { path: "/audio/snare.wav", target_ref: "track:guid:{SNARE}", item_name: "Snare" }], placement_policy: { mode: "sequential", start_seconds: 0, gap_seconds: 0 }, target_policy: "require_existing", region_policy: "none", dry_run: true }),
        example("one region per asset", { assets: [{ path: "/audio/scene-a.wav", target_ref: "track:guid:{SFX}", item_name: "Scene A" }], placement_policy: { mode: "append_on_track", gap_seconds: 0.25 }, target_policy: "require_existing", region_policy: { mode: "per_asset", use_item_name: true }, dry_run: false }),
      ],
    }),
  }),
  primaryDefinition({
    id: "macro.render.targets",
    title: "Render declared targets",
    summary: "Preview or execute bounded managed-root WAV/OGG/MP3 exports with an optional user-owned basename through one audited D31 route.",
    pack: "render",
    risk: "write",
    entity_kind: "macro.render.targets",
    task_intents: ["render wav", "render region ogg", "export mp3", "render selected items", "export project"],
    rollout_slice: "3.2-E",
    known_blocker: null,
    implementation_status: "executable",
    runnable: true,
    manual: actionManual({
      when_to_use: [
        "Render a bounded whole project, time selection, explicit regions, selected/explicit items, or selected/explicit tracks to WAV, OGG, or native MP3.",
        "Require managed-root output, an optional safe visible basename, fail-if-exists collision policy, settings restoration, and verified output artifacts.",
      ],
      when_not_to_use: [
        "Do not provide an arbitrary output path, overwrite route, external encoder, shell/process, raw action/Lua, or hidden executor fallback.",
        "Do not claim broader format/platform support than the accepted D31 WAV/OGG/native-MP3 evidence.",
      ],
      required_readiness: [
        "Managed render-root readiness and live bridge readiness must pass.",
        "Target kind and canonical refs must match exactly; selected modes use current live selection and explicit modes require matching refs.",
        "The registered dirty-before, D31 render, and dirty-after dependencies plus manifest/evidence readback must complete before success wording.",
      ],
      input_shape: {
        target_kind: "whole_project | time_selection | regions | selected_items | explicit_items | selected_tracks | explicit_tracks.",
        format: "wav | ogg | mp3.",
        refs: "Canonical region/item/track refs only for the matching explicit target kind.",
        sample_rate_hz: "44100 | 48000; defaults to 48000.",
        channel_count: "1 | 2; defaults to 2.",
        wav_bit_depth: "16 | 24 for WAV only; defaults to 24.",
        ogg_quality: "0.3 | 0.5 | 0.6 | 0.8 | 1.0 for OGG only; defaults to 0.5.",
        mp3_bitrate_kbps: "128 | 192 | 256 | 320 for native MP3 only; defaults to 320.",
        output_basename: "Optional safe 1-96 byte filename stem without an extension; multiple targets become stem_01, stem_02, and so on.",
        output_policy: "openreaper_managed_render_root only.",
        collision_policy: "fail_if_exists only; overwrite and suffix fallback are forbidden.",
        max_targets: "Integer from 1 through 16.",
        dry_run: "Boolean; true returns preview only, false executes the audited render program.",
      },
      preflight_steps: [
        "Normalize canonical refs and enforce exact target-kind/ref matching.",
        "Validate managed-root-only output, fail_if_exists, max_targets, sample rate, channels, and format-specific WAV/OGG/MP3 settings.",
        "D31 resolves live targets, validates the requested filename stem, and checks every expected output/artifact collision before its first render action.",
      ],
      underlying_actions: [
        "template.project.read_dirty_state before and after the render mutation",
        "template.render.render_targets (the single audited D31 mutation executed internally)",
        "D31 internally uses REAPER project render settings, reads the native encoder setting back exactly, restores render/selection state, verifies WAV/OGG/MPEG Layer III headers plus MP3 bitrate, and emits manifest/evidence artifacts",
      ],
      readback_steps: [
        "Return the exact effective managed root before execution, then label audio outputs separately from retained recovery project copies.",
        "Return dirty-before/after plus save recommendation and require every output basename plus manifest/evidence artifact refs.",
        "Confirm the registered render stage reports render-setting and item/track-selection restoration.",
        "Do not infer success from dry-run or a partial stage; accept only the completed Macro envelope and retained evidence.",
      ],
      success_criteria: [
        "Dry-run returns the effective managed-root preview; non-dry-run executes one D31 mutation bracketed by exact dirty-state reads.",
        "The registered render dependency verifies every non-empty managed WAV/OGG/MP3 output and returns requested/actual format, bitrate, extension, absolute path, size, target identity, and compact manifest/evidence refs.",
        "No arbitrary path, overwrite, external encoder, hidden Recipe executor, raw action/Lua, shell, or UI bypass is exposed; public call_recipe remains a separate saved-revision workflow.",
      ],
      common_blockers: [
        blocker("RENDER_ROOT_NOT_READY", "The managed render root is absent, unwritable, or outside policy."),
        blocker("RENDER_TARGET_KIND_OR_REFS_INVALID", "Target kind and canonical refs do not match the strict target contract."),
        blocker("RENDER_FORMAT_SETTINGS_UNSUPPORTED", "Sample rate, channels, WAV bit depth, OGG quality, or MP3 bitrate is outside the bounded enum."),
        blocker("RENDER_OUTPUT_BASENAME_INVALID", "The requested filename stem is unsafe, includes an extension/path token, or exceeds the bounded length."),
        blocker("RENDER_OUTPUT_COLLISION", "A managed output or evidence artifact already exists and fail_if_exists rejected the whole batch before rendering."),
      ],
      recovery_steps: [
        "Repair bridge/render-root readiness through supported startup/doctor guidance, then retry the same registered Macro.",
        "Repair target_kind and refs; selected modes take no explicit refs and whole/time take no object refs.",
        "Use only the bounded WAV/OGG/MP3 settings and a fresh request identity; never bypass fail_if_exists.",
        "After a failure, inspect the D31 restoration/error evidence before retrying.",
      ],
      dry_run_shape: {
        supported: true,
        required_first: true,
        output: ["normalized_refs", "estimated_output_count", "render_settings", "effective_managed_render_root", "typed_blockers"],
      },
      resume_or_retry_policy: {
        resume_from: "fresh preview plus retained failed-child evidence",
        retry: "Retry the registered Macro only after readiness, ref, or collision repair.",
        hard_stop: "Stop on unmanaged path, overwrite request, explicit-ref mismatch, unsupported setting, or restoration failure.",
      },
      examples: [
        example("whole project WAV preview", { target_kind: "whole_project", format: "wav", output_basename: "Client Mix", sample_rate_hz: 48000, channel_count: 2, wav_bit_depth: 24, dry_run: true }),
        example("explicit region OGG plan", { target_kind: "regions", refs: ["region:index:3"], format: "ogg", ogg_quality: 0.6, collision_policy: "fail_if_exists", max_targets: 16, dry_run: false }),
        example("whole project native MP3", { target_kind: "whole_project", format: "mp3", output_basename: "Client Preview", mp3_bitrate_kbps: 320, collision_policy: "fail_if_exists", dry_run: false }),
      ],
    }),
  })
]);

const PROJECT_FILE_DEFINITION = deepFreeze(primaryDefinition({
  id: "macro.project.file",
  title: "Save project file",
  summary: "Executable save_current/save_as Macro over four accepted live-smoked project-file templates; new/open/create remain typed-held.",
  pack: "project",
  risk: "write",
  entity_kind: "macro.project.file",
  task_intents: ["save project", "save current project", "save project as"],
  rollout_slice: "3.2-C3D",
  guide_tier: "secondary",
  known_blocker: null,
  manual: actionManual({
    when_to_use: ["Execute the registered save_current or save_as program through one Macro call after the four exact atomic project-file Templates are available."],
    when_not_to_use: ["Do not use it for new, create, open, arbitrary filesystem operations, raw actions/Lua/shell/UI, or atomic overwrite=false."],
    required_readiness: ["All four exact project-file Template ids are accepted/live-smoked.", "The managed OpenReaper atomic route must be ready; the Macro executes its fixed serial program internally."],
    input_shape: {
      operation: "save_current | save_as only; new/create/open/unknown return typed blockers with zero mutation requests.",
      target_path: "Required only for save_as and forwarded unchanged to template.project.save_project_as.",
      overwrite: "Required literal true only for save_as; atomic overwrite=false remains held.",
    },
    preflight_steps: ["Read the exact current path posture, then the exact dirty state.", "save_current requires an already-named project; save_as may name an unsaved current project."],
    underlying_actions: ["template.project.read_current_project_path", "template.project.read_dirty_state", "template.project.save_current_project", "template.project.save_project_as"],
    readback_steps: ["After a successful mutation, call the exact path read and exact dirty-state read again in that order."],
    success_criteria: ["save_current requires the exact preflight path to remain unchanged and dirty state clean/raw 0; save_as requires the exact target_path and dirty state clean/raw 0."],
    common_blockers: [blocker("PROJECT_FILE_OPERATION_HELD", "new/create/open remain held and produce no mutation requests."), blocker("SAVE_AS_TARGET_PATH_REQUIRED", "save_as requires target_path."), blocker("SAVE_AS_OVERWRITE_TRUE_REQUIRED", "save_as requires explicit overwrite=true."), blocker("SAVE_CURRENT_FIELDS_REJECTED", "save_current rejects target_path and overwrite fields."), blocker("DEPENDENCY_GATE_FAILED", "A failed preflight or unsaved-project read stops before mutation.")],
    recovery_steps: ["Repair the typed input or preflight blocker, then request a fresh plan.", "For save-as filesystem/path blockers, preserve and rely on the atomic save_project_as validation; the wrapper never substitutes weaker checks."],
    dry_run_shape: { supported: true, output: ["macro_execution", "path_before", "dirty_before", "mutation_skipped", "typed_blockers"] },
    resume_or_retry_policy: { resume_from: "the latest completed stage and exact path/dirty evidence", retry: "Retry only after the typed blocker is repaired; never skip or reuse stale preflight evidence.", hard_stop: "Stop on new/create/open, overwrite other than literal true, failed dependency, or exact postflight mismatch." },
    examples: [example("save current", { operation: "save_current" }), example("save as", { operation: "save_as", target_path: "/projects/demo/demo.RPP", overwrite: true })],
  }),
}));

const CONTROLS_SET_DEFINITION = deepFreeze(primaryDefinition({
  id: "macro.controls.set",
  title: "Set bounded controls",
  summary: "Execute bounded Project/track/item/take/transport/send controls with SQLite candidate selectors, live re-resolution, and verified readback.",
  pack: "core",
  risk: "write",
  entity_kind: "macro.controls.set",
  task_intents: ["set project BPM", "set project grid", "set project snap", "set track controls", "set item controls", "set take controls", "set transport controls", "set send controls"],
  rollout_slice: "3.2.5-C",
  guide_tier: "secondary",
  known_blocker: null,
  implementation_status: "executable_registered_program",
  runnable: true,
  manual: actionManual({
    when_to_use: ["Use one task-shaped Macro call for accepted Project/track/item/take/transport/send control edits instead of hand-assembling atomic write chains."],
    when_not_to_use: ["Do not use it for MIDI note editing, FX chains, hardware/device I/O, or unsupported write domains outside the accepted control schema."],
    required_readiness: ["The managed OpenReaper live route must be ready.", "When selectors are used, rely on fresh SQLite candidates and let the Macro live-resolve the final canonical write target."],
    input_shape: {
      target_kind: "project | track | item | take | transport | send",
      fields: "Required allowlisted field object for the chosen target_kind; use exact names from the expanded discovery item.",
      selector: "Optional singular bounded Project Index selector when canonical refs are not supplied.",
      refs: "Optional top-level call_template refs: track_ref, item_ref, or send_ref as required by target_kind.",
      dry_run: "Boolean; returns planned target resolution and accepted field writes without mutating.",
    },
    preflight_steps: ["Validate target_kind and allowlisted fields.", "Resolve one exact live target from the provided ref or fresh SQLite candidate set before any write."],
    underlying_actions: ["macro.project.query for compact candidate lookup when selectors are used", "accepted atomic control templates owned by the fixed registered program", "readback templates for the affected target kind"],
    readback_steps: ["Return the resolved canonical target ref, bounded changed fields, and exact readback values in macro.execution.v1."],
    success_criteria: ["Only accepted control fields changed on one exact live-resolved target and readback matches the requested values."],
    common_blockers: [blocker("CONTROL_TARGET_REF_REQUIRED", "Non-Project macro.controls.set targets need one exact ref or one unambiguous selector."), blocker("CONTROL_TARGET_KIND_UNSUPPORTED", "target_kind must be project, track, item, take, transport, or send."), blocker("SELECTOR_TARGET_AMBIGUOUS", "The bounded selector matched more than one candidate."), blocker("CONTROL_READBACK_MISMATCH", "The post-write control readback did not match the requested values.")],
    recovery_steps: ["Use macro.project.query to narrow candidates or pass the exact canonical ref returned by a prior read.", "Repair the typed blocker, then retry the same registered Macro; never treat SQLite rows as write authority."],
    dry_run_shape: { supported: true, output: ["target_preview", "accepted_fields", "resolution_path"] },
    resume_or_retry_policy: { resume_from: "latest successful candidate set and exact target resolution", retry: "Retry after selector narrowing or live-readiness repair.", hard_stop: "Stop on repeated ambiguity, unsupported fields, or readback mismatch." },
    examples: [example("set project grid and snap", { target_kind: "project", fields: { grid_division: "1/8", grid_swing: 0.15, snap_enabled: true }, dry_run: true }), example("set track volume", { target_kind: "track", selector: { name: "Bass" }, fields: { volume: 0.75 }, dry_run: true }), example("set transport repeat", { target_kind: "transport", fields: { repeat: true }, dry_run: false })],
  }),
}));

const STOCK_PLUGIN_CONTROLS_DEFINITION = deepFreeze(primaryDefinition({
  id: "macro.set_stock_plugin_controls",
  title: "Set supported stock plugin controls",
  summary: "Execute semantic stock-plugin controls with fresh live metadata, bounded mappings, and normalized-value readback.",
  pack: "fx",
  risk: "write",
  entity_kind: "macro.set_stock_plugin_controls",
  task_intents: ["set stock plugin controls", "configure ReaComp", "apply starter stock plugin settings"],
  rollout_slice: "3.2.5-C",
  guide_tier: "secondary",
  known_blocker: null,
  implementation_status: "executable_registered_program",
  runnable: true,
  manual: actionManual({
    when_to_use: ["Use a registered semantic stock-plugin control map or starter action when the target FX already exists."],
    when_not_to_use: ["Do not treat it as an arbitrary FX editor, third-party plugin controller, chain builder, or broad live-support claim; only ReaComp currently has accepted bounded live evidence."],
    required_readiness: ["The live route must be ready and one owner-scoped fx_ref or singular selector must resolve exactly.", "The requested plugin/control mapping must exist; support wording remains bounded by per-plugin live evidence."],
    input_shape: {
      plugin: "Optional accepted stock-plugin id/name; may be omitted when starter_action fixes the plugin.",
      controls: "Semantic control names and bounded values from the accepted mapping.",
      starter_action: "Optional registered starter id such as gentle_vocal_compression.",
      action_parameters: "Optional bounded starter parameters.",
      control_overrides: "Optional bounded semantic overrides for a starter.",
      selector: "Optional singular bounded FX selector backed by fresh Project Index candidates.",
      refs: "Optional top-level call_template fx_ref when already known.",
      dry_run: "Boolean; preview supported mapping and target resolution without mutation.",
    },
    preflight_steps: ["Resolve the owner/FX target exactly, hydrating live FX metadata before any write.", "Validate every semantic control against the accepted plugin mapping and convert only through the audited normalizer."],
    underlying_actions: ["macro.project.query for compact owner candidates when selectors are used", "accepted FX read templates and semantic stock-plugin runtime helpers", "exact FX parameter readback templates"],
    readback_steps: ["Return the resolved fx_ref, normalized parameter evidence, semantic-to-parameter mapping, and bounded readback rows."],
    success_criteria: ["Only supported mapped controls changed and the final normalized readback matches the requested semantic values."],
    common_blockers: [blocker("STOCK_PLUGIN_FX_REF_REQUIRED", "Supply one owner-scoped fx_ref or one unambiguous bounded FX selector."), blocker("STOCK_PLUGIN_PLAN_BLOCKED", "The requested plugin, starter, or semantic control mapping was not accepted."), blocker("PARAMETER_METADATA_NOT_FRESH", "Fresh live parameter metadata is required before writes."), blocker("STOCK_PLUGIN_READBACK_MISMATCH", "The final parameter readback did not match the requested semantic controls.")],
    recovery_steps: ["Use macro.project.query or a direct accepted FX read to get one exact owner target, then retry the same Macro.", "If the mapping is unsupported, fall back to direct accepted FX Templates and record the typed fallback-gap reason."],
    dry_run_shape: { supported: true, output: ["supported_mapping", "target_preview", "planned_parameter_changes"] },
    resume_or_retry_policy: { resume_from: "resolved owner/fx target plus hydrated parameter metadata", retry: "Retry after target or mapping repair only.", hard_stop: "Stop on unsupported mapping or repeated readback mismatch." },
    examples: [example("gentle ReaComp starter", { starter_action: "gentle_vocal_compression", selector: { plugin_id: "reacomp", track_name: "VOX" }, dry_run: false }), example("set ReaComp controls", { plugin: "reacomp", controls: { threshold_db: -18, ratio: 3 }, selector: { plugin_id: "reacomp", track_name: "VOX" }, dry_run: true })],
  }),
}));

const MIDI_CREATE_CLIP_DEFINITION = deepFreeze(primaryDefinition({
  id: "macro.midi.create_clip",
  title: "Create bounded MIDI clip",
  summary: "Create one bounded MIDI clip on an exact or unambiguous track target, insert PPQ notes, and verify item/take readback.",
  pack: "midi",
  risk: "write",
  entity_kind: "macro.midi.create_clip",
  task_intents: ["create MIDI clip", "insert MIDI notes", "make a simple MIDI region"],
  rollout_slice: "3.2.5-D",
  guide_tier: "secondary",
  known_blocker: null,
  implementation_status: "executable_registered_program",
  runnable: true,
  manual: actionManual({
    when_to_use: ["Create one bounded PPQ-backed MIDI clip with explicit note rows on one exact target track."],
    when_not_to_use: ["Do not use it for arbitrary MIDI editing graphs, unsupported seconds-mode note insertion, or ambiguous track targeting."],
    required_readiness: ["The live route must be ready.", "Pass one exact track ref or one fresh unambiguous project-aware selector that the Macro can re-resolve live before creating the clip."],
    input_shape: {
      start_seconds: "Required clip start time in project seconds.",
      end_seconds: "Required clip end time in project seconds.",
      notes: "Bounded PPQ note rows with pitch, velocity, channel, start_ppq, and end_ppq.",
      selector: "Optional singular fresh SQLite-backed track selector instead of manual low-level ref assembly.",
      refs: "Optional top-level call_template track_ref when already known.",
      dry_run: "Boolean; performs target resolution and validation without creating the item or notes.",
    },
    preflight_steps: ["Resolve one exact live track target from ref or selector.", "Validate clip bounds and every note field before any bridge mutation."],
    underlying_actions: ["macro.project.query for track candidates when selectors are used", "template.midi.create_midi_item", "template.midi.insert_notes_batch", "accepted MIDI readback templates"],
    readback_steps: ["Return canonical item/take refs, note_count, and exact post-create/readback evidence."],
    success_criteria: ["The created item/take round-trips immediately, note readback matches the request, and no partial false-success is reported."],
    common_blockers: [blocker("MIDI_TRACK_TARGET_REQUIRED", "The MIDI clip Macro needs one exact track ref or one unambiguous selector."), blocker("MIDI_CLIP_NOTES_INVALID", "notes must contain between one and 128 valid PPQ note rows."), blocker("MIDI_SECONDS_MODE_BLOCKED", "Seconds-positioned note fields remain blocked."), blocker("MIDI_NOTE_LIST_READBACK_MISMATCH", "The exact note multiset readback did not match the request.")],
    recovery_steps: ["Use macro.project.query to get one exact track candidate or pass the returned canonical track_ref from a prior read.", "Repair the typed blocker, then retry the same Macro; do not assemble take refs manually."],
    dry_run_shape: { supported: true, output: ["track_ref", "start_seconds", "end_seconds", "note_count", "mutation_skipped"] },
    resume_or_retry_policy: { resume_from: "exact track resolution only; the clip itself must be recreated on retry", retry: "Retry after target or note repair.", hard_stop: "Stop on repeated target mismatch, blocked seconds mode, or readback mismatch." },
    examples: [example("create two-note clip", { selector: { name: "Bass MIDI" }, start_seconds: 0, end_seconds: 2, notes: [{ start_ppq: 0, end_ppq: 480, pitch: 36, velocity: 96, channel: 0 }, { start_ppq: 480, end_ppq: 960, pitch: 38, velocity: 92, channel: 0 }], dry_run: false })],
  }),
}));

const NATIVE_FX_CHAIN_DEFINITION = deepFreeze(primaryDefinition({
  id: "macro.fx.apply_native_chain",
  title: "Apply bounded native FX chain",
  summary: "Add the accepted native FX chain task, set its supported controls, and verify exact readback.",
  pack: "fx",
  risk: "write",
  entity_kind: "macro.fx.apply_native_chain",
  task_intents: ["add native FX", "apply ReaComp chain", "configure accepted FX task"],
  rollout_slice: "3.2.5-D",
  guide_tier: "secondary",
  known_blocker: null,
  implementation_status: "executable_registered_program",
  runnable: true,
  manual: actionManual({
    when_to_use: ["Apply the accepted native-FX task Macro when its reviewed chain and controls match the user intent."],
    when_not_to_use: ["Do not use it as a general FX browser, third-party plugin loader, or arbitrary chain editor."],
    required_readiness: ["The live route must be ready and one exact track target must resolve.", "Alpha3.2.5-D accepts only the reviewed ReaComp task and control set."],
    input_shape: {
      plugin: "Optional; only reacomp is accepted.",
      controls: "Optional bounded ReaComp semantic controls such as threshold_db and ratio.",
      starter_action: "Optional; only gentle_vocal_compression is accepted. It is the default when controls are omitted.",
      action_parameters: "Optional bounded parameters for the starter action.",
      control_overrides: "Optional bounded semantic overrides for the starter action.",
      selector: "Optional singular fresh Project Index track selector.",
      insert_at_index: "Optional integer FX insertion slot from 0 through 127.",
      refs: "Optional top-level call_template track_ref when already known.",
      dry_run: "Boolean; preview resolution and supported controls without mutation.",
    },
    preflight_steps: ["Resolve one exact live owner target from a ref or fresh selector.", "Validate the requested controls against the accepted native-FX task surface."],
    underlying_actions: ["macro.project.query for track candidates when selector is used", "template.fx.add_track_fx", "the registered macro.set_stock_plugin_controls semantic program", "exact FX summary/parameter readback templates"],
    readback_steps: ["Return the canonical fx_ref, applied control rows, and verification evidence in macro.execution.v1."],
    success_criteria: ["The accepted FX task is present on the expected owner target and readback matches the requested controls."],
    common_blockers: [blocker("NATIVE_FX_TRACK_REF_REQUIRED", "Supply one exact track_ref or one unambiguous bounded selector."), blocker("NATIVE_FX_PLUGIN_NOT_ACCEPTED", "Only plugin=reacomp is accepted in Alpha3.2.5-D."), blocker("NATIVE_FX_STARTER_NOT_ACCEPTED", "Only starter_action=gentle_vocal_compression is accepted."), blocker("NATIVE_FX_CONFIGURATION_UNVERIFIED", "The semantic-control child program did not return passed verification.")],
    recovery_steps: ["Use macro.project.query to get one exact owner candidate or pass the returned canonical owner ref from a prior read.", "If the task is unsupported, fall back to direct accepted FX Templates and record the typed fallback-gap reason."],
    dry_run_shape: { supported: true, output: ["owner_preview", "supported_controls", "planned_fx_changes"] },
    resume_or_retry_policy: { resume_from: "exact owner resolution and hydrated FX metadata", retry: "Retry after owner or control repair only.", hard_stop: "Stop on unsupported chain or repeated readback mismatch." },
    examples: [example("apply gentle ReaComp", { plugin: "reacomp", selector: { name: "Lead Vox" }, starter_action: "gentle_vocal_compression", dry_run: false }), example("preview ReaComp controls", { plugin: "reacomp", selector: { name: "Lead Vox" }, controls: { threshold_db: -18, ratio: 3 }, dry_run: true })],
  }),
}));

export const ALPHA3_2A_SECONDARY_MACRO_ROWS = deepFreeze([
  secondaryRow("macro.project.file", "Execute bounded save-current/save-as; new/open/create remain held.", "write_confirmed", "executable", "Expand for exact program stages, path gates, readback, and blockers."),
  secondaryRow("macro.midi.create_clip", "Create one bounded MIDI clip with verified item/take readback.", "write_evidence_bound", "executable", "Expand for exact note bounds, target resolution, and PPQ-only limits."),
  secondaryRow("macro.fx.apply_native_chain", "Apply the accepted native FX task with exact readback.", "write_evidence_bound", "executable", "Expand for owner targeting, supported controls, and fallback limits."),
  secondaryRow("macro.controls.set", "Execute bounded track/item/take/transport/send controls through one consolidated program.", "write_reversible", "executable", "Expand for target kinds, supported fields, SQLite selectors, live resolution, and readback."),
  secondaryRow("macro.set_stock_plugin_controls", "Execute semantic controls for supported stock plugins using fresh live parameter metadata.", "write_evidence_bound", "executable", "Expand for supported mappings, starter actions, and live readback requirements."),
]);

const PRIMARY_BY_ID = new Map(PRIMARY_DEFINITIONS.map((entry) => [entry.id, entry]));
const RUNTIME_BOUND_PRIMARY_MACRO_IDS = new Set(["macro.project.inspect", "macro.project.query", "macro.project.delete_targets", "macro.project.apply_layout", "macro.routing.apply", "macro.media.place_assets", "macro.render.targets"]);
const CONTRACT_ONLY_DEFINITIONS = PRIMARY_DEFINITIONS.filter((entry) => !RUNTIME_BOUND_PRIMARY_MACRO_IDS.has(entry.id));
const CONTRACT_ONLY_BY_ID = new Map(CONTRACT_ONLY_DEFINITIONS.map((entry) => [entry.id, entry]));
const SECONDARY_EXECUTABLE_DEFINITIONS = deepFreeze([
  PROJECT_FILE_DEFINITION,
  MIDI_CREATE_CLIP_DEFINITION,
  NATIVE_FX_CHAIN_DEFINITION,
  CONTROLS_SET_DEFINITION,
  STOCK_PLUGIN_CONTROLS_DEFINITION,
]);
const GUIDE_DEFINITIONS = deepFreeze([...PRIMARY_DEFINITIONS, ...SECONDARY_EXECUTABLE_DEFINITIONS]);
const GUIDE_BY_ID = new Map(GUIDE_DEFINITIONS.map((entry) => [entry.id, entry]));

export const ALPHA3_2A_CONTRACT_ONLY_MACRO_IDS = deepFreeze(CONTRACT_ONLY_DEFINITIONS.map((entry) => entry.id));
export const ALPHA3_2A_SECONDARY_MACRO_IDS = deepFreeze(ALPHA3_2A_SECONDARY_MACRO_ROWS.map((entry) => entry.id));

const ALPHA3_2A_LEGACY_TO_PRIMARY_MAPPING = deepFreeze({
  "macro.index_status": "macro.project.query",
  "macro.selected_context": "macro.project.query",
  "macro.query_tracks": "macro.project.query",
  "macro.query_items": "macro.project.query",
  "macro.query_takes": "macro.project.query",
  "macro.query_fx": "macro.project.query",
  "macro.query_routing": "macro.project.query",
  "macro.query_automation": "macro.project.query",
  "macro.query_markers": "macro.project.query",
  "macro.query_media": "macro.project.query",
  "macro.hydrate_refs": "macro.project.query",
  "macro.changed_since": "macro.project.query",
  "macro.set_track_controls": "macro.controls.set",
  "macro.set_item_controls": "macro.controls.set",
  "macro.set_take_controls": "macro.controls.set",
  "macro.set_transport_controls": "macro.controls.set",
  "macro.set_send_controls": "macro.controls.set",
});

const ALPHA3_2A_COVERED_LEGACY_IDS = deepFreeze(Object.keys(ALPHA3_2A_LEGACY_TO_PRIMARY_MAPPING));
const ALPHA3_2A_DISTINCT_LEGACY_IDS = deepFreeze([
  "macro.set_midi_controls",
]);

export const ALPHA3_2A_CONTROL_CONSOLIDATION_DEFER = deepFreeze({
  status: "accepted_executable",
  proposed_id: "macro.controls.set",
  public_runtime: true,
  public_discovery: true,
  surface: "primary_executable",
  retained_secondary_ids: ["macro.set_stock_plugin_controls"],
  consolidated_legacy_ids: [
    "macro.set_track_controls",
    "macro.set_item_controls",
    "macro.set_take_controls",
    "macro.set_transport_controls",
    "macro.set_send_controls",
  ],
  withdrawn_ids: ["macro.set_midi_controls"],
  blocker: null,
  reason: "macro.controls.set owns track/item/take/transport/send controls; old names map to it, stock-plugin semantics stay specialized, and generic MIDI is withdrawn.",
});

const COMPACT_GUIDE = deepFreeze({
  contract: ALPHA3_2A_AGENT_CONTEXT_MACRO_GUIDE_CONTRACT,
  version: ALPHA3_2A_AGENT_CONTEXT_MACRO_GUIDE_VERSION,
  phase: ALPHA3_2A_AGENT_CONTEXT_MACRO_GUIDE_PHASE,
  mode: "bounded_primary_manual_cards",
  status: "runtime_aligned",
  review_status: "truthful_12_macro_surface",
  tool_surface: {
    count: 6,
    tools: ["ping", "get_state", "list_templates", "list_recipes", "call_template", "call_recipe"],
    list_macros: false,
  },
  mental_model: {
    template: "One audited call_template operation.",
    macro: "Registered bounded task program through call_template. Published Macros execute fixed code-owned stages; project reads prefer SQLite and every write re-resolves live refs before mutation.",
    recipe: "Reusable/editable longer workflow. Save an exact revision before running or resuming it through call_recipe; unsaved drafts remain non-executable.",
  },
  ranked_executable_macro_menu: {
    macro_ids: ALPHA3_2_5_0_EXECUTABLE_TARGET_IDS,
    macros_before_templates: true,
    compact_default_menu: true,
  },
  primary_spine: {
    ordered_ids: ALPHA3_2A_PRIMARY_MACRO_IDS,
    rows: PRIMARY_DEFINITIONS.map((entry) => compactPrimaryRow(entry)),
    current_posture: "runtime_aligned_primary_manuals",
  },
  project_query_entities: ALPHA3_2A_PROJECT_QUERY_ENTITIES,
  project_file_posture: ALPHA3_2A_PROJECT_FILE_TEMPLATE_POSTURE,
  exact_expansion: {
    tool: "list_templates",
    request_shape: { ids: ["macro.project.inspect"], fields: ["id"] },
    result_path: "product_surface.agent_context_macro_guide.requested_expansions",
    behavior: "Full manuals follow requested id order here; items still obey Layer 1.5 fields/missing_ids.",
  },
  requested_expansions: emptyRequestedExpansions(),
  secondary_menu: {
    folded: true,
    rows: ALPHA3_2A_SECONDARY_MACRO_ROWS,
    expansion_hint: "Exact ids preserve item fields; executable secondary manuals expand here while covered legacy ids stay out of the default menu.",
  },
  direct_template_fallback: {
    allowed: true,
    trigger: "only_when_no_ranked_macro_covers_the_task",
    discovery_tool: "list_templates",
    request_shape: { surface: "catalog", query: "one bounded capability phrase", limit: 25 },
    typed_gap_reasons: ALPHA3_2_5_E_FALLBACK_GAP_REASONS,
    routing: "Use exact or filtered Template discovery only after recording one typed fallback-gap reason. Do not add a new tool for this atomic fallback: it does not execute a Recipe; use the public call_recipe tool separately for saved Recipe lifecycle operations. Do not use raw SQL.",
  },
  control_consolidation: ALPHA3_2A_CONTROL_CONSOLIDATION_DEFER,
  common_task_routing: [
    route("inspect project", "macro.project.inspect", "Execute one registered read Macro; it reconciles revision, uses SQLite, and returns compact project understanding."),
    route("query project index", "macro.project.query", "Execute the SQLite query directly; cold or stale scopes get one bounded automatic read-only refresh."),
    route("delete scoped objects", "macro.project.delete_targets", "Execute the confirmation-gated program with live ref resolution and absence readback; never delete source files."),
    route("apply track/folder layout", "macro.project.apply_layout", "Execute the bounded registered layout program and verify structural readback."),
    route("apply internal routing", "macro.routing.apply", "Execute the registered internal-routing program; hardware/device I/O remains blocked."),
    route("place media assets", "macro.media.place_assets", "Execute bounded probe/import/readback internally; never mutate source media files."),
    route("set controls", "macro.controls.set", "Use one target_kind plus fields; SQLite selectors and live re-resolution stay inside the program."),
    route("set supported stock plugin controls", "macro.set_stock_plugin_controls", "Use semantic controls or a starter action; the program hydrates live parameter metadata and verifies normalized readback."),
    route("create a bounded MIDI clip", "macro.midi.create_clip", "Prefer a fresh unambiguous track selector or exact track_ref; the Macro creates the item/take and verifies PPQ note readback."),
    route("apply the accepted native FX task", "macro.fx.apply_native_chain", "Prefer a fresh owner selector or owner ref; the Macro adds the accepted chain and verifies readback."),
    route("render targets", "macro.render.targets", "Execute one audited managed-root render route; no external encoder fallback."),
    route("save/save-as", "macro.project.file", "Execute the fixed path/dirty/save/readback program; new/open stay held."),
    route("recover blockers", "ping + exact guide request", "Repair typed readiness/ref/index/render blockers; no direct bridge or raw bypass path."),
    route("fallback to direct Templates", "list_templates", "Only when no ranked Macro covers the task; record a typed gap reason and request exact Template detail."),
  ],
  portfolio: {
    primary_ids: ALPHA3_2A_PRIMARY_MACRO_IDS,
    secondary_ids: ALPHA3_2A_SECONDARY_MACRO_IDS,
    executable_official_ids: ALPHA3_2_5_0_EXECUTABLE_TARGET_IDS,
    covered_legacy_ids: ALPHA3_2A_COVERED_LEGACY_IDS,
    legacy_to_primary_mapping: ALPHA3_2A_LEGACY_TO_PRIMARY_MAPPING,
    removed_legacy_ids: ALPHA3_2A_COVERED_LEGACY_IDS.filter((id) => id !== "macro.selected_context"),
    legacy_query_posture: {
      public_generic_id: "macro.project.query",
      internal_covered_ids: ALPHA3_2A_COVERED_LEGACY_IDS.filter((id) => id !== "macro.selected_context" && ALPHA3_2A_LEGACY_TO_PRIMARY_MAPPING[id] === "macro.project.query"),
      temporary_compatibility_ids: ["macro.selected_context"],
      generic_status: "executable_registered_macro_program",
    },
    distinct_legacy: {
      ids: ALPHA3_2A_DISTINCT_LEGACY_IDS,
      blockers: [
        "The generic MIDI control draft is withdrawn; use executable macro.midi.create_clip for clip creation and direct accepted Templates for uncovered MIDI edits.",
      ],
    },
    future_coverage_target: "about_80_percent_after_common_midi_fx_workloads",
    claim_boundary: "Twelve public Macros are executable; plugin/workload claims remain evidence-bounded.",
  },
  recipe_guidance: {
    empty_catalog: "If empty, use one audited template atomically; for multi-step work state ad-hoc composition and use bounded readback.",
    draft_only_catalog: "Expand drafts, follow checkpoints/risk/evidence, and do not claim official/live-smoked.",
    public_call_recipe: true,
    hidden_recipe_executor: false,
    execution: "saved_exact_revision_through_call_recipe_or_agent_orchestrated_call_template_and_get_state",
  },
  safety_boundary: {
    public_call_recipe: true,
    hidden_executor: false,
    direct_bridge_protocol: false,
    raw_lua: false,
    raw_reaper_action: false,
    shell_or_process: false,
    ui_automation: false,
    source_media_file_delete_default: false,
    hardware_or_device_io: false,
  },
});

export const ALPHA3_2A_AGENT_CONTEXT_MACRO_GUIDE = COMPACT_GUIDE;

export function createAlpha3_2AAgentContextMacroGuide({ requested_ids = [], missing_ids = [] } = {}) {
  const guide = cloneJson(COMPACT_GUIDE);
  guide.requested_expansions = createRequestedExpansions(requested_ids, missing_ids);
  return guide;
}

export function createAlpha3_2AContractMacroDiscoveryItems() {
  return CONTRACT_ONLY_DEFINITIONS.map((entry) => {
    return deepFreeze({
      id: entry.id,
      title: entry.title,
      summary: entry.summary,
      pack: entry.pack,
      lifecycle: "draft",
      risk: entry.risk,
      entity_kind: entry.entity_kind,
      tags: ["macro", "alpha3_2a", "agent_context", "contract_only", entry.pack],
      kind: "macro_contract",
      action_kind: "macro",
      macro_kind: "alpha3_2a_contract_only",
      menu_group: entry.guide_tier === "secondary" ? "secondary_contract" : "primary_spine_contract",
      execution_shape: "contract_only_non_runnable",
      user_label: entry.title,
      task_intents: entry.task_intents,
      support_status: "contract_only_non_runnable",
      support_state: "blocked",
      exists_in_catalog: false,
      live_runnable_now: false,
      evidence_level: "contract_only",
      known_blocker: entry.known_blocker,
      allowed_live_group: null,
      guide_contract: ALPHA3_2A_AGENT_CONTEXT_MACRO_GUIDE_CONTRACT,
      guide_version: ALPHA3_2A_AGENT_CONTEXT_MACRO_GUIDE_VERSION,
      guide_tier: entry.guide_tier,
      inputSchema: {
        type: "object",
        description: "Future macro input shape. This Alpha3.2-A entry is contract-only and cannot be executed through call_template.",
        additionalProperties: true,
        properties: Object.fromEntries(Object.keys(entry.manual.input_shape).map((field) => [field, { description: entry.manual.input_shape[field] }])),
      },
      outputSchema: {
        type: "object",
        description: "Future bounded macro result. No runtime result exists before the named Alpha3.2 implementation slice.",
      },
      examples: entry.manual.examples.map((item) => ({ name: item.name, input: item.input, expected: "contract_only_non_runnable" })),
      expectedDelta: {
        kind: "none",
        summary: "Discovery/manual contract only; call_template must reject this id until a later accepted implementation binds it.",
      },
      example_call_shape: {
        discovery_tool: "list_templates",
        discovery_request: { ids: [entry.id] },
        call_template: "not_available",
        blocker: entry.known_blocker,
      },
      output_summary_shape: {
        current: renderPending ? "plan_preview_and_child_guidance_only" : "action_manual_only",
        future: "bounded macro result with refs/readback/blockers after the named implementation slice",
      },
    });
  });
}

export function isAlpha3_2AContractOnlyMacroId(id) {
  return CONTRACT_ONLY_BY_ID.has(id);
}

export function alpha3_2AContractOnlyBlockerForId(id) {
  return CONTRACT_ONLY_BY_ID.get(id)?.known_blocker ?? null;
}

export function createAlpha3_2AExactMacroExpansion(id) {
  const contractEntry = GUIDE_BY_ID.get(id);
  if (!contractEntry) return null;
  return cloneJson({
    id,
    contract: ALPHA3_2A_REQUESTED_EXPANSIONS_CONTRACT,
    guide_contract: ALPHA3_2A_AGENT_CONTEXT_MACRO_GUIDE_CONTRACT,
    guide_version: ALPHA3_2A_AGENT_CONTEXT_MACRO_GUIDE_VERSION,
    guide_tier: contractEntry.guide_tier,
    implementation_status: id === "macro.project.file" ? "executable" : contractEntry.implementation_status,
    runnable: id === "macro.project.file" ? true : contractEntry.runnable,
    rollout_slice: contractEntry.rollout_slice,
    action_manual: contractEntry.manual,
  });
}

export function attachAlpha3_2AAgentContextProductMetadata(response) {
  if (!isPlainObject(response)) return response;
  const requestedIds = response.mode === "ids" && Array.isArray(response.applied?.ids)
    ? response.applied.ids
    : [];
  const missingIds = Array.isArray(response.missing_ids) ? response.missing_ids : [];
  return deepFreeze({
    ...response,
    product_surface: {
      ...(isPlainObject(response.product_surface) ? response.product_surface : {}),
      agent_context_macro_guide: createAlpha3_2AAgentContextMacroGuide({
        requested_ids: requestedIds,
        missing_ids: missingIds,
      }),
    },
  });
}

export function alpha3_2APrimaryManual(id) {
  const entry = PRIMARY_BY_ID.get(id);
  return entry ? cloneJson(entry.manual) : null;
}

function primaryDefinition({
  id,
  title,
  summary,
  pack,
  risk,
  entity_kind,
  task_intents,
  rollout_slice,
  manual,
  guide_tier = "primary",
  known_blocker = CONTRACT_ONLY_BLOCKER,
  implementation_status = "contract_only_non_runnable",
  runnable = false,
}) {
  return {
    id,
    title,
    summary,
    pack,
    risk,
    entity_kind,
    task_intents,
    rollout_slice,
    manual,
    guide_tier,
    known_blocker,
    implementation_status,
    runnable,
  };
}

function actionManual(fields) {
  return fields;
}

function compactPrimaryRow(entry) {
  return {
    id: entry.id,
    purpose: entry.summary,
    safety_tier: entry.risk,
    implementation_status: entry.implementation_status,
    rollout_slice: entry.rollout_slice,
    action_manual: compactActionManual(entry.id, entry.manual),
    expand: { tool: "list_templates", ids: [entry.id], result: "requested_expansions" },
  };
}

function compactPrimaryUnderlyingActions(id) {
  return ({
    "macro.project.inspect": ["template.project.read_summary", "template.project.create_observation_bundle", "template.project.read_dirty_state", "template.render.read_settings"],
    "macro.project.query": ["template.project.read_summary", "template.project.create_observation_bundle", "entity-specific accepted read templates", "SQLite query runtime"],
    "macro.project.delete_targets": ["template.tracks.delete_tracks", "template.items.delete_items", "template.project.delete_marker", "template.project.delete_region", "template.fx.delete_fx"],
    "macro.project.apply_layout": ["template.tracks.list_tracks", "template.tracks.create_folder_track", "template.tracks.create_track", "template.project.create_marker", "template.project.create_region", "template.project.list_markers_regions"],
    "macro.routing.apply": ["template.routing.read_project_routing_graph", "template.routing.create_track_send", "template.routing.set_send_volume", "template.routing.remove_send", "template.routing.read_track_routing"],
    "macro.media.place_assets": ["template.media.probe_file", "template.tracks.resolve_track_ref", "template.media.import_file_to_track", "template.items.read_item_summary"],
    "macro.render.targets": ["template.project.read_dirty_state", "template.render.render_targets"],
  })[id] ?? null;
}

function compactActionManual(id, manual) {
  const firstExample = manual.examples[0] ?? null;
  return {
    when_to_use: compactText(manual.when_to_use[0], 88),
    when_not_to_use: compactText(manual.when_not_to_use[0], 72),
    required_readiness: compactText(manual.required_readiness.slice(0, 2).join("; "), 100),
    input_shape: Object.keys(manual.input_shape),
    preflight_steps: compactText(manual.preflight_steps.slice(0, 2).map((step, index) => `${index + 1}) ${step}`).join(" "), 116),
    underlying_actions: compactPrimaryUnderlyingActions(id) ?? compactUnderlyingActions(manual.underlying_actions),
    readback_steps: compactText(manual.readback_steps[0], 82),
    success_criteria: compactText(manual.success_criteria[0], 82),
    common_blockers: manual.common_blockers.map((entry) => entry.code),
    recovery_steps: compactText(manual.recovery_steps.slice(0, 2).join("; "), 104),
    dry_run_shape: {
      supported: manual.dry_run_shape.supported,
      required_first: manual.dry_run_shape.required_first,
      output: Array.isArray(manual.dry_run_shape.output) ? manual.dry_run_shape.output.slice(0, 3) : [],
    },
    resume_or_retry_policy: {
      retry: compactText(manual.resume_or_retry_policy.retry, 52),
      hard_stop: compactText(manual.resume_or_retry_policy.hard_stop, 52),
    },
    examples: {
      requested_expansion: true,
      names: firstExample === null ? [] : [firstExample.name],
    },
  };
}

function compactUnderlyingActions(actions) {
  const ids = [];
  for (const action of actions) {
    const matches = action.match(/(?:template|macro)\.[a-z0-9_]+(?:\.[a-z0-9_]+)+/g) ?? [];
    for (const id of matches) {
      if (!ids.includes(id)) ids.push(id);
      if (ids.length >= 4) return ids;
    }
  }
  return ids.length > 0 ? ids : actions.slice(0, 3).map((action) => compactText(action, 72));
}

function createRequestedExpansions(requestedIds, missingIds) {
  const ids = Array.isArray(requestedIds) ? requestedIds.filter((id) => typeof id === "string") : [];
  const missing = Array.isArray(missingIds) ? missingIds.filter((id) => typeof id === "string") : [];
  return {
    contract: ALPHA3_2A_REQUESTED_EXPANSIONS_CONTRACT,
    version: ALPHA3_2A_AGENT_CONTEXT_MACRO_GUIDE_VERSION,
    mode: ids.length > 0 ? "ids" : "none",
    requested_ids: ids,
    items: ids.map((id) => createAlpha3_2AExactMacroExpansion(id)).filter(Boolean),
    missing_ids: missing,
  };
}

function emptyRequestedExpansions() {
  return {
    contract: ALPHA3_2A_REQUESTED_EXPANSIONS_CONTRACT,
    version: ALPHA3_2A_AGENT_CONTEXT_MACRO_GUIDE_VERSION,
    mode: "none",
    requested_ids: [],
    items: [],
    missing_ids: [],
  };
}

function compactText(value, maxChars) {
  if (typeof value !== "string") return value;
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function secondaryRow(id, purpose, safety_tier, status, when_to_expand) {
  return {
    id,
    surface: "secondary_on_demand",
    purpose: compactText(purpose, 30),
    safety_tier,
    status: ({
      contract_only: "contract",
      compatibility_blocked: "blocked",
    })[status] ?? status,
    when_to_expand: compactText(when_to_expand, 36),
  };
}

function route(task, recommended, current_path) {
  return {
    task,
    recommended,
    current_path: compactText(current_path, 60),
  };
}

function blocker(code, summary) {
  return { code, summary };
}

function example(name, input) {
  return { name, input };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
