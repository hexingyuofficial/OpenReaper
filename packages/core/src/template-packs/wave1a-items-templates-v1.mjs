import { TEMPLATE_DESCRIPTOR_CONTRACT } from "../template-descriptor-v1.mjs";

export const WAVE1A_ITEMS_TEMPLATE_IDS = Object.freeze([
  "template.items.resolve_item_ref",
  "template.items.read_item_summary",
  "template.items.list_selected_items",
  "template.items.set_exact_selection",
  "template.items.list_items_on_track",
  "template.items.move_item",
  "template.items.trim_item",
  "template.items.delete_item",
  "template.items.delete_items",
  "template.items.set_item_volume",
  "template.items.set_item_take_controls_batch",
  "template.items.set_take_volume",
  "template.items.set_take_pan",
  "template.items.set_active_take",
  "template.items.rename_take",
  "template.items.set_loop_source",
  "template.items.set_mute",
  "template.items.set_lock",
  "template.items.set_no_autofades",
  "template.items.set_play_all_takes",
  "template.items.set_take_start_in_source",
  "template.items.set_channel_mode",
  "template.items.set_invert_phase",
  "template.items.set_reverse",
  "template.items.set_pitch_shift_mode",
  "template.items.set_stretch_marker_fade_size",
  "template.items.choose_new_source_file",
  "template.items.set_item_fades",
  "template.items.split_item_at_time",
  "template.items.set_take_pitch",
  "template.items.set_take_playrate",
  "template.items.set_item_snap_offset",
]);

