$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)

$taskStage = 'read-input'
$taskInput = [Console]::In.ReadToEnd() | ConvertFrom-Json
$taskRsa = $null
$taskRequest = $null
$taskCertificate = $null
try {
    Add-Type -AssemblyName System.Security

    $taskStage = 'create-request'
    $taskRsa = [System.Security.Cryptography.RSA]::Create(3072)
    $taskRequest = [System.Security.Cryptography.X509Certificates.CertificateRequest]::new(
        'CN=RelayDeck',
        $taskRsa,
        [System.Security.Cryptography.HashAlgorithmName]::SHA256,
        [System.Security.Cryptography.RSASignaturePadding]::Pkcs1
    )

    $taskSan = [System.Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
    $taskSan.AddDnsName('relaydeck.local')
    $taskSan.AddDnsName('localhost')
    $taskSan.AddIpAddress([System.Net.IPAddress]::Loopback)
    $taskRequest.CertificateExtensions.Add($taskSan.Build())
    $taskRequest.CertificateExtensions.Add(
        [System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($false, $false, 0, $true)
    )
    $taskRequest.CertificateExtensions.Add(
        [System.Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new(
            [System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::DigitalSignature -bor
            [System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::KeyEncipherment,
            $true
        )
    )
    $taskUsages = [System.Security.Cryptography.OidCollection]::new()
    [void]$taskUsages.Add([System.Security.Cryptography.Oid]::new('1.3.6.1.5.5.7.3.1'))
    $taskRequest.CertificateExtensions.Add(
        [System.Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]::new($taskUsages, $true)
    )

    $taskStage = 'create-certificate'
    $taskCertificate = $taskRequest.CreateSelfSigned(
        [DateTimeOffset]::UtcNow.AddDays(-1),
        [DateTimeOffset]::UtcNow.AddYears(5)
    )

    $taskStage = 'export-pfx'
    $taskPassword = ConvertTo-SecureString -String $taskInput.password -AsPlainText -Force
    [System.IO.File]::WriteAllBytes(
        $taskInput.pfx,
        $taskCertificate.Export(
            [System.Security.Cryptography.X509Certificates.X509ContentType]::Pfx,
            $taskPassword
        )
    )

    $taskStage = 'export-certificate'
    [System.IO.File]::WriteAllBytes(
        $taskInput.certificate,
        $taskCertificate.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert)
    )
} catch {
    [Console]::Error.WriteLine(('CERTIFICATE_ERROR:' + $taskStage + ':' + $_.FullyQualifiedErrorId))
    exit 1
} finally {
    if ($taskCertificate) { $taskCertificate.Dispose() }
    if ($taskRsa) { $taskRsa.Dispose() }
}
