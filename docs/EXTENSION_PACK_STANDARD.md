# Extension Pack Standard

Status: Alpha3 C3.7 developer standard.

This document defines OpenReaper extension packs. It is for OpenReaper
maintainers, partner developers, and user developers.

Users should understand only this product word:

```text
pack = installable/shareable extension pack
```

Users should not need to understand core capability packs, templates, macros,
handlers, bridge ABI, SQLite rows, or artifact internals.

## Pack Types

OpenReaper uses two different developer terms:

- `core capability pack`: frozen internal capability-domain ownership, such as
  `reaper/packs/<pack>`. This is not a user product concept.
- `extension pack`: installable/shareable plugin, workflow, media library,
  search, or domain capability bundle.

Extension packs may be:

- `official`: shipped by OpenReaper.
- `partner`: reviewed external pack with declared evidence and compatibility.
- `dlc`: installable pack, disabled or package-scoped until validated.
- `local`: user/private pack, never promoted to global alias automatically.

## Hard Boundaries

An extension pack must not add:

- a sixth MCP tool;
- public `call_recipe`;
- hidden recipe executor;
- raw Lua execution;
- raw REAPER action execution;
- shell execution;
- UI automation as a product capability;
- unreviewed template definitions in the normal product path.

Execution still flows through the accepted OpenReaper surface:

```text
list_templates / list_recipes / call_template / get_state / ping
```

If a pack needs missing REAPER capability, OpenReaper must add or fix the
audited handler/template first in a bounded control-tower window.

## Manifest

Every extension pack needs a manifest.

Required fields:

```text
pack_id
namespace
display_name
kind
owner
source
version
openreaper_compatibility
support_status
risk_classes
permissions
dependencies
contributed_capabilities
aliases
evidence
privacy
scrub_policy
cache_policy
changelog
deprecation_policy
```

`namespace` must be globally unique in an installation.

Aliases are package-scoped by default:

```text
<pack_namespace>.<alias>
```

Global aliases are reserved for official OpenReaper promotion and must be exact
match only. No fuzzy alias execution.

## Capability Contracts

An extension pack may contribute one or more capability contracts:

- macro descriptors;
- workflow definitions;
- semantic parameter maps;
- media or search endpoints;
- import actions;
- readback contracts;
- validation metadata;
- examples.

Each capability must declare:

```text
capability_id
kind
user_label
task_intents
input_schema
output_schema
risk_policy
permissions
required_templates
required_handlers
required_plugins
required_services
required_indexes
readback_contract
evidence
support_status
typed_blockers
```

Capability metadata does not grant execution power. Runtime execution must
resolve against the accepted OpenReaper catalog and safety policy.

## Permissions

Packs should ask for narrow permissions.

Common permission groups:

```text
project_read
project_write_reversible
fx_parameter_control
media_library_read
media_preview
media_import
local_index_read
local_index_write
microphone_or_voice_query
cloud_search
download
export_or_overwrite
hardware_io
privacy_sensitive_scan
```

OpenReaper should support risk-domain authorization:

```text
Allow volume and plugin parameter control for this task,
but do not delete, export, overwrite, scan private locations, or change hardware.
```

Destructive delete, overwrite/export, hardware I/O, paid/licensed downloads,
privacy-sensitive scans, and ambiguous irreversible actions still require a
hard stop.

## Install / Share / Fork / Scrub

Pack productization must support:

- install;
- enable;
- disable;
- uninstall;
- update;
- fork;
- share;
- scrub.

Scrub must remove or rewrite:

- local absolute paths;
- request ids;
- project refs;
- private notes;
- secrets and tokens;
- machine-specific plugin paths;
- generated local caches;
- privacy-sensitive index rows;
- licensed assets that cannot be redistributed;
- assumptions that will not work on another machine.

Shared packs should preserve provenance, dependency metadata, support status,
and evidence references.

## Search And Index Packs

Search packs may expose local or external search surfaces, but they are not
truth for REAPER project state and they do not authorize writes.

Search pack responses should be compact by default:

```text
decision summary + candidate refs + scores + source/provenance + coverage
```

Deep payloads, waveforms, embeddings, analysis details, and large result sets
require explicit detail or hydration requests.

## Sound Library Pack

A sound-library pack is the first validation case for media/search extension
packs. It must leave room for:

- text semantic search;
- voice query;
- audio-to-audio similarity search;
- transient or shape search;
- tag/filter search;
- batch search;
- candidate preview;
- source/license/provenance readback;
- import into REAPER through accepted OpenReaper media/project capabilities.

Required result fields:

```text
candidate_ref
label
score
duration
source
license
provenance
preview_status
coverage_status
```

Optional result fields:

```text
tags
bpm
key
loudness
waveform_summary
transient_summary
embedding_model
```

Typed blockers:

```text
PACK_NOT_INSTALLED
PACK_DISABLED
LIBRARY_NOT_FOUND
INDEX_NOT_READY
PRIVACY_NOT_AUTHORIZED
CLOUD_SEARCH_NOT_AUTHORIZED
VOICE_QUERY_NOT_AUTHORIZED
LICENSE_NOT_IMPORTABLE
PREVIEW_UNAVAILABLE
IMPORT_TARGET_UNSUPPORTED
UNSAFE_PATH
```

## Plugin Control Pack

A plugin-control pack such as a Vital pack must declare:

- plugin name/vendor/version identity where available;
- owner-scoped FX identity checks;
- semantic parameter map;
- stable parameter identity assumptions;
- safe ranges;
- beginner labels;
- compact readback;
- preset data policy;
- typed blockers for missing plugin, incompatible version, missing FX owner,
  missing parameter identity, unsafe range, or unsupported preset data.

A preset is data. It is not a macro by itself. A macro must include execution,
safety, and readback contracts.

## Evidence Tiers

Use these evidence tiers:

```text
declared
schema_validated
fake_smoked
runtime_bound
trial_reviewed
live_smoked
supported
deprecated
blocked
```

Support wording must stay tied to evidence. A pack cannot be called supported
because its manifest exists.

## Validation

Pack validation should check:

- manifest schema;
- namespace uniqueness;
- alias collisions;
- dependency compatibility;
- permission declarations;
- risk policy;
- scrub policy;
- capability schemas;
- readback contracts;
- evidence references;
- support status wording.

Invalid or partially valid packs may remain inspectable, but must not expose
executable product entries until validation passes.

## Acceptance

A pack is customer-usable only when:

- install/enable state is clear;
- required dependencies are readable;
- permissions are understandable;
- unsupported or experimental status is visible;
- actions run only through accepted OpenReaper capability paths;
- readback is compact and human-readable;
- blockers are typed and beginner-readable;
- trial officer review passes for user-facing flows;
- bounded live/customer smoke exists for live support claims.
