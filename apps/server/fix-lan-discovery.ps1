```powershell
$ErrorActionPreference = "Stop"

$path = Join-Path $PSScriptRoot "src\server.ts"
$backup = "$path.before-lan-fix"

if (!(Test-Path $path)) {
    throw "server.ts not found: $path"
}

if (!(Test-Path $backup)) {
    throw "Backup not found: $backup"
}

$source = [System.IO.File]::ReadAllText($path)
$original = [System.IO.File]::ReadAllText($backup)

if ($source -ne $original) {
    throw "Current source differs from backup. No changes made."
}

$startMarker = "function getLanIPv4(clientAddress?: string) {"
$endMarker = 'const discoverySocket = createSocket("udp4");'

$start = $source.IndexOf($startMarker)
$end = $source.IndexOf($endMarker)

if ($start -lt 0 -or $end -le $start) {
    throw "Expected function boundaries not found. No changes made."
}

$newFunction = @'
function getLanIPv4(clientAddress?: string) {
  const addresses = Object.values(networkInterfaces())
    .flatMap((network) => network ?? [])
    .filter(
      (address) =>
        address.family === "IPv4" &&
        !address.internal &&
        !address.address.startsWith("169.254.") &&
        isPrivateIPv4(address.address),
    );

  const sameSubnet = clientAddress
    ? addresses.filter((address) => {
        const mask = ipv4ToNumber(address.netmask);
        return (
          mask !== 0xffffffff &&
          (ipv4ToNumber(address.address) & mask) ===
            (ipv4ToNumber(clientAddress) & mask)
        );
      })
    : [];

  const candidates = clientAddress ? sameSubnet : addresses;

  candidates.sort((left, right) => {
    const priority = (address: string) => {
      const octets = address.split(".").map(Number);
      return octets[0] === 192 && octets[1] === 168 ? 0 : 1;
    };
    return priority(left.address) - priority(right.address);
  });

  return candidates[0]?.address;
}

'@

$updated = $source.Substring(0, $start) +
    $newFunction +
    $source.Substring($end)

[System.IO.File]::WriteAllText(
    $path,
    $updated,
    [System.Text.UTF8Encoding]::new($false)
)

Write-Host "LAN discovery function updated."
Write-Host "No database, billing, or order code was changed."
```