-- lib/artifacts.lua — OpenReaper artifact v1 storage helper.
--
-- Slice 21 keeps artifacts deliberately boring:
--   * JSON only;
--   * refs are pack-qualified, never raw paths;
--   * files live under <dirname(QUEUE_DIR)>/artifacts/v1;
--   * reads are bounded by the same response cap as get_state list scopes.

local M = {}

local CONTRACT = "openreaper.artifact.v1"
local DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60
local DEFAULT_MAX_RESPONSE_BYTES = 65536

local function dirname(path)
  return tostring(path or "."):match("^(.*)/[^/]*$") or "."
end

local function read_file(path)
  local f = io.open(path, "r")
  if not f then return nil end
  local data = f:read("*a")
  f:close()
  return data
end

local function write_file_atomic(path, content)
  local tmp = path .. ".tmp"
  local f, open_err = io.open(tmp, "w")
  if not f then return false, "open failed: " .. tostring(open_err) end
  f:write(content)
  f:close()
  local ok, rename_err = os.rename(tmp, path)
  if not ok then
    os.remove(tmp)
    return false, "rename failed: " .. tostring(rename_err)
  end
  return true
end

local function is_valid_pack_id(value)
  return type(value) == "string" and value:match("^[a-z][a-z0-9_]*$") ~= nil
end

local function is_valid_scope(value)
  return type(value) == "string" and value:match("^[a-z][a-z0-9_]*$") ~= nil
end

local function parse_id(value)
  if type(value) ~= "string" then return nil end
  local ts, seq, suffix = value:match("^art_(%d+)_(%d%d%d)_([a-f0-9]+)$")
  if not ts or #ts ~= 17 or #suffix ~= 6 then return nil end
  return ts, seq, suffix
end

local function is_valid_id(value)
  return parse_id(value) ~= nil
end

function M.parse_ref(ref)
  if type(ref) ~= "string" then return nil end
  local owner_pack, scope, id = ref:match("^artifact:([a-z][a-z0-9_]*):([a-z][a-z0-9_]*):(art_[%d]+_%d%d%d_[a-f0-9]+)$")
  if not owner_pack or not is_valid_id(id) then return nil end
  return {
    owner_pack = owner_pack,
    scope = scope,
    id = id,
  }
end

local function format_ref(owner_pack, scope, id)
  return "artifact:" .. owner_pack .. ":" .. scope .. ":" .. id
end

local function derive_id(command_id)
  if type(command_id) ~= "string" then return nil end
  local ts, seq, suffix = command_id:match("^cmd_(%d+)_(%d%d%d)_([a-fA-F0-9]+)")
  if not ts or #ts ~= 17 or not suffix or #suffix < 6 then return nil end
  return "art_" .. ts .. "_" .. seq .. "_" .. suffix:sub(1, 6):lower()
end

local function created_at_from_id(id)
  local ts = parse_id(id)
  if not ts then return os.date("!%Y-%m-%dT%H:%M:%S.000Z") end
  return string.format(
    "%s-%s-%sT%s:%s:%s.%sZ",
    ts:sub(1, 4),
    ts:sub(5, 6),
    ts:sub(7, 8),
    ts:sub(9, 10),
    ts:sub(11, 12),
    ts:sub(13, 14),
    ts:sub(15, 17)
  )
end

local function envelope_error(errs, code, message, recoverable)
  return {
    ok = false,
    error = {
      code = code,
      message = message,
      recoverable = recoverable ~= false,
    },
  }
end

local ArtifactStore = {}
ArtifactStore.__index = ArtifactStore

function M.new(opts)
  opts = opts or {}
  local queue_dir = opts.queue_dir or "."
  local state_root = opts.state_root or dirname(queue_dir)
  local self = {
    root = state_root .. "/artifacts/v1",
    json = opts.json,
    errs = opts.errs,
    log = opts.log or function(_) end,
    max_response_bytes = opts.max_response_bytes or DEFAULT_MAX_RESPONSE_BYTES,
    ttl_seconds = opts.ttl_seconds or DEFAULT_TTL_SECONDS,
  }
  return setmetatable(self, ArtifactStore)
end

function ArtifactStore:path_for_parts(parts)
  if not parts
    or not is_valid_pack_id(parts.owner_pack)
    or not is_valid_scope(parts.scope)
    or not is_valid_id(parts.id) then
    return nil
  end
  return self.root .. "/" .. parts.owner_pack .. "/" .. parts.scope .. "/" .. parts.id .. ".json"
end

function ArtifactStore:path_for_ref(ref)
  local parts = M.parse_ref(ref)
  if not parts then return nil end
  return self:path_for_parts(parts), parts
end