export const WAVE1A_ITEMS_TEMPLATES = deepFreeze([
  readDescriptor({
    id: "template.items.resolve_item_ref",
    title: "Resolve item ref",
    summary: "Resolve one item reference string into a typed item ref for later item templates.",
    entity_kind: "item",
    tags: ["items", "item", "ref", "read"],
    bridge: bridge({
      operation_family: "query_state",
      operation_name: "items.resolve_item_ref",
      capability: "items.resolve_item_ref",
      idempotency: "none",
    }),
    inputSchema: objectSchema({
      ref: { type: "string" },
    }, ["ref"]),
    outputSchema: objectSchema({
      item_ref: { type: "string" },
      track_ref: { type: "string" },
      position_seconds: { type: "number" },
      length_seconds: { type: "number" },
    }, ["item_ref"]),
    refs: refs({
      output: [ref("item_ref", "item", true, "Resolved item ref.")],
    }),
    expectedDelta: readDelta({
      summary: "Resolves an item reference without mutating item state.",
      entities: [
        {
          entity_kind: "item",
          action: "read",
          summary: "Item identity is resolved.",
        },
      ],
    }),
    examples: [
      {
        name: "resolve_selected_item",
        summary: "Resolve the first selected item.",
        input: { ref: "selected:0" },
      },
    ],
  }),
  readDescriptor({
    id: "template.items.read_item_summary",
    title: "Read item summary",
    summary: "Read compact timeline, fade, snap, volume, and active-take control facts for one resolved item.",
    entity_kind: "item",
    tags: ["items", "item", "read", "summary"],
    bridge: bridge({
      operation_family: "query_state",
      operation_name: "items.read_item_summary",
      capability: "items.read_item_summary",
      idempotency: "none",
    }),
    inputSchema: objectSchema({
      include_take_summary: { type: "boolean" },
    }, []),
    outputSchema: objectSchema({
      item_ref: { type: "string" },
      track_ref: { type: "string" },
      position_seconds: { type: "number" },
      length_seconds: { type: "number" },
      snap_offset_seconds: { type: "number" },
      fade_in_seconds: { type: "number" },
      fade_out_seconds: { type: "number" },
      volume_db: { type: "number" },
      active_take_ref: {
        oneOf: [
          { type: "string" },
          { type: "null" },
        ],
      },
      active_take_name: { type: "string" },
      take_count: { type: "integer" },
      take_volume_db: { type: "number" },
      take_pan: { type: "number" },
      take_pitch_semitones: { type: "number" },
      playrate: { type: "number" },
      preserve_pitch: { type: "boolean" },
    }, ["item_ref", "position_seconds", "length_seconds"]),
    refs: refs({
      input: [ref("item_ref", "item", true, "Item ref whose compact summary is read.")],
      output: [ref("item_ref", "item", true, "Item ref returned with the summary.")],
    }),
    expectedDelta: readDelta({
      summary: "Reads compact item and active-take facts without mutation.",
      entities: [
        {
          entity_kind: "item",
          action: "read",
          summary: "Item timeline and edit fields are read.",
        },
        {
          entity_kind: "take",
          action: "read",
          summary: "Active-take summary is read when available.",
        },
      ],
    }),
    examples: [
      {
        name: "read_resolved_item",
        summary: "Read one resolved item's compact summary.",
        input: { include_take_summary: true },
      },
    ],
  }),
  readDescriptor({
    id: "template.items.list_selected_items",
    title: "List selected items",
    summary: "List selected media items with canonical identities, indexes, display numbers, and selection state.",
    entity_kind: "item",
    tags: ["items", "item", "selection", "snapshot", "read"],
    bridge: bridge({
      operation_family: "query_state",
      operation_name: "items.list_selected_items",
      capability: "items.list_selected_items",
      idempotency: "none",
    }),
    inputSchema: objectSchema({
      limit: { type: "integer" },
      include_track_refs: { type: "boolean" },
    }, []),
    outputSchema: objectSchema({
      items: { type: "array" },
      selected_count: { type: "integer" },
      truncated: { type: "boolean" },
    }, ["items", "selected_count", "truncated"]),
    refs: refs({
      output: [
        ref("item_ref", "item", false, "Canonical selected item refs."),
        ref("track_ref", "track", false, "Owning track refs when include_track_refs is true."),
      ],
    }),
    expectedDelta: readDelta({
      summary: "Reads selected item refs without mutating item state.",
      entities: [
        {
          entity_kind: "item",
          action: "read",
          summary: "Selected item refs and display facts are read.",
        },
      ],
    }),
    examples: [
      {
        name: "list_selected_items",
        summary: "List selected items before reading or editing one.",
        input: { limit: 50, include_track_refs: true },
      },
    ],
  }),
  commandDescriptor({
    id: "template.items.set_exact_selection",
    title: "Set exact Item selection",
    summary: "Atomically replace, add, or remove canonical Item GUID references and return the complete final Item selection.",
    entity_kind: "item",
    tags: ["items", "item", "selection", "exact_ref", "batch"],
    bridge: bridge({ capability: "items.set_exact_selection" }),
    inputSchema: objectSchema({
      mode: { type: "string", enum: ["replace", "add", "remove"] },
      item_refs: { type: "array", minItems: 1, maxItems: 64, items: { type: "string" } },
    }, ["mode", "item_refs"]),
    outputSchema: objectSchema({
      mode: { type: "string" },
      requested_item_refs: { type: "array" },
      selected_item_refs: { type: "array" },
      selected_count: { type: "integer" },
      changed_count: { type: "integer" },
      readback_status: { const: "passed" },
    }, ["mode", "requested_item_refs", "selected_item_refs", "selected_count", "changed_count", "readback_status"]),
    refs: refs(),
    expectedDelta: itemUpdateDelta("Updates only bounded Item selection state for exact canonical GUID refs."),
    verification: requiredVerification({
      name: "exact_item_selection_matches",
      kind: "state_delta",
      summary: "Complete final selected Item GUID readback exactly matches the compiled replace/add/remove selection set.",
    }),
    examples: [{
      name: "replace_exact_item_selection",
      summary: "Select only two exact Items without UI automation.",
      input: { mode: "replace", item_refs: ["item:guid:{ITEM-A}", "item:guid:{ITEM-B}"] },
    }],
  }),
  readDescriptor({
    id: "template.items.list_items_on_track",
    title: "List items on track",
    summary: "List compact item identities on one resolved track with timeline and selection facts.",
    entity_kind: "item",
    tags: ["items", "track", "snapshot", "read"],
    bridge: bridge({
      operation_family: "query_state",
      operation_name: "items.list_items_on_track",
      capability: "items.list_items_on_track",
      idempotency: "none",
    }),
    inputSchema: objectSchema({
      limit: { type: "integer" },
      include_take_summary: { type: "boolean" },
    }, []),
    outputSchema: objectSchema({
      track_ref: { type: "string" },
      items: { type: "array" },
      item_count: { type: "integer" },
      truncated: { type: "boolean" },
    }, ["track_ref", "items", "item_count", "truncated"]),
    refs: refs({
      input: [ref("track_ref", "track", true, "Track ref whose items are listed.")],
      output: [
        ref("track_ref", "track", true, "Same track ref returned with the list."),
        ref("item_ref", "item", false, "Canonical item refs on the track."),
      ],
    }),
    expectedDelta: readDelta({
      summary: "Reads item refs on one track without mutating item state.",
      entities: [
        {
          entity_kind: "track",
          action: "read",
          summary: "The owning track is read.",
        },
        {
          entity_kind: "item",
          action: "read",
          summary: "Track item refs and timeline facts are read.",
        },
      ],
    }),
    examples: [
      {
        name: "list_track_items",
        summary: "List compact item refs on a resolved track.",
        input: { limit: 50, include_take_summary: false },
      },
    ],
  }),
  commandDescriptor({
    id: "template.items.move_item",
    title: "Move item",
    summary: "Move one item to an absolute project-time start position without changing its track.",
    entity_kind: "item",
    tags: ["items", "item", "move", "position"],
    bridge: bridge({ capability: "items.move_item" }),
    inputSchema: objectSchema({
      position_seconds: { type: "number" },
    }, ["position_seconds"]),
    outputSchema: objectSchema({
      item_ref: { type: "string" },
      position_seconds: { type: "number" },
    }, ["item_ref", "position_seconds"]),
    expectedDelta: mutationDelta({
      summary: "Updates one item's absolute timeline position.",
      entities: [
        {
          entity_kind: "item",
          action: "update",
          summary: "Item start position is updated.",
        },
      ],
      idempotent: true,
    }),
    verification: requiredVerification({
      name: "item_position_matches",
      kind: "state_delta",
      summary: "Item position readback matches the requested project time.",
    }),
    examples: [
      {
        name: "move_item_to_second_two",
        summary: "Move a resolved item to 2 seconds.",
        input: { position_seconds: 2 },
      },
    ],
  }),
  commandDescriptor({
    id: "template.items.trim_item",
    title: "Trim item",
    summary: "Set one item's visible length and optionally set active-take source start offset.",
    entity_kind: "item",
    tags: ["items", "item", "trim", "take"],
    bridge: bridge({ capability: "items.trim_item" }),
    inputSchema: objectSchema({
      length_seconds: { type: "number" },
      start_offset_seconds: { type: "number" },
    }, ["length_seconds"]),
    outputSchema: objectSchema({
      item_ref: { type: "string" },
      length_seconds: { type: "number" },
      start_offset_seconds: { type: "number" },
    }, ["item_ref", "length_seconds"]),
    expectedDelta: mutationDelta({
      summary: "Updates item length and optional active-take source offset.",
      entities: [
        {
          entity_kind: "item",
          action: "update",
          summary: "Item visible length is updated.",
        },
        {
          entity_kind: "take",
          action: "update",
          summary: "Active-take source offset is updated when supplied.",
        },
      ],
      idempotent: true,
    }),
    verification: requiredVerification({
      name: "item_trim_matches",
      kind: "state_delta",
      summary: "Item length and supplied source offset read back as requested.",
    }),
    examples: [
      {
        name: "trim_item_length",
        summary: "Trim a resolved item to 1.25 seconds.",
        input: { length_seconds: 1.25 },
      },
      {
        name: "trim_item_with_offset",
        summary: "Trim and start playback 0.1 seconds into the active take source.",
        input: { length_seconds: 1.25, start_offset_seconds: 0.1 },
      },
    ],
  }),
  destructiveDescriptor({
    id: "template.items.delete_item",
    title: "Delete item",
    summary: "Delete one resolved media item and return bounded deletion readback for cleanup workflows.",
    entity_kind: "item",
    tags: ["items", "item", "delete", "cleanup"],
    bridge: bridge({
      capability: "items.delete_item",
      idempotency: "none",
    }),
    inputSchema: objectSchema({
      require_selected: { type: "boolean" },
    }, []),
    outputSchema: objectSchema({
      deleted_item_ref: { type: "string" },
      deleted_count: { type: "integer" },
    }, ["deleted_item_ref", "deleted_count"]),
    refs: refs({
      input: [ref("item_ref", "item", true, "Item ref to delete.")],
      output: [ref("deleted_item_ref", "item", true, "Deleted item ref echoed for the session ledger.")],
    }),
    expectedDelta: mutationDelta({
      summary: "Deletes one resolved media item.",
      entities: [
        {
          entity_kind: "item",
          action: "delete",
          summary: "Resolved item is removed from the project.",
        },
      ],
      idempotent: false,
    }),
    verification: requiredVerification({
      name: "item_deleted",
      kind: "state_delta",
      summary: "Item lookup after deletion confirms the item no longer exists.",
    }),
    examples: [
      {
        name: "delete_resolved_item",
        summary: "Delete one resolved item.",
        input: { require_selected: false },
      },
    ],
  }),
  destructiveDescriptor({
    id: "template.items.delete_items",
    title: "Delete items",
    summary: "Delete a bounded set of resolved media items for cleanup parity after item creation or split tests.",
    entity_kind: "item",
    tags: ["items", "item", "delete", "cleanup", "batch"],
    bridge: bridge({
      capability: "items.delete_items",
      idempotency: "none",
    }),
    inputSchema: objectSchema({
      require_selected: { type: "boolean" },
      selector_guard: { type: "object" },
    }, []),
    outputSchema: objectSchema({
      deleted_count: { type: "integer" },
      deleted_item_refs: { type: "array" },
    }, ["deleted_count", "deleted_item_refs"]),
    refs: refs({
      input: [ref("item_ref", "item", true, "Item refs to delete.")],
      output: [ref("deleted_item_ref", "item", false, "Deleted item refs echoed for the session ledger.")],
    }),
    expectedDelta: mutationDelta({
      summary: "Deletes one or more resolved media items.",
      entities: [
        {
          entity_kind: "item",
          action: "delete",
          summary: "Resolved items are removed from the project.",
        },
      ],
      idempotent: false,
    }),
    verification: requiredVerification({
      name: "items_deleted",
      kind: "state_delta",
      summary: "Item lookup after deletion confirms each requested item no longer exists.",
    }),
    examples: [
      {
        name: "delete_split_items",
        summary: "Delete a bounded set of resolved items.",
        input: { require_selected: false },
      },
    ],
  }),
  commandDescriptor({
    id: "template.items.set_item_volume",
    title: "Set item volume",
    summary: "Set one media item's item-level volume gain in decibels.",
    entity_kind: "item",
    tags: ["items", "item", "volume"],
    bridge: bridge({ capability: "items.set_item_volume" }),
    inputSchema: objectSchema({
      volume_db: { type: "number" },
    }, ["volume_db"]),
    outputSchema: objectSchema({
      item_ref: { type: "string" },
      volume_db: { type: "number" },
    }, ["item_ref", "volume_db"]),
    expectedDelta: itemUpdateDelta("Updates one item's item-level volume gain."),
    verification: requiredVerification({
      name: "item_volume_matches",
      kind: "state_delta",
      summary: "Item volume readback matches the requested decibel value.",
    }),
    examples: [
      {
        name: "set_item_volume_down",
        summary: "Set item volume to -3 dB.",
        input: { volume_db: -3 },
      },
    ],
  }),
  commandDescriptor({
    id: "template.items.set_item_take_controls_batch",
    title: "Set Item and Take controls batch",
    summary: "Apply bounded Item and Active-Take control rows through one generic native batch with aggregate readback.",
    entity_kind: "item",
    tags: ["items", "item", "take", "controls", "batch"],
    bridge: bridge({ capability: "items.set_item_take_controls_batch" }),
    inputSchema: objectSchema({
      batch: { type: "array" },
      dry_run: { type: "boolean" },
    }, ["batch"]),
    outputSchema: objectSchema({
      rows: { type: "array" },
      row_count: { type: "integer" },
      dry_run: { type: "boolean" },
      mutation_attempted: { type: "boolean" },
      readback_status: { type: "string" },
      batch_timings: { type: "object" },
    }, ["rows", "row_count", "readback_status", "batch_timings"]),
    refs: refs(),
    expectedDelta: mutationDelta({
      summary: "Updates bounded Item and Active-Take controls in one native batch.",
      entities: [
        {
          entity_kind: "item",
          action: "update",
          summary: "Each requested Item control row is updated and identity-checked.",
        },
        {
          entity_kind: "take",
          action: "update",
          summary: "Each requested Active-Take control row is updated and identity-checked when present.",
        },
      ],
    }),
    verification: requiredVerification({
      name: "item_take_controls_batch_matches",
      kind: "state_delta",
      summary: "Every batch row returns exact Item/Take identity and aggregate live readback.",
    }),
    examples: [
      {
        name: "batch_item_take_controls",
        summary: "Apply one bounded Item volume and Active-Take pan row.",
        input: {
          batch: [{
            id: "row1",
            item_ref: "item:guid:{ITEM-GUID}",
            take_ref: "take:guid:{TAKE-GUID}",
            item: { volume_db: -3 },
            take: { pan: 0.25 },
          }],
          dry_run: false,
        },
      },
    ],
  }),
  commandDescriptor({
    id: "template.items.set_take_volume",
    title: "Set take volume",
    summary: "Set the active take volume gain in decibels without changing item volume.",
    entity_kind: "take",
    tags: ["items", "take", "volume"],
    bridge: bridge({ capability: "items.set_take_volume" }),
    inputSchema: objectSchema({
      volume_db: { type: "number" },
    }, ["volume_db"]),
    outputSchema: objectSchema({
      item_ref: { type: "string" },
      volume_db: { type: "number" },
    }, ["item_ref", "volume_db"]),
    expectedDelta: takeUpdateDelta("Updates active-take volume gain."),
    verification: requiredVerification({
      name: "take_volume_matches",
      kind: "state_delta",
      summary: "Active-take volume readback matches the requested decibel value.",
    }),
    examples: [
      {
        name: "set_take_volume_down",
        summary: "Set active take volume to -6 dB.",
        input: { volume_db: -6 },
      },
    ],
  }),
  commandDescriptor({
    id: "template.items.set_take_pan",
    title: "Set take pan",
    summary: "Set the active take pan position without changing item-level volume or timeline state.",
    entity_kind: "take",
    tags: ["items", "take", "pan"],
    bridge: bridge({ capability: "items.set_take_pan" }),
    inputSchema: objectSchema({
      pan: { type: "number" },
    }, ["pan"]),
    outputSchema: objectSchema({
      item_ref: { type: "string" },
      pan: { type: "number" },
    }, ["item_ref", "pan"]),
    expectedDelta: takeUpdateDelta("Updates active-take pan position."),
    verification: requiredVerification({
      name: "take_pan_matches",
      kind: "state_delta",
      summary: "Active-take pan readback matches the requested value.",
    }),
    examples: [
      {
        name: "pan_take_right",
        summary: "Pan the active take slightly right.",
        input: { pan: 0.25 },
      },
    ],
  }),
  commandDescriptor({
    id: "template.items.set_active_take",
    title: "Set active take",
    summary: "Set one exact take as active on its exact owning item without relying on item or take selection.",
    entity_kind: "take",
    tags: ["items", "take", "active", "selection"],
    bridge: bridge({ capability: "items.set_active_take" }),
    inputSchema: objectSchema({}, []),
    outputSchema: objectSchema({
      item_ref: { type: "string" },
      active_take_ref: { type: "string" },
      take_index: { type: "integer" },
      take_count: { type: "integer" },
      changed: { type: "boolean" },
    }, ["item_ref", "active_take_ref", "take_index", "take_count", "changed"]),
    refs: refs({
      input: [
        ref("item_ref", "item", true, "Exact owning item ref; selected refs are not accepted."),
        ref("take_ref", "take", true, "Exact take ref that must belong to item_ref; selected refs are not accepted."),
      ],
      output: [
        ref("item_ref", "item", true, "Exact owning item ref read back after the mutation."),
        ref("active_take_ref", "take", true, "Exact active take ref read back from REAPER."),
      ],
    }),
    expectedDelta: mutationDelta({
      summary: "Updates only the active-take choice for one exact item.",
      entities: [
        {
          entity_kind: "item",
          action: "update",
          summary: "The item's active-take choice is updated.",
        },
        {
          entity_kind: "take",
          action: "update",
          summary: "The requested take becomes active without changing take content.",
        },
      ],
      idempotent: true,
    }),
    verification: requiredVerification({
      name: "active_take_matches",
      kind: "state_delta",
      summary: "GetActiveTake readback exactly matches the requested take on the requested item.",
    }),
    examples: [
      {
        name: "activate_exact_take",
        summary: "Set an exact resolved take active on its exact resolved owner item.",
        input: {},
      },
    ],
  }),
  commandDescriptor({
    id: "template.items.rename_take",
    title: "Rename take",
    summary: "Rename the active take on one resolved media item.",
    entity_kind: "take",
    tags: ["items", "take", "rename"],
    bridge: bridge({ capability: "items.rename_take" }),
    inputSchema: objectSchema({
      name: { type: "string" },
    }, ["name"]),
    outputSchema: objectSchema({
      item_ref: { type: "string" },
      take_name: { type: "string" },
    }, ["item_ref", "take_name"]),
    expectedDelta: takeUpdateDelta("Updates active-take display name."),
    verification: requiredVerification({
      name: "take_name_matches",
      kind: "state_delta",
      summary: "Active-take name readback matches the requested name.",
    }),
    examples: [
      {
        name: "rename_active_take",
        summary: "Rename the active take.",
        input: { name: "Lead vocal comp" },
      },
    ],
  }),
  commandDescriptor({
    id: "template.items.set_loop_source",
    title: "Set loop source",
    summary: "Set one media item's loop-source flag for item-property loop preparation.",
    entity_kind: "item",
    tags: ["items", "item", "loop"],
    bridge: bridge({ capability: "items.set_loop_source" }),
    inputSchema: objectSchema({
      loop_source: { type: "boolean" },
    }, ["loop_source"]),
    outputSchema: objectSchema({
      item_ref: { type: "string" },
      loop_source: { type: "boolean" },
    }, ["item_ref", "loop_source"]),
    expectedDelta: itemUpdateDelta("Updates one item's loop-source flag."),
    verification: requiredVerification({
      name: "item_loop_source_matches",
      kind: "state_delta",
      summary: "Item loop-source readback matches the requested flag.",
    }),
    examples: [
      {
        name: "enable_item_loop_source",
        summary: "Enable loop source on a resolved item.",
        input: { loop_source: true },
      },
    ],
  }),
  commandDescriptor({
    id: "template.items.set_mute",
    title: "Set item mute",
    summary: "Set one media item's mute flag without muting the owning track.",
    entity_kind: "item",
    tags: ["items", "item", "mute"],
    bridge: bridge({ capability: "items.set_mute" }),
    inputSchema: objectSchema({
      muted: { type: "boolean" },
    }, ["muted"]),
    outputSchema: objectSchema({
      item_ref: { type: "string" },
      muted: { type: "boolean" },
    }, ["item_ref", "muted"]),
    expectedDelta: itemUpdateDelta("Updates one item's mute flag."),
    verification: requiredVerification({
      name: "item_mute_matches",
      kind: "state_delta",
      summary: "Item mute readback matches the requested flag.",
    }),
    examples: [
      {
        name: "mute_item",
        summary: "Mute one resolved item.",
        input: { muted: true },
      },
    ],
  }),
  commandDescriptor({
    id: "template.items.set_lock",
    title: "Set item lock",
    summary: "Set one media item's lock flag from the item properties surface.",
    entity_kind: "item",
    tags: ["items", "item", "lock"],
    bridge: bridge({ capability: "items.set_lock" }),
    inputSchema: objectSchema({
      locked: { type: "boolean" },
    }, ["locked"]),
    outputSchema: objectSchema({
      item_ref: { type: "string" },
      locked: { type: "boolean" },
    }, ["item_ref", "locked"]),
    expectedDelta: itemUpdateDelta("Updates one item's lock flag."),
    verification: requiredVerification({
      name: "item_lock_matches",
      kind: "state_delta",
      summary: "Item lock readback matches the requested flag.",
    }),
    examples: [
      {
        name: "lock_item",
        summary: "Lock one resolved item.",
        input: { locked: true },
      },
    ],
  }),
  commandDescriptor({
    id: "template.items.set_no_autofades",
    title: "Set no autofades",
    summary: "Set one media item's no-autofades flag from the item properties surface.",
    entity_kind: "item",
    tags: ["items", "item", "fade"],
    bridge: bridge({ capability: "items.set_no_autofades" }),
    inputSchema: objectSchema({
      no_autofades: { type: "boolean" },
    }, ["no_autofades"]),
    outputSchema: objectSchema({
      item_ref: { type: "string" },
      no_autofades: { type: "boolean" },
    }, ["item_ref", "no_autofades"]),
    expectedDelta: itemUpdateDelta("Updates one item's no-autofades flag."),
    verification: requiredVerification({
      name: "item_no_autofades_matches",
      kind: "state_delta",
      summary: "Item no-autofades readback matches the requested flag.",
    }),
    examples: [
      {
        name: "disable_item_autofades",
        summary: "Disable autofades on one resolved item.",
        input: { no_autofades: true },
      },
    ],
  }),
  commandDescriptor({
    id: "template.items.set_play_all_takes",
    title: "Set play all takes",
    summary: "Set whether one item plays all takes at once instead of only the active take.",
    entity_kind: "item",
    tags: ["items", "item", "take"],
    bridge: bridge({ capability: "items.set_play_all_takes" }),
    inputSchema: objectSchema({
      play_all_takes: { type: "boolean" },
    }, ["play_all_takes"]),
    outputSchema: objectSchema({
      item_ref: { type: "string" },
      play_all_takes: { type: "boolean" },
    }, ["item_ref", "play_all_takes"]),
    expectedDelta: itemUpdateDelta("Updates one item's play-all-takes flag."),
    verification: requiredVerification({
      name: "item_play_all_takes_matches",
      kind: "state_delta",
      summary: "Item play-all-takes readback matches the requested flag.",
    }),
    examples: [
      {
        name: "play_all_takes",
        summary: "Enable play-all-takes on one resolved item.",
        input: { play_all_takes: true },
      },
    ],
  }),
  commandDescriptor({
    id: "template.items.set_take_start_in_source",
    title: "Set take start in source",
    summary: "Set the active take start offset inside its source media.",
    entity_kind: "take",
    tags: ["items", "take", "source"],
    bridge: bridge({ capability: "items.set_take_start_in_source" }),
    inputSchema: objectSchema({
      start_offset_seconds: { type: "number" },
    }, ["start_offset_seconds"]),
    outputSchema: objectSchema({
      item_ref: { type: "string" },
      start_offset_seconds: { type: "number" },
    }, ["item_ref", "start_offset_seconds"]),
    expectedDelta: takeUpdateDelta("Updates active-take start offset in source media."),
    verification: requiredVerification({
      name: "take_start_in_source_matches",
      kind: "state_delta",
      summary: "Active-take source offset readback matches the requested value.",
    }),
    examples: [
      {
        name: "offset_take_source_start",
        summary: "Start active-take playback 0.2 seconds into the source.",
        input: { start_offset_seconds: 0.2 },
      },
    ],
  }),
  commandDescriptor({
    id: "template.items.set_channel_mode",
    title: "Set take channel mode",
    summary: "Set the active take channel mode using a bounded item-property enum.",
    entity_kind: "take",
    tags: ["items", "take", "channel"],
    bridge: bridge({ capability: "items.set_channel_mode" }),
    inputSchema: objectSchema({
      channel_mode: { enum: ["normal", "mono_left", "mono_right", "reverse_stereo"] },
    }, ["channel_mode"]),
    outputSchema: objectSchema({
      item_ref: { type: "string" },
      channel_mode: { type: "string" },
    }, ["item_ref", "channel_mode"]),
    expectedDelta: takeUpdateDelta("Updates active-take channel mode."),
    verification: requiredVerification({
      name: "take_channel_mode_matches",
      kind: "state_delta",
      summary: "Active-take channel mode readback matches the requested enum.",
    }),
    examples: [
      {
        name: "set_take_mono_left",
        summary: "Use the left source channel as mono.",
        input: { channel_mode: "mono_left" },
      },
    ],
  }),
  commandDescriptor({
    id: "template.items.set_invert_phase",
    title: "Set take invert phase",
    summary: "Set the active take phase inversion flag.",
    entity_kind: "take",
    tags: ["items", "take", "phase"],
    bridge: bridge({ capability: "items.set_invert_phase" }),
    inputSchema: objectSchema({
      invert_phase: { type: "boolean" },
    }, ["invert_phase"]),
    outputSchema: objectSchema({
      item_ref: { type: "string" },
      invert_phase: { type: "boolean" },
    }, ["item_ref", "invert_phase"]),
    expectedDelta: takeUpdateDelta("Updates active-take phase inversion flag."),
    verification: requiredVerification({
      name: "take_phase_matches",
      kind: "state_delta",
      summary: "Active-take phase readback matches the requested flag.",
    }),
    examples: [
      {
        name: "invert_take_phase",
        summary: "Invert phase on the active take.",
        input: { invert_phase: true },
      },
    ],
  }),
  commandDescriptor({
    id: "template.items.set_reverse",
    title: "Set take reverse",
    summary: "Set whether the active take plays its source in reverse.",
    entity_kind: "take",
    tags: ["items", "take", "reverse"],
    bridge: bridge({ capability: "items.set_reverse" }),
    inputSchema: objectSchema({
      reverse: { type: "boolean" },
    }, ["reverse"]),
    outputSchema: objectSchema({
      item_ref: { type: "string" },
      reverse: { type: "boolean" },
    }, ["item_ref", "reverse"]),
    expectedDelta: takeUpdateDelta("Updates active-take reverse playback flag."),
    verification: requiredVerification({
      name: "take_reverse_matches",
      kind: "state_delta",
      summary: "Active-take reverse readback matches the requested flag.",
    }),
    examples: [
      {
        name: "reverse_active_take",
        summary: "Enable reverse playback on the active take.",
        input: { reverse: true },
      },
    ],
  }),
  commandDescriptor({
    id: "template.items.set_pitch_shift_mode",
    title: "Set pitch shift mode",
    summary: "Set the active take pitch-shift/time-stretch mode with a bounded mode label.",
    entity_kind: "take",
    tags: ["items", "take", "pitch", "stretch"],
    bridge: bridge({ capability: "items.set_pitch_shift_mode" }),
    inputSchema: objectSchema({
      mode: { type: "string" },
    }, ["mode"]),
    outputSchema: objectSchema({
      item_ref: { type: "string" },
      mode: { type: "string" },
    }, ["item_ref", "mode"]),
    expectedDelta: takeUpdateDelta("Updates active-take pitch-shift and time-stretch mode."),
    verification: requiredVerification({
      name: "take_pitch_shift_mode_matches",
      kind: "state_delta",
      summary: "Active-take pitch-shift mode readback matches the requested mode label.",
    }),
    examples: [
      {
        name: "set_elastique_mode",
        summary: "Set a named pitch-shift mode on the active take.",
        input: { mode: "elastique_pro" },
      },
    ],
  }),
  commandDescriptor({
    id: "template.items.set_stretch_marker_fade_size",
    title: "Set stretch marker fade size",
    summary: "Set the active take stretch-marker fade size in milliseconds.",
    entity_kind: "take",
    tags: ["items", "take", "stretch"],
    bridge: bridge({ capability: "items.set_stretch_marker_fade_size" }),
    inputSchema: objectSchema({
      fade_size_ms: { type: "number" },
    }, ["fade_size_ms"]),
    outputSchema: objectSchema({
      item_ref: { type: "string" },
      fade_size_ms: { type: "number" },
    }, ["item_ref", "fade_size_ms"]),
    expectedDelta: takeUpdateDelta("Updates active-take stretch-marker fade size."),
    verification: requiredVerification({
      name: "take_stretch_marker_fade_size_matches",
      kind: "state_delta",
      summary: "Stretch-marker fade-size readback matches the requested value.",
    }),
    examples: [
      {
        name: "set_short_stretch_marker_fade",
        summary: "Set stretch-marker fade size to 2.5 ms.",
        input: { fade_size_ms: 2.5 },
      },
    ],
  }),
  commandDescriptor({
    id: "template.items.choose_new_source_file",
    title: "Choose new source file",
    summary: "Relink the active take on one item to a resolved source file ref without opening a file picker.",
    entity_kind: "take",
    tags: ["items", "take", "source", "media"],
    bridge: bridge({ capability: "items.choose_new_source_file" }),
    inputSchema: objectSchema({
      preserve_timing: { type: "boolean" },
    }, ["preserve_timing"]),
    outputSchema: objectSchema({
      item_ref: { type: "string" },
      file_ref: { type: "string" },
      preserve_timing: { type: "boolean" },
    }, ["item_ref", "file_ref", "preserve_timing"]),
    refs: refs({
      input: [
        ref("item_ref", "item", true, "Item whose active take source is relinked."),
        ref("file_ref", "file", true, "Resolved source file ref to use as the new take source."),
      ],
      output: [
        ref("item_ref", "item", true, "Mutated item ref."),
        ref("file_ref", "file", true, "Source file ref applied to the active take."),
      ],
    }),
    expectedDelta: mutationDelta({
      summary: "Relinks active-take source media to a resolved file ref.",
      entities: [
        {
          entity_kind: "take",
          action: "update",
          summary: "Active-take source file is updated.",
        },
        {
          entity_kind: "file",
          action: "read",
          summary: "Resolved source file ref is consumed.",
        },
      ],
      idempotent: true,
    }),
    verification: requiredVerification({
      name: "take_source_file_matches",
      kind: "state_delta",
      summary: "Active-take source readback matches the requested file ref.",
    }),
    examples: [
      {
        name: "relink_take_source_file",
        summary: "Relink the active take to a resolved replacement source file.",
        input: { preserve_timing: true },
      },
    ],
  }),
  commandDescriptor({
    id: "template.items.set_item_fades",
    title: "Set item fades",
    summary: "Set or clear one item's fade-in and fade-out lengths without changing fade shapes.",
    entity_kind: "item",
    tags: ["items", "item", "fade"],
    bridge: bridge({ capability: "items.set_item_fades" }),
    inputSchema: objectSchema({
      fade_in_seconds: nullableNumberSchema(),
      fade_out_seconds: nullableNumberSchema(),
    }, ["fade_in_seconds", "fade_out_seconds"]),
    outputSchema: objectSchema({
      item_ref: { type: "string" },
      fade_in_seconds: { type: "number" },
      fade_out_seconds: { type: "number" },
    }, ["item_ref"]),
    expectedDelta: mutationDelta({
      summary: "Updates item fade-in and fade-out lengths.",
      entities: [
        {
          entity_kind: "item",
          action: "update",
          summary: "Item fade lengths are updated.",
        },
      ],
      idempotent: true,
    }),
    verification: requiredVerification({
      name: "item_fades_match",
      kind: "state_delta",
      summary: "Item fade length readback matches the requested values.",
    }),
    examples: [
      {
        name: "set_short_item_fades",
        summary: "Set short fade-in and fade-out lengths.",
        input: { fade_in_seconds: 0.02, fade_out_seconds: 0.08 },
      },
      {
        name: "clear_item_fades",
        summary: "Clear both fades by passing null values.",
        input: { fade_in_seconds: null, fade_out_seconds: null },
      },
    ],
  }),
  commandDescriptor({
    id: "template.items.split_item_at_time",
    title: "Split item at time",
    summary: "Split one item at an explicit project-time position inside the item's current bounds.",
    entity_kind: "item",
    tags: ["items", "item", "split"],
    bridge: bridge({ capability: "items.split_item_at_time" }),
    inputSchema: objectSchema({
      position_seconds: { type: "number" },
    }, ["position_seconds"]),
    outputSchema: objectSchema({
      left_item_ref: { type: "string" },
      right_item_ref: { type: "string" },
      split_position_seconds: { type: "number" },
    }, ["left_item_ref", "right_item_ref", "split_position_seconds"]),
    refs: refs({
      input: [ref("item_ref", "item", true, "Item ref to split.")],
      output: [
        ref("left_item_ref", "item", true, "Item ref for the left split item."),
        ref("right_item_ref", "item", true, "Item ref for the right split item."),
      ],
    }),
    expectedDelta: mutationDelta({
      summary: "Splits one item into left and right item refs at an explicit time.",
      entities: [
        {
          entity_kind: "item",
          action: "update",
          summary: "Original item becomes the left split item.",
        },
        {
          entity_kind: "item",
          action: "create",
          summary: "Right split item is created.",
        },
      ],
      idempotent: false,
    }),
    verification: requiredVerification({
      name: "split_items_exist",
      kind: "state_delta",
      summary: "Left and right item refs exist at the requested split boundary.",
    }),
    examples: [
      {
        name: "split_item_at_two_seconds",
        summary: "Split a resolved item at 2 seconds.",
        input: { position_seconds: 2 },
      },
    ],
  }),
  commandDescriptor({
    id: "template.items.set_take_pitch",
    title: "Set take pitch",
    summary: "Set the active take pitch in semitones without editing MIDI note events.",
    entity_kind: "take",
    tags: ["items", "take", "pitch"],
    bridge: bridge({ capability: "items.set_take_pitch" }),
    inputSchema: objectSchema({
      semitones: { type: "number" },
    }, ["semitones"]),
    outputSchema: objectSchema({
      item_ref: { type: "string" },
      semitones: { type: "number" },
    }, ["item_ref", "semitones"]),
    expectedDelta: mutationDelta({
      summary: "Updates active-take pitch playback property.",
      entities: [
        {
          entity_kind: "take",
          action: "update",
          summary: "Active-take pitch is updated.",
        },
      ],
      idempotent: true,
    }),
    verification: requiredVerification({
      name: "take_pitch_matches",
      kind: "state_delta",
      summary: "Active-take pitch readback matches the requested semitone value.",
    }),
    examples: [
      {
        name: "pitch_take_down_octave",
        summary: "Pitch the active take down one octave.",
        input: { semitones: -12 },
      },
    ],
  }),
  commandDescriptor({
    id: "template.items.set_take_playrate",
    title: "Set take playrate",
    summary: "Set active-take playback rate with explicit preserve-pitch behavior.",
    entity_kind: "take",
    tags: ["items", "take", "playrate"],
    bridge: bridge({ capability: "items.set_take_playrate" }),
    inputSchema: objectSchema({
      playrate: { type: "number" },
      preserve_pitch: { type: "boolean" },
    }, ["playrate", "preserve_pitch"]),
    outputSchema: objectSchema({
      item_ref: { type: "string" },
      playrate: { type: "number" },
      preserve_pitch: { type: "boolean" },
    }, ["item_ref", "playrate", "preserve_pitch"]),
    expectedDelta: mutationDelta({
      summary: "Updates active-take playback rate and preserve-pitch flag.",
      entities: [
        {
          entity_kind: "take",
          action: "update",
          summary: "Active-take playrate is updated.",
        },
      ],
      idempotent: true,
    }),
    verification: requiredVerification({
      name: "take_playrate_matches",
      kind: "state_delta",
      summary: "Active-take playrate and preserve-pitch flag read back as requested.",
    }),
    examples: [
      {
        name: "slow_take_with_pitch_following",
        summary: "Set the active take to half speed with pitch following rate.",
        input: { playrate: 0.5, preserve_pitch: false },
      },
    ],
  }),
  commandDescriptor({
    id: "template.items.set_item_snap_offset",
    title: "Set item snap offset",
    summary: "Set one item's item-local snap offset in seconds without changing project grid settings.",
    entity_kind: "item",
    tags: ["items", "item", "snap"],
    bridge: bridge({ capability: "items.set_item_snap_offset" }),
    inputSchema: objectSchema({
      snap_offset_seconds: { type: "number" },
    }, ["snap_offset_seconds"]),
    outputSchema: objectSchema({
      item_ref: { type: "string" },
      snap_offset_seconds: { type: "number" },
    }, ["item_ref", "snap_offset_seconds"]),
    expectedDelta: mutationDelta({
      summary: "Updates one item's local snap offset field.",
      entities: [
        {
          entity_kind: "item",
          action: "update",
          summary: "Item snap offset is updated.",
        },
      ],
      idempotent: true,
    }),
    verification: requiredVerification({
      name: "item_snap_offset_matches",
      kind: "state_delta",
      summary: "Item snap offset readback matches the requested value.",
    }),
    examples: [
      {
        name: "set_item_attack_snap_offset",
        summary: "Set snap offset 50 ms after item start.",
        input: { snap_offset_seconds: 0.05 },
      },
    ],
  }),
]);

