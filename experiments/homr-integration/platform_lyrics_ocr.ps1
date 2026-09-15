param([Parameter(Mandatory=$true)][string]$ImagePath,[Parameter(Mandatory=$true)][string]$OutputPath,[string]$Language='ko')
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
[void][Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime]
[void][Windows.Storage.FileAccessMode,Windows.Storage,ContentType=WindowsRuntime]
[void][Windows.Storage.Streams.IRandomAccessStream,Windows.Storage.Streams,ContentType=WindowsRuntime]
[void][Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics.Imaging,ContentType=WindowsRuntime]
[void][Windows.Graphics.Imaging.SoftwareBitmap,Windows.Graphics.Imaging,ContentType=WindowsRuntime]
[void][Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime]
[void][Windows.Media.Ocr.OcrResult,Windows.Foundation,ContentType=WindowsRuntime]
[void][Windows.Globalization.Language,Windows.Globalization,ContentType=WindowsRuntime]
function Await-LyricOperation($Operation,[Type]$ResultType) {
    $method=[System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethodDefinition -and $_.GetGenericArguments().Count -eq 1 -and $_.GetParameters().Count -eq 1 } | Select-Object -First 1
    $task=$method.MakeGenericMethod($ResultType).Invoke($null,@($Operation))
    $task.GetAwaiter().GetResult()
}
$source=(Get-Item -LiteralPath $ImagePath).FullName
if(Test-Path -LiteralPath $OutputPath){throw 'Output already exists'}
$file=Await-LyricOperation ([Windows.Storage.StorageFile]::GetFileFromPathAsync($source)) ([Windows.Storage.StorageFile])
$stream=Await-LyricOperation ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
try {
    $decoder=Await-LyricOperation ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap=Await-LyricOperation ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    try {
        $engine=[Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new($Language))
        if($null -eq $engine){throw 'Requested installed OCR language unavailable'}
        $result=Await-LyricOperation ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
        $lines=@(foreach($line in $result.Lines){@{text=$line.Text;words=@(foreach($word in $line.Words){$b=$word.BoundingRect;@{text=$word.Text;box=@($b.X,$b.Y,($b.X+$b.Width),($b.Y+$b.Height))}})}})
        $record=@{schemaVersion=1;engine='Windows.Media.Ocr';language=$engine.RecognizerLanguage.LanguageTag;sourceSha256=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant();width=$decoder.PixelWidth;height=$decoder.PixelHeight;lines=$lines;confidenceProvided=$false;osVersion=[Environment]::OSVersion.Version.ToString()}
        [System.IO.File]::WriteAllText($OutputPath,($record|ConvertTo-Json -Depth 8),[System.Text.UTF8Encoding]::new($false))
    } finally {$bitmap.Dispose()}
} finally {$stream.Dispose()}
