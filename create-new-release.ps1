[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [string]$Version,

    [switch]$Yes
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

& "$PSScriptRoot\scripts\create-release.ps1" -Version $Version -Yes:$Yes