export function createWave1AItemsTemplates() {
  return cloneJson(WAVE1A_ITEMS_TEMPLATES);
}

function readDescriptor(overrides = {}) {
  return descriptor({
    risk: "read",
    bridge: bridge({
      operation_family: "query_state",
      operation_name: "items.read_item_summary",
      capability: "items.read_item_summary",
      idempotency: "none",
    }),
    expectedDelta: readDelta(),
    verification: verification({ mode: "none", checks: [] }),
    ...overrides,
  });
}

function commandDescriptor(overrides = {}) {
  return descriptor({
    risk: "write",
    bridge: bridge(),
    refs: refs({
      input: [ref("item_ref", "item", true, "Item ref to mutate.")],
      output: [ref("item_ref", "item", true, "Mutated item ref.")],
    }),
    expectedDelta: mutationDelta(),
    verification: requiredVerification({
      name: "item_state_matches",
      kind: "state_delta",
      summary: "Item state readback matches the requested mutation.",
    }),
    ...overrides,
  });
}

function destructiveDescriptor(overrides = {}) {
  return commandDescriptor({
    risk: "destructive",
    bridge: bridge({
      capability: "items.delete_item",
      idempotency: "none",
    }),
    ...overrides,
  });
}

function descriptor(overrides = {}) {
  return {
    contract: TEMPLATE_DESCRIPTOR_CONTRACT,
    id: "template.items.read_item_summary",
    title: "Item template",
    summary: "Run one bounded item template.",
    pack: "items",
    lifecycle: "experimental",
    risk: "read",
    entity_kind: "item",
    tags: ["items"],
    bridge: bridge(),
    inputSchema: objectSchema(),
    outputSchema: objectSchema({
      item_ref: { type: "string" },
    }, []),
    refs: refs(),
    artifacts: artifacts(),
    expectedDelta: readDelta(),
    verification: verification({ mode: "none", checks: [] }),
    examples: [
      {
        name: "item_template",
        summary: "Run a bounded item template.",
        input: {},
      },
    ],
    ...overrides,
  };
}

