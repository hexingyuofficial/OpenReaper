-- lib/names.lua — name-content validation rules shared across the pack.
--
-- v0.1 owns the "what characters are legal in a REAPER region name" rule
-- here, in Lua, NOT in the TS Zod schema. Step 5 decision #5 locked the
-- "Lua owns name-content rules" boundary because a TS-side superRefine
-- would steal the REGION_NAME_INVALID domain code under PARAMS_INVALID.
--
-- Step 7 extends the rule from `/ \` (Step 5) to `/ \ NUL $`:
--
--   * `/` and `\` — path separators. Render writes
--     `<output_dir>/<region_name>.wav`; a separator in the name escapes
--     the intended output_dir.
--   * NUL (`\0`) — truncates path strings in libc-backed APIs (REAPER's
--     ReaScript runtime is C); a NUL in the middle of a name silently
--     becomes a different file path.
--   * `$` — REAPER's RENDER_PATTERN wildcard prefix (`$region`,
--     `$project`, `$track`, ...). We use a LITERAL region name as the
--     RENDER_PATTERN (Step 6 decision #3) precisely so token expansion
--     doesn't change our output path; a `$` in the name re-introduces
--     that risk.
--
-- Two call sites, by design:
--   * region_create — rejects at create time so most agents never see a
--     bad name landed in the project.
--   * render_region — re-validates after `resolve_region` because a user
--     can hand-build a region in REAPER's UI with a bad name and feed it
--     to render_region directly. The render path is the one that turns
--     the name into a filename, so it owns its own defense.
--
-- Both sites raise REGION_NAME_INVALID via the handler's own `raise`
-- helper; this module returns the (ok, message) pair and stays free of
-- the error-raising convention.

local M = {}

-- Reject `/`, `\`, NUL (`%z`), `$` (escaped as `%$` for clarity inside
-- the character class). Anywhere in the string is enough to fail.
local FORBIDDEN_PATTERN = "[/\\%z%$]"

-- Validate a region name. Returns (true, nil) on success;
-- (false, message) when the name violates a rule. The message includes
-- the offending name so the agent can correct it without guessing.
function M.validate_region_name(name)
  if type(name) ~= "string" or name == "" then
    return false, "Region name must be a non-empty string"
  end
  if name:find(FORBIDDEN_PATTERN) then
    return false,
      "Region name '" .. name .. "' contains a forbidden character "
        .. "(path separator /, \\, NUL, or render-pattern token $)"
  end
  return true, nil
end

return M
