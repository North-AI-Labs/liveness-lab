$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$audioDir = Join-Path (Split-Path -Parent $PSScriptRoot) 'public\audio'
$prompts = Get-Content -LiteralPath (Join-Path $audioDir 'prompts.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    $voices = @($speaker.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -eq 'zh-CN' })
    if ($voices.Count -eq 0) { throw 'A local zh-CN Windows voice is required to regenerate prompt audio.' }
    $preferred = $voices | Where-Object { $_.VoiceInfo.Name -eq 'Microsoft Huihui Desktop' } | Select-Object -First 1
    if (!$preferred) { $preferred = $voices[0] }
    $speaker.SelectVoice($preferred.VoiceInfo.Name)
    $speaker.Rate = 1
    foreach ($prompt in $prompts.PSObject.Properties) {
        $destination = Join-Path $audioDir ($prompt.Name + '.wav')
        $speaker.SetOutputToWaveFile($destination)
        $speaker.Speak([string]$prompt.Value)
        $speaker.SetOutputToNull()
        Write-Output ($prompt.Name + '.wav')
    }
} finally { $speaker.Dispose() }