function ArtifactStore:write_json(opts)
  local errs = self.errs
  if not self.json or not errs then
    error("Artifact store missing json/errs dependencies")
  end

  local owner_pack = opts and opts.owner_pack
  local scope = opts and opts.scope
  if type(opts.producer_template) ~= "string" or opts.producer_template == "" then
    error({ code = errs.INTERNAL_ERROR, message = "Artifact producer_template is required", recoverable = false })
  end
  if type(opts.schema) ~= "string" or opts.schema == "" then
    error({ code = errs.INTERNAL_ERROR, message = "Artifact schema is required", recoverable = false })
  end
  if not is_valid_pack_id(owner_pack) then
    error({ code = errs.INTERNAL_ERROR, message = "Invalid artifact owner_pack", recoverable = false })
  end
  if not is_valid_scope(scope) then
    error({ code = errs.INTERNAL_ERROR, message = "Invalid artifact scope", recoverable = false })
  end

  local id = derive_id(opts.command_id)
  if not id then
    error({ code = errs.INTERNAL_ERROR, message = "Could not derive artifact id from queue command id", recoverable = false })
  end

  local ref = format_ref(owner_pack, scope, id)
  local path = self:path_for_parts({ owner_pack = owner_pack, scope = scope, id = id })
  if not path then
    error({ code = errs.INTERNAL_ERROR, message = "Could not build artifact path", recoverable = false })
  end

  local dir = self.root .. "/" .. owner_pack .. "/" .. scope
  reaper.RecursiveCreateDirectory(dir, 0)

  local artifact = {
    artifact_contract = CONTRACT,
    ref = ref,
    id = id,
    scope = scope,
    owner_pack = owner_pack,
    producer_template = opts.producer_template,
    schema = opts.schema,
    created_at = created_at_from_id(id),
    summary = opts.summary or {},
    payload = opts.payload or {},
  }

  local ok_encode, encoded_or_err = pcall(self.json.encode, artifact)
  if not ok_encode then
    error({ code = errs.INTERNAL_ERROR, message = "Could not encode artifact JSON: " .. tostring(encoded_or_err), recoverable = false })
  end
  local ok_write, write_err = write_file_atomic(path, encoded_or_err)
  if not ok_write then
    error({ code = errs.INTERNAL_ERROR, message = "Could not write artifact JSON: " .. tostring(write_err), recoverable = false })
  end

  return ref
end

local function has_required_artifact_fields(value)
  return type(value) == "table"
    and value.artifact_contract == CONTRACT
    and type(value.ref) == "string"
    and type(value.id) == "string"
    and type(value.scope) == "string"
    and type(value.owner_pack) == "string"
    and type(value.producer_template) == "string"
    and type(value.schema) == "string"
    and type(value.created_at) == "string"
    and type(value.summary) == "table"
    and type(value.payload) == "table"
end

function ArtifactStore:read(ref, view)
  local errs = self.errs
  view = view or "summary"
  if view ~= "summary" and view ~= "payload" then
    return envelope_error(errs, errs.PARAMS_INVALID, "artifact view must be 'summary' or 'payload'", true)
  end

  local path, parts = self:path_for_ref(ref)
  if not path or not parts then
    return envelope_error(errs, errs.PARAMS_INVALID, "Malformed artifact_ref; expected artifact:<owner_pack>:<scope>:<id>", true)
  end

  local raw = read_file(path)
  if not raw then
    return envelope_error(errs, errs.ARTIFACT_NOT_FOUND, "Artifact not found: " .. ref, true)
  end

  local ok_decode, artifact = pcall(self.json.decode, raw)
  if not ok_decode or not has_required_artifact_fields(artifact) then
    return envelope_error(errs, errs.ARTIFACT_INVALID, "Artifact JSON is invalid: " .. ref, true)
  end
  if artifact.ref ~= ref or artifact.id ~= parts.id or artifact.scope ~= parts.scope or artifact.owner_pack ~= parts.owner_pack then
    return envelope_error(errs, errs.ARTIFACT_INVALID, "Artifact JSON does not match requested ref: " .. ref, true)
  end

  local out = {
    ref = artifact.ref,
    id = artifact.id,
    scope = artifact.scope,
    owner_pack = artifact.owner_pack,
    producer_template = artifact.producer_template,
    schema = artifact.schema,
    created_at = artifact.created_at,
    summary = artifact.summary,
    view = view,
    truncated = false,
  }
  if view == "payload" then
    out.payload = artifact.payload
  end

  local envelope = { artifact = out }
  local ok_encode, encoded_or_err = pcall(self.json.encode, envelope)
  if not ok_encode then
    return envelope_error(errs, errs.ARTIFACT_INVALID, "Artifact response could not be encoded: " .. tostring(encoded_or_err), true)
  end
  if #encoded_or_err > self.max_response_bytes then
    return envelope_error(errs, errs.RESPONSE_TOO_LARGE, "Artifact response exceeds the 65536 byte response cap", true)
  end
  for _ = 1, 3 do
    out.response_bytes = #encoded_or_err
    ok_encode, encoded_or_err = pcall(self.json.encode, envelope)
    if not ok_encode then
      return envelope_error(errs, errs.ARTIFACT_INVALID, "Artifact response could not be encoded: " .. tostring(encoded_or_err), true)
    end
    if out.response_bytes == #encoded_or_err then break end
  end
  out.response_bytes = #encoded_or_err
  if out.response_bytes > self.max_response_bytes then
    return envelope_error(errs, errs.RESPONSE_TOO_LARGE, "Artifact response exceeds the 65536 byte response cap", true)
  end

  return { ok = true, result = envelope }
