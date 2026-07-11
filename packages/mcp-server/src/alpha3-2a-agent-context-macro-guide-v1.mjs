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
  current_write_boundary: "The two exact save templates are accepted/live-smoked under explicit overwrite=true save-as authorization; macro.project.file and new-project creation remain held, and atomic overwrite=false remains future.",
});

const CONTRACT_ONLY_BLOCKER = "contract_only_pending_alpha3_2_c_d_e_implementation";
const PROJECT_FILE_BLOCKER = "project_file_macro_held_new_project_unimplemented";

const PRIMARY_DEFINITIONS = deepFreeze([
  primaryDefinition({
    id: "macro.project.inspect",
    title: "Inspect current project",
    summary: "Return compact project identity, selection, entity rows, canonical refs, and readiness flags.",
    pack: "project",
    risk: "read",
    entity_kind: "macro.project.inspect",
    task_intents: ["inspect project", "show selected context", "check project readiness"],
    rollout_slice: "3.2-C/E",
    manual: actionManual({
      when_to_use: [
        "Inspect accepted identity/selection/refs plus the accepted exact project path and dirty-state reads.",
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
        include: "Optional ordered subset of project_identity, project_path, dirty_state, selected_context, tracks, folders, items, markers_regions, render, and index posture.",
        fields: "Optional compact field selection applied to returned rows.",
        limit: "Positive bounded row limit per requested entity family.",
        compact_response: "Boolean; defaults true and never enables full descriptor or project dumps.",
        ref_policy: "canonical_only | include_missing_reasons; never fabricate refs.",
      },
      preflight_steps: [
        "Read server/bridge readiness without starting REAPER or using direct bridge files.",
        "Validate include, fields, limit, compact_response, and ref_policy.",
        "Read accepted project identity, then use the exact accepted path and dirty-state templates before resolving selected or listed objects.",
      ],
      underlying_actions: [
        "template.project.read_summary",
        "template.project.read_metadata",
        "template.project.read_track_item_overview",
        "template.tracks.list_tracks",
        "template.tracks.read_folder_structure",
        "template.items.list_selected_items",
        "template.project.list_markers_regions",
        "template.render.read_settings",
        "compatibility helper macro.index_status when index readiness is requested",
        "template.project.read_current_project_path",
        "template.project.read_dirty_state",
      ],
      readback_steps: [
        "Normalize every returned object ref into one consistent compact row location.",
        "Report accepted title/identity, exact path/path_state, exact dirty/raw state, and bridge/render/index readiness.",
        "Return truncation and missing-ref reasons instead of silently dropping rows.",
      ],
      success_criteria: [
        "The response identifies current project context and may report path and dirty state only from the two exact accepted reads.",
        "Requested rows are bounded, ordered, and carry canonical refs when resolvable.",
        "No write, render, project save, or hidden recipe execution occurred.",
      ],
      common_blockers: [
        blocker("CONTRACT_ONLY", "This Alpha3.2-A entry is a discovery contract and is not callable yet."),
        blocker("PROJECT_FILE_MACRO_HELD", "All four exact project-file templates are accepted/live-smoked; macro.project.file and new-project creation remain held."),
        blocker("BRIDGE_NOT_READY", "Live project identity or entity reads are unavailable."),
        blocker("STALE_REF_GENERATION", "A selected or listed ref belongs to an older project generation."),
        blocker("RESPONSE_BUDGET_EXCEEDED", "The requested include/fields/limit shape is too broad."),
      ],
      recovery_steps: [
        "For CONTRACT_ONLY, use the named audited read templates or existing compatibility macros until 3.2-C/E binds this macro.",
        "For bridge readiness, use ping/startup guidance; never write direct bridge request files.",
        "For stale refs, rerun project identity and selected/list reads, then discard prior-generation refs.",
        "For budget errors, reduce include families, fields, or limit and retry from the project-identity checkpoint.",
      ],
      dry_run_shape: {
        supported: true,
        behavior: "Inspection is read-only; dry-run returns the same planned include families and estimated row caps without project mutation.",
        output: ["planned_reads", "estimated_row_caps", "readiness_checks", "typed_blockers"],
      },
      resume_or_retry_policy: {
        resume_from: "latest project-identity read for the same bridge owner/generation",
        retry: "Retry once after readiness or budget repair; refresh refs after any project-generation change.",
        hard_stop: "Stop after the same typed blocker repeats twice.",
      },
      examples: [
        example("compact readiness", { include: ["project_identity", "selected_context", "render", "index", "project_path", "dirty_state"], fields: ["id", "name", "ref", "status"], limit: 25, compact_response: true, ref_policy: "canonical_only" }),
        example("tracks and folders", { include: ["tracks", "folders"], fields: ["name", "ref", "parent_ref", "depth"], limit: 100, compact_response: true }),
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
    rollout_slice: "3.2-D/E",
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
        "The Project Index store must be reachable or return INDEX_NOT_READY with a recoverable refresh route.",
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
        "Apply refresh_policy and run only accepted read templates when refresh is required.",
      ],
      underlying_actions: [
        "macro.index_status",
        "macro.selected_context",
        "macro.query_tracks",
        "macro.query_items",
        "macro.query_takes",
        "macro.query_fx",
        "macro.query_routing",
        "macro.query_automation",
        "macro.query_markers",
        "macro.query_media",
        "macro.changed_since",
        "macro.hydrate_refs",
        "accepted REAPER read templates returned by the Project Index refresh plan",
      ],
      readback_steps: [
        "Validate that returned rows match the current project/session and requested entity.",
        "Return freshness, coverage, cursor, truncation, and hydration posture with every page.",
        "When refs are hydrated, mark failures per row and never fabricate missing refs.",
      ],
      success_criteria: [
        "The response contains a bounded page of rows or an explicit empty result.",
        "Freshness and coverage are stated, and any hydrated refs are current and canonical.",
        "No raw SQL, direct database write, REAPER mutation, or hidden executor was used.",
      ],
      common_blockers: [
        blocker("CONTRACT_ONLY", "The consolidated query macro is not callable until 3.2-D/E."),
        blocker("INDEX_NOT_READY", "The project index is missing, stale, or bound to another session."),
        blocker("ENTITY_NOT_SUPPORTED", "The selected entity or field set is not in the bounded query schema."),
        blocker("REF_HYDRATION_UNAVAILABLE", "Live read support is unavailable for requested ref hydration."),
      ],
      recovery_steps: [
        "For CONTRACT_ONLY, use the exact existing macro.index_status/query_*/changed_since/hydrate_refs compatibility ids.",
        "For INDEX_NOT_READY, run the returned read-only refresh requests and retry with the new freshness token.",
        "For unsupported fields, request a smaller allowlisted projection instead of raw SQL.",
        "For hydration failure, keep candidate rows, disable hydrate_refs, or restore bridge readiness before retrying.",
      ],
      dry_run_shape: {
        supported: true,
        behavior: "Returns the normalized query, freshness decision, planned refresh reads, estimated page cap, and whether hydration would be attempted.",
        output: ["normalized_query", "freshness_decision", "refresh_plan", "estimated_rows", "typed_blockers"],
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
    summary: "Preview and delete only explicitly scoped project objects with undo evidence and absence readback.",
    pack: "project",
    risk: "destructive",
    entity_kind: "macro.project.delete_targets",
    task_intents: ["delete tracks", "delete items", "delete markers or regions", "scoped cleanup"],
    rollout_slice: "3.2-E",
    manual: actionManual({
      when_to_use: [
        "Delete an explicit bounded set of project-owned tracks, items, markers, or regions after preview and confirmation.",
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
        refs: "Explicit canonical project-object refs grouped by kind.",
        selectors: "Optional bounded query-derived selectors; must resolve to exact refs before execution.",
        dry_run: "Boolean; true by default and required for first pass.",
        confirm_scope: "Explicit confirmation token or object containing target kinds and expected counts.",
        delete_policy: "project_objects_only; filesystem deletion is not accepted.",
        compact_response: "Boolean; returns counts and bounded failure rows.",
      },
      preflight_steps: [
        "Inspect the current project and resolve every supplied/query-derived target to a canonical current-generation ref.",
        "Reject duplicate, stale, cross-project, filesystem, hardware, unsupported take, and unsupported automation targets.",
        "Return a dry-run preview with counts by kind, skipped refs, and exact confirmation scope.",
      ],
      underlying_actions: [
        "template.tracks.delete_track or template.tracks.delete_tracks",
        "template.items.delete_item or template.items.delete_items",
        "template.project.delete_marker",
        "template.project.delete_region",
        "matching accepted list/read templates for preflight and absence readback",
      ],
      readback_steps: [
        "Re-read each affected scope and prove targeted refs are absent or report surviving refs.",
        "Return deleted/skipped/failed counts and bounded per-ref reasons.",
        "Retain request ids and undo evidence for successfully executed destructive calls.",
      ],
      success_criteria: [
        "Only previewed and confirmed project objects were deleted.",
        "Absence readback matches the deleted count, with exact skipped/failed rows reported.",
        "No source file, hardware route, or unsupported object family was deleted.",
      ],
      common_blockers: [
        blocker("CONTRACT_ONLY", "The destructive macro is not callable until bounded 3.2-E implementation and evidence."),
        blocker("CONFIRM_SCOPE_REQUIRED", "The exact previewed target set has not been confirmed."),
        blocker("STALE_OR_AMBIGUOUS_TARGET", "A target is missing, stale, duplicated, or cross-project."),
        blocker("FILESYSTEM_DELETE_FORBIDDEN", "The request would delete media files from disk."),
        blocker("TARGET_KIND_UNSUPPORTED", "Take or automation deletion lacks an accepted audited template."),
      ],
      recovery_steps: [
        "For CONTRACT_ONLY, use an exact accepted delete template only after explicit user approval and matching readback.",
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
        example("confirmed marker cleanup", { refs: { markers: ["marker:project:12"] }, dry_run: false, confirm_scope: { target_kinds: ["marker"], expected_counts: { marker: 1 } }, delete_policy: "project_objects_only" }),
      ],
    }),
  }),
  primaryDefinition({
    id: "macro.project.apply_layout",
    title: "Apply track and folder layout",
    summary: "Create or update a declared folder/track hierarchy, colors, order, and nesting with structural readback.",
    pack: "tracks",
    risk: "write",
    entity_kind: "macro.project.apply_layout",
    task_intents: ["build folder layout", "create tracks", "organize track order", "apply colors"],
    rollout_slice: "3.2-E",
    manual: actionManual({
      when_to_use: [
        "Apply an explicit JSON layout of folder tracks and child tracks to the current project.",
        "Reconcile an existing track structure using an explicit matching policy.",
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
        layout: "Ordered folders/tracks with local ids, names, colors, children, and optional desired refs.",
        match_policy: "by_ref | exact_name | create_only; ambiguous matches are blocked.",
        conflict_policy: "skip | update_declared_fields | stop; no implicit delete.",
        dry_run: "Boolean; previews create/update/move/nesting actions.",
        compact_response: "Boolean; returns bounded created/updated/skipped/mismatch rows.",
      },
      preflight_steps: [
        "Read existing tracks and folder structure.",
        "Validate layout acyclicity, unique local ids, color/name bounds, and deterministic order.",
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
      ],
      readback_steps: [
        "Read tracks and folder structure after writes.",
        "Map each declared local id to a canonical track ref and actual position/depth.",
        "Report any name, color, order, parent, or folder-depth mismatch.",
      ],
      success_criteria: [
        "Every declared row is created or matched according to policy and has a canonical ref.",
        "Actual order, nesting, names, and declared colors match the requested layout.",
        "Unmatched existing tracks remain unchanged unless an explicit accepted action covered them.",
      ],
      common_blockers: [
        blocker("CONTRACT_ONLY", "The layout macro is not callable until 3.2-E."),
        blocker("LAYOUT_INVALID", "The layout contains duplicate ids, cycles, invalid nesting, or invalid fields."),
        blocker("MATCH_AMBIGUOUS", "More than one existing track matches a declared row."),
        blocker("READBACK_MISMATCH", "The resulting folder depth/order differs from the declared layout."),
      ],
      recovery_steps: [
        "For CONTRACT_ONLY, run individual accepted track/folder templates with readback after each bounded change.",
        "Fix invalid/ambiguous rows and rerun dry-run; do not guess a match.",
        "On partial success, keep the returned local-id-to-ref map, reread structure, and plan only remaining mismatches.",
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
      ],
    }),
  }),
  primaryDefinition({
    id: "macro.routing.apply",
    title: "Apply internal project routing",
    summary: "Preview and apply declared internal sends, master-parent posture, channels, and bounded send controls.",
    pack: "routing",
    risk: "write",
    entity_kind: "macro.routing.apply",
    task_intents: ["create sends", "update routing", "route tracks", "inspect routing graph"],
    rollout_slice: "3.2-E",
    manual: actionManual({
      when_to_use: [
        "Create or update explicit internal track-to-track routes and related bounded send settings.",
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
        routes: "Ordered routing patch rows with source/target refs or bounded selectors and optional volume, pan, mute, mode, audio/MIDI channels.",
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
        blocker("CONTRACT_ONLY", "The routing macro is not callable until 3.2-E."),
        blocker("HARDWARE_IO_FORBIDDEN", "A route targets hardware/device I/O."),
        blocker("ROUTE_AMBIGUOUS_OR_FEEDBACK", "Source/target resolution or feedback posture is unsafe."),
        blocker("ROUTE_DELETE_NOT_AUDITED", "A requested route deletion lacks an accepted audited template."),
        blocker("READBACK_MISMATCH", "Actual routing differs from the confirmed patch."),
      ],
      recovery_steps: [
        "For CONTRACT_ONLY, use exact accepted routing templates for one route at a time with graph readback.",
        "Remove hardware/external endpoints and replace ambiguous selectors with canonical refs.",
        "Omit unaudited delete rows; report them as blocked rather than emulating deletion through another surface.",
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
        hard_stop: "Stop on hardware I/O, unsafe feedback, unaudited deletion, or repeated graph mismatch.",
      },
      examples: [
        example("create reverb send", { routes: [{ source_ref: "track:guid:{VOCAL}", target_ref: "track:guid:{VERB}", volume: 0.5, pan: 0, mute: false }], dry_run: true, readback_policy: "changed_routes_only" }),
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
        blocker("CONTRACT_ONLY", "The general media placement macro is not callable until 3.2-E."),
        blocker("PATH_INVALID_OR_UNREADABLE", "A source path is missing, inaccessible, or unsupported."),
        blocker("TARGET_TRACK_AMBIGUOUS", "The requested target track cannot be resolved exactly."),
        blocker("PLACEMENT_COLLISION", "The requested placement/collision policy cannot produce deterministic positions."),
        blocker("RESPONSE_BUDGET_EXCEEDED", "The asset batch or readback is too large."),
      ],
      recovery_steps: [
        "For CONTRACT_ONLY, use probe/import/readback templates for a bounded asset subset.",
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
    summary: "Resolve common render target sets, apply bounded format/naming/output policy, render, and verify files/artifacts.",
    pack: "render",
    risk: "write",
    entity_kind: "macro.render.targets",
    task_intents: ["render wav", "render region ogg", "render selected items", "export project"],
    rollout_slice: "3.2-B/E",
    manual: actionManual({
      when_to_use: [
        "Render the whole project, time selection, regions, selected/explicit items, or selected/explicit tracks through one bounded entry contract.",
        "Require deterministic format, output-root, naming, collision, manifest, and verification behavior.",
      ],
      when_not_to_use: [
        "Do not render to an arbitrary unmanaged path or silently fall back to external encoders/processes.",
        "Do not claim peak/LUFS analysis unless an accepted analysis template produced that evidence.",
      ],
      required_readiness: [
        "Render root readiness must pass independently from bridge readiness.",
        "Target refs/selectors and bounds must resolve exactly before changing render settings.",
        "Format/sample-rate/channel/codec and collision policy must be accepted and bounded.",
      ],
      input_shape: {
        targets: "whole_project | time_selection | selected_items | explicit_items | selected_tracks | explicit_tracks | regions | matching_names with exact selectors/refs.",
        format: "wav | ogg | mp3 | flac | aiff | m4a | opus when accepted by the bounded runtime.",
        sample_rate: "Optional accepted positive sample rate.",
        channel_count: "Optional accepted channel count.",
        codec: "Optional quality/bitrate/compression object appropriate to the selected format.",
        naming_policy: "Preserve region names or apply a bounded deterministic pattern.",
        collision_policy: "fail | unique_suffix | explicit_overwrite_confirmation.",
        output_policy: "Managed render root plus optional relative directory; never arbitrary traversal.",
        sidecar_manifest: "Boolean.",
        analysis_policy: "none | basic_metadata | accepted_analysis_only.",
        dry_run: "Boolean; resolves targets/output paths without rendering.",
      },
      preflight_steps: [
        "Check render-root configuration, writability, managed-path containment, and collision posture.",
        "Resolve the exact target set and bounds; return empty/ambiguous selection as typed blockers.",
        "Choose the accepted render route per target kind and validate format/sample-rate/channel/codec options.",
      ],
      underlying_actions: [
        "template.render.read_settings",
        "template.render.resolve_bounds",
        "template.render.preview_targets",
        "template.render.read_region_matrix when regions are requested",
        "template.render.set_render_format and template.render.set_render_sample_rate as needed",
        "template.render.set_ogg_quality_or_compression or other accepted format-specific setting templates",
        "template.render.render_region_wav, render_item, render_selected_item, render_track_item, render_selected_tracks, render_ogg/mp3/flac/aiff/m4a/opus according to target/format",
        "template.render.output_absolute_path and template.render.output_file_metadata",
        "template.render.create_delivery_report when a sidecar/report is requested",
        "accepted analysis templates only when analysis_policy requests supported evidence",
      ],
      readback_steps: [
        "Verify every expected output path exists under the managed render root and collect basic file metadata.",
        "Match output count/names/durations to the resolved target set and collision policy.",
        "Return rendered files, artifact refs, warnings, failed targets, and manifest/report refs when requested.",
      ],
      success_criteria: [
        "Every successful target has a verified managed output file with basic metadata.",
        "Output names, format, sample rate/channel posture, and collision handling match the request.",
        "No unmanaged encoder, shell/process fallback, unsupported analysis claim, or hidden executor was used.",
      ],
      common_blockers: [
        blocker("CONTRACT_ONLY", "The universal render macro is not callable until 3.2-B/E."),
        blocker("RENDER_ROOT_NOT_READY", "The managed render root is absent, unwritable, or outside policy."),
        blocker("TARGET_SET_EMPTY_OR_AMBIGUOUS", "Render targets or bounds cannot be resolved exactly."),
        blocker("FORMAT_OR_CODEC_UNSUPPORTED", "The selected format/options lack an accepted route."),
        blocker("OUTPUT_COLLISION", "An existing output conflicts with the selected collision policy."),
        blocker("OUTPUT_VERIFICATION_FAILED", "Expected rendered files or metadata do not match readback."),
      ],
      recovery_steps: [
        "For CONTRACT_ONLY, select the exact accepted render template matching one target/format and verify output metadata.",
        "Repair render-root configuration through supported startup/doctor guidance; do not choose an unmanaged fallback.",
        "Replace ambiguous selectors with explicit refs or establish a valid time selection/region set.",
        "Change to an accepted format/collision policy, or request explicit overwrite confirmation when supported.",
        "On partial output, preserve verified files and retry only failed targets with deterministic names.",
      ],
      dry_run_shape: {
        supported: true,
        required_first_for_overwrite: true,
        output: ["resolved_targets", "resolved_bounds", "planned_render_routes", "planned_output_paths", "collisions", "estimated_output_count", "typed_blockers"],
      },
      resume_or_retry_policy: {
        resume_from: "verified output manifest plus failed-target rows",
        retry: "Retry only failed targets after render-root/format/collision repair; preserve deterministic naming.",
        hard_stop: "Stop on unmanaged output path, unsupported encoder fallback, repeated collision, or verification mismatch.",
      },
      examples: [
        example("current project WAV", { targets: { kind: "whole_project" }, format: "wav", sample_rate: 48000, channel_count: 2, naming_policy: { pattern: "{project}" }, collision_policy: "fail", output_policy: { root: "managed", directory: "mixes" }, sidecar_manifest: true, analysis_policy: "basic_metadata", dry_run: true }),
        example("named region OGG", { targets: { kind: "regions", refs: ["region:project:3"] }, format: "ogg", codec: { quality: 0.7 }, naming_policy: { preserve_region_names: true }, collision_policy: "unique_suffix", output_policy: { root: "managed", directory: "regions" }, sidecar_manifest: true, analysis_policy: "none", dry_run: false }),
        example("selected items OGG", { targets: { kind: "selected_items", one_file_per_item: true }, format: "ogg", sample_rate: 48000, channel_count: 2, naming_policy: { pattern: "{item_name}" }, collision_policy: "unique_suffix", output_policy: { root: "managed", directory: "items" }, sidecar_manifest: false, analysis_policy: "basic_metadata", dry_run: false }),
      ],
    }),
  }),
]);

const PROJECT_FILE_DEFINITION = deepFreeze(primaryDefinition({
  id: "macro.project.file",
  title: "Create or save project file",
  summary: "Secondary held macro contract: all four exact project-file templates are accepted/live-smoked, while macro execution and new-project creation remain held.",
  pack: "project",
  risk: "write",
  entity_kind: "macro.project.file",
  task_intents: ["save project", "save project as", "create new project", "read project path"],
  rollout_slice: "3.2-C",
  guide_tier: "secondary",
  known_blocker: PROJECT_FILE_BLOCKER,
  manual: actionManual({
    when_to_use: ["Inspect accepted project path and dirty state, or call the exact accepted/live-smoked save templates while the macro itself remains held."],
    when_not_to_use: ["Do not call save_project_as without explicit overwrite=true race authorization, even when the target appears absent; atomic no-clobber is held future.", "Do not use arbitrary filesystem operations or raw UI automation."],
    required_readiness: ["All four exact project-file template ids are accepted/live-smoked.", "save_project_as must pass absolute .RPP, non-root/non-home real writable parent, symlink, target type, and explicit overwrite=true race authorization before bridge dispatch.", "New-project creation remains held and is not substituted by save-as."],
    input_shape: {
      operation: "new | save | save_as",
      path: "Required for save_as; validated project-file path only.",
      overwrite_policy: "explicit_confirmed_overwrite only; overwrite=true is required even when the target is absent because atomic no-clobber is held future.",
      unsaved_changes_policy: "save_current | explicit_discard_confirmation | stop.",
      dry_run: "Boolean; validates posture without creating/saving.",
    },
    preflight_steps: ["Use the exact accepted path and dirty-state reads before mutation.", "For save-as, validate the absolute .RPP target, non-root/non-home real writable parent, symlink chain, target type, and explicit overwrite=true race authorization before dispatch.", "Keep new-project requests held and return exact confirmation requirements before overwrite."],
    underlying_actions: ["template.project.read_current_project_path", "template.project.read_dirty_state", "template.project.save_current_project", "template.project.save_project_as", "held: new-project creation", "current accepted project summary/metadata reads are identity context only and do not substitute for the two exact reads"],
    readback_steps: ["Use exact before/after path and raw dirty-state readback from each save handler.", "Report both save templates as accepted/live-smoked with explicit overwrite=true save-as authorization.", "Report render-readiness impact only from audited project-file evidence."],
    success_criteria: ["Current Alpha3.2-C3BC posture means four accepted/live-smoked atomic project-file templates and a held macro/new-project route are reported accurately.", "Execution success requires exact path plus clean/raw-zero readback and explicit overwrite=true authorization for the preflight-to-REAPER race; atomic overwrite=false remains held future."],
    common_blockers: [blocker("UNSAVED_PROJECT", "save_current_project refuses an unnamed project and never opens Save As UI."), blocker("PATH_INVALID", "The requested path fails validation or containment."), blocker("PERMISSION_DENIED", "The target parent is not writable."), blocker("OVERWRITE_TRUE_REQUIRED", "save_project_as requires explicit overwrite=true even for an absent target; atomic no-clobber is held future."), blocker("UNSAVED_PROJECT_POLICY_REQUIRED", "A new/open operation would discard dirty state without policy.")],
    recovery_steps: ["For UNSAVED_PROJECT, use save_project_as only with a validated explicit target; do not trigger Save As UI.", "Choose a valid writable path or create the parent through an approved external user action.", "Authorize overwrite=true explicitly after reviewing the target and race posture, then rerun preflight; do not claim atomic no-clobber."],
    dry_run_shape: { supported: true, output: ["planned_project_file_posture", "validated_target_path", "existing_target_posture", "required_confirmations", "render_readiness_impact", "typed_blockers"] },
    resume_or_retry_policy: { resume_from: "exact handler readback after typed failure; macro.project.file remains held", retry: "Retry only after an unsaved-project, path, permission, symlink, target-type, overwrite, or verification blocker is repaired.", hard_stop: "Stop on overwrite other than explicit true, requests for atomic no-clobber, new-project requests, or missing audited template." },
    examples: [example("save as", { operation: "save_as", path: "/projects/demo/demo.RPP", overwrite_policy: "explicit_confirmed_overwrite", unsaved_changes_policy: "save_current", dry_run: true })],
  }),
}));

export const ALPHA3_2A_SECONDARY_MACRO_ROWS = deepFreeze([
  secondaryRow("macro.project.file", "Held macro over four accepted/live-smoked atomic project-file templates; new-project remains unavailable.", "write_confirmed", "contract_only", "Expand for exact atomic save guidance without treating the macro as executable."),
  secondaryRow("macro.index_status", "Read Project Index readiness, freshness, and refresh needs.", "read", "compatibility_plan_only", "Expand when diagnosing INDEX_NOT_READY before macro.project.query is implemented."),
  secondaryRow("macro.selected_context", "Read current selected project context and candidate refs.", "read", "compatibility_plan_only", "Expand when selected context is needed before macro.project.inspect is implemented."),
  secondaryRow("macro.query_tracks", "Query indexed track rows.", "read", "compatibility_plan_only", "Expand for current track-index behavior or migration compatibility."),
  secondaryRow("macro.query_items", "Query indexed item rows.", "read", "compatibility_plan_only", "Expand for current item-index behavior or migration compatibility."),
  secondaryRow("macro.query_takes", "Query indexed take rows.", "read", "compatibility_plan_only", "Expand for current take-index behavior or migration compatibility."),
  secondaryRow("macro.query_fx", "Query indexed FX rows.", "read", "compatibility_plan_only", "Expand for current FX-index behavior or migration compatibility."),
  secondaryRow("macro.query_routing", "Query indexed routing rows.", "read", "compatibility_plan_only", "Expand for current routing-index behavior or routing readback."),
  secondaryRow("macro.query_automation", "Query indexed automation rows.", "read", "compatibility_plan_only", "Expand for current automation-index behavior."),
  secondaryRow("macro.query_markers", "Query indexed marker and region rows.", "read", "compatibility_plan_only", "Expand for current marker/region-index behavior."),
  secondaryRow("macro.query_media", "Query indexed project media rows.", "read", "compatibility_plan_only", "Expand for current media-index behavior."),
  secondaryRow("macro.hydrate_refs", "Hydrate selected index candidates into canonical live refs.", "read", "compatibility_plan_only", "Expand only when a later action needs canonical refs."),
  secondaryRow("macro.changed_since", "Query bounded project-index changes since a checkpoint.", "read", "compatibility_plan_only", "Expand for incremental change inspection."),
  secondaryRow("macro.set_track_controls", "Plan reversible common track control changes and readback.", "write_reversible", "compatibility_plan_only", "Expand for detailed track volume/pan/mute/name/color controls."),
  secondaryRow("macro.set_item_controls", "Plan reversible common item control changes and readback.", "write_reversible", "compatibility_plan_only", "Expand for detailed item move/trim/gain/pan/fade controls."),
  secondaryRow("macro.set_take_controls", "Plan reversible common take control changes and readback.", "write_reversible", "compatibility_plan_only", "Expand for detailed take name/gain/pan/pitch/playrate controls."),
  secondaryRow("macro.set_transport_controls", "Plan bounded transport/time-selection/loop control changes.", "safe_or_write", "compatibility_plan_only", "Expand for detailed transport controls; recording hard stops remain enforced."),
  secondaryRow("macro.set_send_controls", "Plan reversible send level/pan/mute changes and routing readback.", "write_reversible", "compatibility_plan_only", "Expand for detailed send controls with owner-track refs."),
  secondaryRow("macro.set_midi_controls", "Describe bounded MIDI-take control planning where lifecycle support is incomplete.", "write_evidence_bound", "compatibility_blocked", "Expand only to inspect the current typed blocker; do not treat it as executable."),
  secondaryRow("macro.set_stock_plugin_controls", "Plan evidence-bound semantic controls for supported stock plugins.", "write_evidence_bound", "compatibility_plan_only", "Expand only for supported stock-plugin mappings and starter actions."),
]);

const PRIMARY_BY_ID = new Map(PRIMARY_DEFINITIONS.map((entry) => [entry.id, entry]));
const CONTRACT_ONLY_DEFINITIONS = deepFreeze([...PRIMARY_DEFINITIONS, PROJECT_FILE_DEFINITION]);
const CONTRACT_ONLY_BY_ID = new Map(CONTRACT_ONLY_DEFINITIONS.map((entry) => [entry.id, entry]));

export const ALPHA3_2A_CONTRACT_ONLY_MACRO_IDS = deepFreeze(CONTRACT_ONLY_DEFINITIONS.map((entry) => entry.id));
export const ALPHA3_2A_SECONDARY_MACRO_IDS = deepFreeze(ALPHA3_2A_SECONDARY_MACRO_ROWS.map((entry) => entry.id));

const ALPHA3_2A_LEGACY_TO_PRIMARY_MAPPING = deepFreeze({
  "macro.index_status": "macro.project.query",
  "macro.selected_context": "macro.project.inspect",
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
});

const ALPHA3_2A_COVERED_LEGACY_IDS = deepFreeze(Object.keys(ALPHA3_2A_LEGACY_TO_PRIMARY_MAPPING));
const ALPHA3_2A_DISTINCT_LEGACY_IDS = deepFreeze([
  "macro.set_track_controls",
  "macro.set_item_controls",
  "macro.set_take_controls",
  "macro.set_transport_controls",
  "macro.set_send_controls",
  "macro.set_midi_controls",
  "macro.set_stock_plugin_controls",
]);

const COMPACT_GUIDE = deepFreeze({
  contract: ALPHA3_2A_AGENT_CONTEXT_MACRO_GUIDE_CONTRACT,
  version: ALPHA3_2A_AGENT_CONTEXT_MACRO_GUIDE_VERSION,
  phase: ALPHA3_2A_AGENT_CONTEXT_MACRO_GUIDE_PHASE,
  mode: "bounded_primary_manual_cards",
  status: "candidate",
  review_status: "in_review",
  tool_surface: {
    count: 5,
    tools: ["ping", "get_state", "list_templates", "list_recipes", "call_template"],
    added_tools: 0,
    list_macros: false,
  },
  mental_model: {
    template: "One audited call_template operation.",
    macro: "Small product operation; seven primary entries are non-runnable pending 3.2-C/D/E.",
    recipe: "Agent-run call_template/get_state procedure; no call_recipe or server executor.",
  },
  primary_spine: {
    ordered_ids: ALPHA3_2A_PRIMARY_MACRO_IDS,
    rows: PRIMARY_DEFINITIONS.map((entry) => compactPrimaryRow(entry)),
    current_posture: "candidate_in_review_non_runnable",
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
    expansion_hint: "Exact ids keep legacy item fields unchanged; contract manuals appear here.",
  },
  common_task_routing: [
    route("inspect project", "macro.project.inspect", "Use accepted reads now, including the exact path and dirty-state templates."),
    route("query status/context/tracks/items/takes/fx/routing/automation/markers_regions/media_sources/duplicates/changes", "macro.project.query", "Use mapped compatibility query macros until 3.2-D."),
    route("delete scoped objects", "macro.project.delete_targets", "Use one accepted delete template with confirmation/readback; never delete source files."),
    route("apply track/folder layout", "macro.project.apply_layout", "Use bounded track/folder templates and structural readback until 3.2-E."),
    route("apply internal routing", "macro.routing.apply", "Use accepted internal routing templates; hardware/device I/O is blocked."),
    route("place media assets", "macro.media.place_assets", "Use bounded probe/import/readback; never mutate source media files."),
    route("render targets", "macro.render.targets", "Use managed render root and exact accepted render templates; no external encoder fallback."),
    route("save/save-as", "macro.project.file", "Use the two exact accepted/live-smoked save templates with explicit race-aware overwrite authorization; the macro and new-project creation remain held."),
    route("recover blockers", "ping + exact guide request", "Repair typed readiness/ref/index/render blockers; no direct bridge, raw action/Lua, shell, or UI path."),
  ],
  portfolio: {
    primary_ids: ALPHA3_2A_PRIMARY_MACRO_IDS,
    secondary_ids: ALPHA3_2A_SECONDARY_MACRO_IDS,
    covered_legacy_ids: ALPHA3_2A_COVERED_LEGACY_IDS,
    legacy_to_primary_mapping: ALPHA3_2A_LEGACY_TO_PRIMARY_MAPPING,
    removed_legacy_ids: [],
    distinct_legacy: {
      ids: ALPHA3_2A_DISTINCT_LEGACY_IDS,
      blockers: [
        "Control consolidation is not ready; controls remain secondary.",
        "MIDI controls remain lifecycle/evidence blocked.",
        "Stock-plugin support remains evidence-bound.",
      ],
    },
    future_coverage_target: "about_80_percent_after_3_2_c_d_e_evidence",
    claim_boundary: "candidate only; not executable/live/stable/support",
  },
  recipe_guidance: {
    empty_catalog: "If empty, use one audited template atomically; for multi-step work state ad-hoc composition and use bounded readback.",
    draft_only_catalog: "Expand drafts, follow checkpoints/risk/evidence, and do not claim official/live-smoked.",
    public_call_recipe: false,
    hidden_recipe_executor: false,
    execution: "agent_orchestrated_call_template_and_get_state_only",
  },
  safety_boundary: {
    public_call_recipe: false,
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
  return CONTRACT_ONLY_DEFINITIONS.map((entry) => deepFreeze({
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
      current: "action_manual_only",
      future: "bounded macro result with refs/readback/blockers after the named implementation slice",
    },
  }));
}

export function isAlpha3_2AContractOnlyMacroId(id) {
  return CONTRACT_ONLY_BY_ID.has(id);
}

export function alpha3_2AContractOnlyBlockerForId(id) {
  return CONTRACT_ONLY_BY_ID.get(id)?.known_blocker ?? null;
}

export function createAlpha3_2AExactMacroExpansion(id) {
  const contractEntry = CONTRACT_ONLY_BY_ID.get(id);
  if (!contractEntry) return null;
  return cloneJson({
    id,
    contract: ALPHA3_2A_REQUESTED_EXPANSIONS_CONTRACT,
    guide_contract: ALPHA3_2A_AGENT_CONTEXT_MACRO_GUIDE_CONTRACT,
    guide_version: ALPHA3_2A_AGENT_CONTEXT_MACRO_GUIDE_VERSION,
    guide_tier: contractEntry.guide_tier,
    implementation_status: "contract_only_non_runnable",
    runnable: false,
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
    implementation_status: "contract_only_non_runnable",
    rollout_slice: entry.rollout_slice,
    action_manual: compactActionManual(entry.id, entry.manual),
    expand: { tool: "list_templates", ids: [entry.id], result: "requested_expansions" },
  };
}

function compactPrimaryUnderlyingActions(id) {
  return ({
    "macro.project.inspect": ["template.project.read_summary", "template.project.read_metadata", "template.project.read_track_item_overview", "template.tracks.list_tracks"],
    "macro.project.query": ["macro.index_status", "macro.selected_context", "macro.query_tracks", "macro.query_items"],
    "macro.project.delete_targets": ["template.tracks.delete_tracks", "template.items.delete_items", "template.project.delete_marker", "template.project.delete_region"],
    "macro.project.apply_layout": ["template.tracks.list_tracks", "template.tracks.create_folder_track", "template.tracks.create_track", "template.tracks.read_folder_structure"],
    "macro.routing.apply": ["template.routing.read_project_routing_graph", "template.routing.create_track_send", "template.routing.set_send_volume", "template.routing.read_track_routing"],
    "macro.media.place_assets": ["template.media.probe_file", "template.tracks.resolve_track_ref", "template.media.import_file_to_track", "template.items.read_item_summary"],
    "macro.render.targets": ["template.render.preview_targets", "template.render.resolve_bounds", "template.render.render_region_wav", "template.render.render_ogg"],
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
    purpose: compactText(purpose, 30),
    safety_tier,
    status: ({
      contract_only: "contract",
      compatibility_plan_only: "compat",
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
