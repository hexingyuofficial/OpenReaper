# Pack Contract Fixture

`pack_contract_fixture` is a test-only pack for Slice 20B and Slice 21.
It proves that a non-core pack can contribute:

- TypeScript template definitions,
- Lua manifest entries and handlers,
- one recipe directory,
- one docs namespace,
- one JSON artifact producer.

Enable it only for pack-contract verification:

```sh
STREETLIGHT_ENABLED_PACKS=core,pack_contract_fixture npm run check:manifest
STREETLIGHT_ENABLED_PACKS=core,pack_contract_fixture npm run check:template-authoring
```

For a live REAPER smoke, set this before loading `start_bridge.lua`:

```lua
_G.STREETLIGHT_ENABLED_PACKS = "core,pack_contract_fixture"
```

Then `list_templates` should include `fixture_track_rename` and
`fixture_artifact_probe`. `call_template fixture_track_rename` should
rename a track using the same track resolver and LAST_RESULT bucket as the
core track templates. `call_template fixture_artifact_probe` should return
one `artifact:pack_contract_fixture:probe:<id>` ref, and
`get_state(scope:"artifact", artifact_ref:<that ref>)` should read the
summary/payload without changing project `LAST_RESULT`.
