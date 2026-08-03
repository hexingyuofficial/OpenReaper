[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("ReadFile", "InspectDirectory")]
    [string] $Mode,
    [Parameter(Mandatory = $true)]
    [string] $LiteralPath,
    [ValidateRange(1, 1048576)]
    [int] $MaxBytes = 16384
)

$ErrorActionPreference = "Stop"

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

public static class OpenReaperWindowsSafeFileNative
{
    [StructLayout(LayoutKind.Sequential)]
    public struct ByHandleFileInformation
    {
        public UInt32 FileAttributes;
        public UInt32 CreationTimeLow;
        public UInt32 CreationTimeHigh;
        public UInt32 LastAccessTimeLow;
        public UInt32 LastAccessTimeHigh;
        public UInt32 LastWriteTimeLow;
        public UInt32 LastWriteTimeHigh;
        public UInt32 VolumeSerialNumber;
        public UInt32 FileSizeHigh;
        public UInt32 FileSizeLow;
        public UInt32 NumberOfLinks;
        public UInt32 FileIndexHigh;
        public UInt32 FileIndexLow;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern SafeFileHandle CreateFile(
        string fileName,
        UInt32 desiredAccess,
        UInt32 shareMode,
        IntPtr securityAttributes,
        UInt32 creationDisposition,
        UInt32 flagsAndAttributes,
        IntPtr templateFile);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool GetFileInformationByHandle(
        SafeFileHandle handle,
        out ByHandleFileInformation information);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool ReadFile(
        SafeFileHandle handle,
        byte[] buffer,
        UInt32 bytesToRead,
        out UInt32 bytesRead,
        IntPtr overlapped);