function bridge(overrides = {}) {
  return {
    operation_family: "run_command",
    operation_name: "template.execute",
    capability: "items.move_item",
    idempotency: "supported",
    timeout_ms: 5_000,
    ...overrides,
  };
}

function objectSchema(properties = {}, required = Object.keys(properties)) {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

function nullableNumberSchema() {
  return {
    oneOf: [
      { type: "number" },
      { type: "null" },
    ],
  };
}

function refs(overrides = {}) {
  return {
    input: [],
    output: [],
    ...overrides,
  };
}

function ref(name, kind, required, summary = `${kind} ref.`) {
  return {
    name,
    kind,
    required,
    summary,
  };
}

function artifacts(overrides = {}) {
  return {
    mode: "none",
    input: [],
    output: [],
    ...overrides,
  };
}

function readDelta(overrides = {}) {
  return {
    kind: "read",
    summary: "Reads compact item state.",
    entities: [
      {
        entity_kind: "item",
        action: "read",
        summary: "Item state is read.",
      },
    ],
    idempotent: true,
    ...overrides,
  };
}

function mutationDelta(overrides = {}) {
  return {
    kind: "mutation",
    summary: "Updates one bounded item state surface.",
    entities: [
      {
        entity_kind: "item",
        action: "update",
        summary: "Item state is updated.",
      },
    ],
    idempotent: true,
    ...overrides,
  };
}

function itemUpdateDelta(summary) {
  return mutationDelta({
    summary,
    entities: [
      {
        entity_kind: "item",
        action: "update",
        summary,
      },
    ],
    idempotent: true,
  });
}

function takeUpdateDelta(summary) {
  return mutationDelta({
    summary,
    entities: [
      {
        entity_kind: "take",
        action: "update",
        summary,
      },
    ],
    idempotent: true,
  });
}

function verification(overrides = {}) {
  return {
    mode: "required",
    checks: [],
    ...overrides,
  };
}

function requiredVerification(check) {
  return verification({
    mode: "required",
    checks: [check],
  });
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
