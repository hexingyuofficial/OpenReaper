-- json.lua: minimal JSON encoder/decoder for the Streetlight Lua bridge.
--
-- Scope:
--   - encode: strings, numbers, booleans, nil, sequential arrays, string-keyed objects
--   - decode: standard JSON (RFC 8259 subset, no Unicode surrogate pairs)
--
-- Known limitation: empty Lua tables encode as `{}` (object) by default. To
-- force an array, use `json.array(t)` to tag a table as an array even if it
-- has no entries.

local json = {}

-- ─── Encoder ────────────────────────────────────────────────────────────────

local function encode_string(s)
  local result = s:gsub('[%c"\\]', function(c)
    if c == '"'  then return '\\"'  end
    if c == '\\' then return '\\\\' end
    if c == '\n' then return '\\n'  end
    if c == '\r' then return '\\r'  end
    if c == '\t' then return '\\t'  end
    if c == '\b' then return '\\b'  end
    if c == '\f' then return '\\f'  end
    return string.format('\\u%04x', c:byte())
  end)
  return '"' .. result .. '"'
end

local function is_array(t)
  if rawget(t, "__streetlight_array") == true then return true, #t end
  local n = 0
  for k, _ in pairs(t) do
    if type(k) ~= "number" or k ~= math.floor(k) or k < 1 then
      return false, 0
    end
    if k > n then n = k end
  end
  -- Sparse arrays not allowed.
  for i = 1, n do
    if t[i] == nil then return false, 0 end
  end
  return true, n
end

local encode_value