    public const UInt32 GenericRead = 0x80000000;
    public const UInt32 GenericWrite = 0x40000000;
    public const UInt32 FileShareRead = 0x00000001;
    public const UInt32 FileShareWrite = 0x00000002;
    public const UInt32 FileShareDelete = 0x00000004;
    public const UInt32 OpenExisting = 3;
    public const UInt32 FileFlagOpenReparsePoint = 0x00200000;
    public const UInt32 FileFlagBackupSemantics = 0x02000000;
    public const UInt32 FileAttributeReadonly = 0x00000001;
    public const UInt32 FileAttributeDirectory = 0x00000010;
    public const UInt32 FileAttributeReparsePoint = 0x00000400;
}
'@

function Write-Result([hashtable] $Result) {
    $Result.contract = "openreaper.windows_safe_file.v1"
    $Result | ConvertTo-Json -Compress -Depth 4
    exit 0
}

function Get-UInt64([uint32] $High, [uint32] $Low) {
    return ([uint64]$High * [uint64]4294967296) + [uint64]$Low
}

function Convert-FileTimeToUnixMilliseconds([uint32] $High, [uint32] $Low) {
    $fileTime = Get-UInt64 $High $Low
    $unixEpoch = [DateTime]::new(1970, 1, 1, 0, 0, 0, [DateTimeKind]::Utc)
    return ([DateTime]::FromFileTimeUtc([int64]$fileTime) - $unixEpoch).TotalMilliseconds
}

function Get-NativeSnapshot([Microsoft.Win32.SafeHandles.SafeFileHandle] $Handle) {
    $info = New-Object OpenReaperWindowsSafeFileNative+ByHandleFileInformation
    if (-not [OpenReaperWindowsSafeFileNative]::GetFileInformationByHandle($Handle, [ref]$info)) {
        throw "GetFileInformationByHandle failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
    }
    return [pscustomobject]@{
        attributes = [uint32]$info.FileAttributes
        size = [uint64](Get-UInt64 $info.FileSizeHigh $info.FileSizeLow)
        nlink = [uint32]$info.NumberOfLinks
        volume = [uint32]$info.VolumeSerialNumber
        index = [uint64](Get-UInt64 $info.FileIndexHigh $info.FileIndexLow)
        mtime_ms = [double](Convert-FileTimeToUnixMilliseconds $info.LastWriteTimeHigh $info.LastWriteTimeLow)
        ctime_ms = [double](Convert-FileTimeToUnixMilliseconds $info.CreationTimeHigh $info.CreationTimeLow)
    }
}

function Open-NativePath([string] $Path, [bool] $Directory, [bool] $Writable) {
    [uint32]$access = [OpenReaperWindowsSafeFileNative]::GenericRead
    if ($Writable) { $access = $access -bor [OpenReaperWindowsSafeFileNative]::GenericWrite }
    [uint32]$flags = [OpenReaperWindowsSafeFileNative]::FileFlagOpenReparsePoint
    if ($Directory) { $flags = $flags -bor [OpenReaperWindowsSafeFileNative]::FileFlagBackupSemantics }
    return [OpenReaperWindowsSafeFileNative]::CreateFile(
        $Path,
        $access,
        ([OpenReaperWindowsSafeFileNative]::FileShareRead -bor [OpenReaperWindowsSafeFileNative]::FileShareWrite -bor [OpenReaperWindowsSafeFileNative]::FileShareDelete),
        [IntPtr]::Zero,
        [OpenReaperWindowsSafeFileNative]::OpenExisting,
        $flags,
        [IntPtr]::Zero)
}

function Get-ErrorResult([int] $ErrorCode, [bool] $Directory) {
    if ($ErrorCode -in @(2, 3, 53)) { return @{ status = "missing"; error_code = [string]$ErrorCode } }
    if ($Directory -and $ErrorCode -in @(5, 32, 33)) { return @{ status = "not_writable"; error_code = [string]$ErrorCode } }
    return @{ status = "invalid"; reason = "native_open_failed"; error_code = [string]$ErrorCode }
}

$handle = $null
try {
    if ([string]::IsNullOrWhiteSpace($LiteralPath) -or $LiteralPath.IndexOf([char]0) -ge 0) {
        Write-Result @{ status = "invalid"; reason = "path_invalid" }
    }

    $isDirectory = $Mode -eq "InspectDirectory"
    $handle = Open-NativePath $LiteralPath $isDirectory $isDirectory
    if ($null -eq $handle -or $handle.IsInvalid) {
        $code = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
        Write-Result (Get-ErrorResult $code $isDirectory)
    }

    $before = Get-NativeSnapshot $handle
    if (($before.attributes -band [OpenReaperWindowsSafeFileNative]::FileAttributeReparsePoint) -ne 0) {
        Write-Result @{ status = "symlink" }
    }
    $hasDirectoryAttribute = ($before.attributes -band [OpenReaperWindowsSafeFileNative]::FileAttributeDirectory) -ne 0

    if ($isDirectory) {
        if (-not $hasDirectoryAttribute) { Write-Result @{ status = "not_directory" } }
        $after = Get-NativeSnapshot $handle
        if ($before.volume -ne $after.volume -or $before.index -ne $after.index) {
            Write-Result @{ status = "invalid"; reason = "directory_changed_during_inspection" }
        }
        Write-Result @{ status = "ready"; kind = "directory" }
    }

    if ($hasDirectoryAttribute) { Write-Result @{ status = "invalid"; reason = "not_regular_file" } }
    if ($before.nlink -ne 1) { Write-Result @{ status = "invalid"; reason = "link_count_invalid" } }
    if ($before.size -gt [uint64]$MaxBytes) { Write-Result @{ status = "invalid"; reason = "file_too_large" } }

    $stream = New-Object IO.MemoryStream
    try {
        while ($stream.Length -lt [int64]$before.size) {
            $remaining = [int64]$before.size - $stream.Length
            $chunkSize = [int][Math]::Min(65536, $remaining)
            $buffer = New-Object byte[] $chunkSize
            [uint32]$bytesRead = 0
            if (-not [OpenReaperWindowsSafeFileNative]::ReadFile($handle, $buffer, [uint32]$chunkSize, [ref]$bytesRead, [IntPtr]::Zero)) {
                $code = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
                Write-Result @{ status = "invalid"; reason = "native_read_failed"; error_code = [string]$code }
            }
            if ($bytesRead -eq 0) { break }
            $stream.Write($buffer, 0, [int]$bytesRead)
        }
        $payload = $stream.ToArray()
    } finally {
        $stream.Dispose()
    }

    $after = Get-NativeSnapshot $handle
    if (
        $payload.Length -ne [int64]$before.size -or
        $before.volume -ne $after.volume -or
        $before.index -ne $after.index -or
        $before.size -ne $after.size -or
        $before.nlink -ne $after.nlink -or
        $before.mtime_ms -ne $after.mtime_ms -or
        $before.ctime_ms -ne $after.ctime_ms
    ) {
        Write-Result @{ status = "invalid"; reason = "file_changed_during_read" }
    }
    Write-Result @{
        status = "valid"
        kind = "file"
        size = [int64]$payload.Length
        bytes = [int64]$payload.Length
        base64 = [Convert]::ToBase64String($payload)
        mtime_ms = [double]$after.mtime_ms
        ctime_ms = [double]$after.ctime_ms
        nlink = [int]$after.nlink
        read_only = (($after.attributes -band [OpenReaperWindowsSafeFileNative]::FileAttributeReadonly) -ne 0)
    }
} catch {
    Write-Result @{ status = "invalid"; reason = "native_safe_read_failed" }
} finally {
    if ($null -ne $handle) { $handle.Dispose() }
}
