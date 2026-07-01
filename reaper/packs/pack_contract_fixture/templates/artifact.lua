-- Fixture pack artifact templates.
--
-- This is not a user-facing feature. It proves the Slice 21 JSON artifact
-- contract from a non-core pack without shipping cleanup/analysis/MIDI code.

local M = {}

local function raise(code, message)
  error({ code = code, message = message })
end

function M.fixture_artifact_probe(params, ctx)
  if not ctx.artifacts then
    raise(ctx.errs.INTERNAL_ERROR, "Artifact helper was not provided to template context")
  end

  local label = params.label
  local ref = ctx.artifacts:write_json({
    owner_pack = "pack_contract_fixture",
    scope = "probe",
    producer_template = "fixture_artifact_probe",
    schema = "openreaper.fixture.probe.v1",
    command_id = ctx.command_id,
    summary = {
      label = label,
    },
    payload = {
      label = label,
      note = "fixture-only payload",
    },
  })

  return { changed_ids = { ref } }
end

return M