encode_value = function(v)
  local t = type(v)
  if t == "nil"     then return "null" end
  if t == "boolean" then return v and "true" or "false" end
  if t == "number" then
    if v ~= v                then error("Cannot encode NaN") end
    if v == math.huge        then error("Cannot encode +Infinity") end
    if v == -math.huge       then error("Cannot encode -Infinity") end
    if v == math.floor(v) and math.abs(v) < 1e15 then
      return tostring(math.floor(v))
    end
    return tostring(v)
  end
  if t == "string" then return encode_string(v) end
  if t == "table" then
    local arr, n = is_array(v)
    if arr then
      local parts = {}
      for i = 1, n do parts[i] = encode_value(v[i]) end
      return "[" .. table.concat(parts, ",") .. "]"
    else
      local parts = {}
      -- Sorted keys for deterministic output (helps tests and grep).
      local keys = {}
      for k in pairs(v) do
        if k ~= "__streetlight_array" then keys[#keys + 1] = k end
      end
      table.sort(keys, function(a, b) return tostring(a) < tostring(b) end)
      for _, k in ipairs(keys) do
        if type(k) ~= "string" then
          error("Object keys must be strings, got " .. type(k))
        end
        parts[#parts + 1] = encode_string(k) .. ":" .. encode_value(v[k])
      end
      return "{" .. table.concat(parts, ",") .. "}"
    end
  end
  error("Cannot encode type: " .. t)
end

function json.encode(value)
  return encode_value(value)
end

function json.array(t)
  t = t or {}
  t.__streetlight_array = true
  return t
end

-- ─── Decoder ────────────────────────────────────────────────────────────────

local decode_value

local function skip_ws(s, i)
  local _, e = s:find("^[ \t\r\n]*", i)
  return e + 1
end

local function decode_string(s, i)
  -- assumes s:sub(i, i) == '"'
  i = i + 1
  local parts = {}
  while i <= #s do
    local c = s:sub(i, i)
    if c == '"' then return table.concat(parts), i + 1 end
    if c == '\\' then
      local esc = s:sub(i + 1, i + 1)
      if     esc == '"'  then parts[#parts + 1] = '"';  i = i + 2
      elseif esc == '\\' then parts[#parts + 1] = '\\'; i = i + 2
      elseif esc == '/'  then parts[#parts + 1] = '/';  i = i + 2
      elseif esc == 'n'  then parts[#parts + 1] = '\n'; i = i + 2
      elseif esc == 'r'  then parts[#parts + 1] = '\r'; i = i + 2
      elseif esc == 't'  then parts[#parts + 1] = '\t'; i = i + 2
      elseif esc == 'b'  then parts[#parts + 1] = '\b'; i = i + 2
      elseif esc == 'f'  then parts[#parts + 1] = '\f'; i = i + 2
      elseif esc == 'u'  then
        local hex = s:sub(i + 2, i + 5)
        local code = tonumber(hex, 16)
        if not code then error("Bad \\u escape at position " .. i) end
        -- Encode as UTF-8. We do not handle surrogate pairs in v0.1; commands
        -- and results stay in the Basic Multilingual Plane.
        if code < 0x80 then
          parts[#parts + 1] = string.char(code)
        elseif code < 0x800 then
          parts[#parts + 1] = string.char(
            0xC0 + math.floor(code / 0x40),
            0x80 + (code % 0x40)
          )
        else
          parts[#parts + 1] = string.char(
            0xE0 + math.floor(code / 0x1000),
            0x80 + (math.floor(code / 0x40) % 0x40),
            0x80 + (code % 0x40)
          )
        end
        i = i + 6
      else
        error("Bad escape \\" .. esc .. " at position " .. i)
      end
    else
      parts[#parts + 1] = c
      i = i + 1
    end
  end
  error("Unterminated string starting at position " .. (i))
end

local function decode_number(s, i)
  local _, e = s:find("^%-?[0-9]+%.?[0-9]*[eE]?[%-+]?[0-9]*", i)
  if not e or e < i then error("Bad number at position " .. i) end
  local num = tonumber(s:sub(i, e))
  if not num then error("Bad number at position " .. i) end
  return num, e + 1
end

decode_value = function(s, i)
  i = skip_ws(s, i)
  if i > #s then error("Unexpected end of JSON") end
  local c = s:sub(i, i)

  if c == '"' then return decode_string(s, i) end

  if c == '{' then
    local obj = {}
    i = skip_ws(s, i + 1)
    if s:sub(i, i) == '}' then return obj, i + 1 end
    while true do
      i = skip_ws(s, i)
      if s:sub(i, i) ~= '"' then
        error("Expected string key at position " .. i)
      end
      local k
      k, i = decode_string(s, i)
      i = skip_ws(s, i)
      if s:sub(i, i) ~= ':' then
        error("Expected ':' at position " .. i)
      end
      i = skip_ws(s, i + 1)
      local v
      v, i = decode_value(s, i)
      obj[k] = v
      i = skip_ws(s, i)
      local nc = s:sub(i, i)
      if nc == '}' then return obj, i + 1 end
      if nc ~= ',' then
        error("Expected ',' or '}' at position " .. i)
      end
      i = i + 1
    end
  end

  if c == '[' then
    local arr = json.array({})
    i = skip_ws(s, i + 1)
    if s:sub(i, i) == ']' then return arr, i + 1 end
    while true do
      i = skip_ws(s, i)
      local v
      v, i = decode_value(s, i)
      arr[#arr + 1] = v
      i = skip_ws(s, i)
      local nc = s:sub(i, i)
      if nc == ']' then return arr, i + 1 end
      if nc ~= ',' then
        error("Expected ',' or ']' at position " .. i)
      end
      i = i + 1
    end
  end

  if c == 't' and s:sub(i, i + 3) == 'true'  then return true,  i + 4 end
  if c == 'f' and s:sub(i, i + 4) == 'false' then return false, i + 5 end
  if c == 'n' and s:sub(i, i + 3) == 'null'  then return nil,   i + 4 end
  if c == '-' or (c >= '0' and c <= '9') then return decode_number(s, i) end

  error("Unexpected character '" .. c .. "' at position " .. i)
end

function json.decode(s)
  if type(s) ~= "string" then error("Expected string") end
  local v, i = decode_value(s, 1)
  i = skip_ws(s, i)
  if i <= #s then
    error("Trailing data after JSON at position " .. i)
  end
  return v
end

return json