end

local function enumerate_dir(path)
  local names = {}
  local i = 0
  while true do
    local name = reaper.EnumerateFiles(path, i)
    if not name then break end
    names[#names + 1] = name
    i = i + 1
  end
  return names
end

local function enumerate_subdirs(path)
  local names = {}
  local i = 0
  while true do
    local name = reaper.EnumerateSubdirectories(path, i)
    if not name then break end
    names[#names + 1] = name
    i = i + 1
  end
  return names
end

local function shell_quote(value)
  return "'" .. tostring(value):gsub("'", "'\\''") .. "'"
end

local function exec_number(cmd)
  if type(reaper.ExecProcess) ~= "function" then return nil end
  local ok, output = pcall(reaper.ExecProcess, cmd, 1000)
  if not ok or type(output) ~= "string" then return nil end
  local text = output:gsub("\r", "\n")
  local trimmed = text:gsub("^%s+", ""):gsub("%s+$", "")
  local as_number = tonumber(trimmed)
  if as_number then return as_number end
  local after_status = text:match("^[^\n]*\n(.-)%s*$")
  if not after_status then return nil end
  return tonumber((after_status:gsub("^%s+", ""):gsub("%s+$", "")))
end

local function file_mtime_seconds(path)
  local os_name = type(reaper.GetOS) == "function" and reaper.GetOS() or ""
  if tostring(os_name):match("^OSX") or tostring(os_name):match("^macOS") then
    return exec_number("/usr/bin/stat -f %m " .. shell_quote(path))
  end
  if tostring(os_name):lower():match("linux") then
    return exec_number("/usr/bin/stat -c %Y " .. shell_quote(path))
  end
  return nil
end

function ArtifactStore:sweep_old()
  reaper.RecursiveCreateDirectory(self.root, 0)
  local now = os.time()
  local cutoff = now - self.ttl_seconds
  local removed = 0

  local ok_sweep, sweep_err = pcall(function()
    for _, owner in ipairs(enumerate_subdirs(self.root)) do
      if not is_valid_pack_id(owner) then
        self.log("artifact-sweep: leaving unexpected owner dir " .. tostring(owner))
      else
        local owner_dir = self.root .. "/" .. owner
        for _, scope in ipairs(enumerate_subdirs(owner_dir)) do
          if not is_valid_scope(scope) then
            self.log("artifact-sweep: leaving unexpected scope dir " .. tostring(owner) .. "/" .. tostring(scope))
          else
            local scope_dir = owner_dir .. "/" .. scope
            for _, file in ipairs(enumerate_dir(scope_dir)) do
              if file:sub(-5) ~= ".json" then
                self.log("artifact-sweep: leaving non-json file " .. tostring(owner) .. "/" .. tostring(scope) .. "/" .. tostring(file))
              else
                local id = file:sub(1, -6)
                if not is_valid_id(id) then
                  self.log("artifact-sweep: leaving unexpected artifact file " .. tostring(owner) .. "/" .. tostring(scope) .. "/" .. tostring(file))
                else
                  local path = scope_dir .. "/" .. file
                  local mtime = file_mtime_seconds(path)
                  if not mtime then
                    self.log("artifact-sweep: leaving artifact with unavailable mtime " .. tostring(owner) .. "/" .. tostring(scope) .. "/" .. tostring(file))
                  elseif mtime < cutoff then
                    local ok_remove, remove_err = os.remove(scope_dir .. "/" .. file)
                    if ok_remove then
                      removed = removed + 1
                    else
                      self.log("artifact-sweep: remove failed for " .. tostring(file) .. ": " .. tostring(remove_err))
                    end
                  end
                end
              end
            end
          end
        end
      end
    end
  end)

  if not ok_sweep then
    self.log("artifact-sweep failed: " .. tostring(sweep_err))
    return
  end
  if removed > 0 then
    self.log("artifact-sweep: removed " .. tostring(removed) .. " expired artifact"
      .. (removed == 1 and "" or "s"))
  end
end

return M
