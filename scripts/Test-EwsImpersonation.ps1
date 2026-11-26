<#
.SYNOPSIS
    Checks that CBSL\spsvc can read a staff member's calendar through EWS Impersonation.

.DESCRIPTION
    Sends the same calendar query the My Meetings widget uses (FindItem + CalendarView,
    this week Monday to Sunday) to Exchange EWS, signed in as spsvc and impersonating
    -TargetUser. It is read-only: it asks only for the start and end of each calendar
    item (plus subject and location with -ShowDetails). Nothing in the mailbox changes.

    Run it on a SharePoint server: the My Meetings connector will call EWS from there,
    so this tests the same network path and certificate trust. Either:
      - start PowerShell as spsvc:  runas /user:CBSL\spsvc powershell.exe
        and run the script without -Credential; or
      - pass -Credential (Get-Credential 'CBSL\spsvc') from any account.

    Exit code 0 = impersonation works; 1 = it does not (the reason is printed).

.PARAMETER TargetUser
    The staff member to impersonate: their primary SMTP address (default), or their
    UPN with -IdType PrincipalName. Use a test user, or someone who has agreed.

.PARAMETER ShowDetails
    Also print each meeting's subject and location. Off by default, because this
    reads a real person's calendar.

.EXAMPLE
    .\Test-EwsImpersonation.ps1 -TargetUser test.user2@cbsl.lk

.EXAMPLE
    .\Test-EwsImpersonation.ps1 -TargetUser test.user2@cbsl.lk -Credential (Get-Credential 'CBSL\spsvc') -ShowDetails
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string] $TargetUser,

    [string] $EwsUrl = 'https://sandesha.cbsl.lk/EWS/Exchange.asmx',

    [System.Management.Automation.PSCredential] $Credential,

    [ValidateSet('PrimarySmtpAddress', 'PrincipalName')]
    [string] $IdType = 'PrimarySmtpAddress',

    [switch] $ShowDetails
)

$ErrorActionPreference = 'Stop'
# Windows PowerShell 5.1 may not offer TLS 1.2 by default.
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

function ConvertTo-EwsDate([datetime] $d) { $d.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss'Z'") }

# This week, Monday 00:00 to the following Monday 00:00, local time (what the widget asks for).
$today = (Get-Date).Date
$start = $today.AddDays(-((([int]$today.DayOfWeek) + 6) % 7))
$end   = $start.AddDays(7)

$who = if ($Credential) { $Credential.UserName } else { [Security.Principal.WindowsIdentity]::GetCurrent().Name }
Write-Host "EWS:          $EwsUrl"
Write-Host "Signed in as: $who"
Write-Host "Impersonate:  $TargetUser ($IdType)"
Write-Host "Week:         $($start.ToString('yyyy-MM-dd')) to $($end.AddDays(-1).ToString('yyyy-MM-dd'))"
Write-Host ''

$target = [Security.SecurityElement]::Escape($TargetUser)
$soap = @"
<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types"
               xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages">
  <soap:Header>
    <t:RequestServerVersion Version="Exchange2013" />
    <t:ExchangeImpersonation>
      <t:ConnectingSID>
        <t:$IdType>$target</t:$IdType>
      </t:ConnectingSID>
    </t:ExchangeImpersonation>
  </soap:Header>
  <soap:Body>
    <m:FindItem Traversal="Shallow">
      <m:ItemShape>
        <t:BaseShape>IdOnly</t:BaseShape>
        <t:AdditionalProperties>
          <t:FieldURI FieldURI="item:Subject" />
          <t:FieldURI FieldURI="calendar:Start" />
          <t:FieldURI FieldURI="calendar:End" />
          <t:FieldURI FieldURI="calendar:Location" />
        </t:AdditionalProperties>
      </m:ItemShape>
      <m:CalendarView MaxEntriesReturned="50" StartDate="$(ConvertTo-EwsDate $start)" EndDate="$(ConvertTo-EwsDate $end)" />
      <m:ParentFolderIds>
        <t:DistinguishedFolderId Id="calendar" />
      </m:ParentFolderIds>
    </m:FindItem>
  </soap:Body>
</soap:Envelope>
"@

# ---- send ------------------------------------------------------------------
$req = [Net.HttpWebRequest]::Create($EwsUrl)
$req.Method      = 'POST'
$req.ContentType = 'text/xml; charset=utf-8'
$req.Timeout     = 30000
if ($IdType -eq 'PrimarySmtpAddress') { $req.Headers.Add('X-AnchorMailbox', $TargetUser) }
if ($Credential) { $req.Credentials = $Credential.GetNetworkCredential() }
else             { $req.UseDefaultCredentials = $true }

$bytes = [Text.Encoding]::UTF8.GetBytes($soap)
$req.ContentLength = $bytes.Length

try {
    $stream = $req.GetRequestStream()
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Close()
    $resp = $req.GetResponse()
} catch {
    # EWS answers SOAP faults with HTTP 500; keep that response so its reason can be read.
    $we = $_.Exception
    while ($we -and -not ($we -is [Net.WebException])) { $we = $we.InnerException }
    if (-not $we -or -not $we.Response) {
        Write-Host "FAIL: could not reach EWS: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host 'Check that this server can resolve and reach the EWS host over HTTPS, and trusts its certificate.'
        exit 1
    }
    $resp = $we.Response
}

$status = [int]$resp.StatusCode
$reader = New-Object IO.StreamReader($resp.GetResponseStream())
$body   = $reader.ReadToEnd()
$reader.Close(); $resp.Close()
Write-Host "HTTP $status"

if ($status -eq 401) {
    Write-Host 'FAIL: Exchange rejected the sign-in (HTTP 401).' -ForegroundColor Red
    Write-Host '- Check the spsvc password and that the account is not locked.'
    Write-Host '- Right after the grant, wait a few minutes and retry (as the Exchange team advised).'
    Write-Host '- Without -Credential the script signs in with Windows (NTLM). If it keeps failing, ask which'
    Write-Host '  authentication methods the EWS virtual directory accepts, and retry with -Credential.'
    exit 1
}

# ---- read the answer -------------------------------------------------------
try { [xml] $doc = $body } catch {
    Write-Host 'FAIL: the response is not XML (a sign-in or error page?). First 300 characters:' -ForegroundColor Red
    Write-Host $body.Substring(0, [Math]::Min(300, $body.Length))
    exit 1
}
$ns = New-Object Xml.XmlNamespaceManager($doc.NameTable)
$ns.AddNamespace('t', 'http://schemas.microsoft.com/exchange/services/2006/types')
$ns.AddNamespace('m', 'http://schemas.microsoft.com/exchange/services/2006/messages')

$hints = @{
    'ErrorImpersonateUserDenied' = 'spsvc is not (yet) allowed to impersonate this user. The grant can take a few minutes to apply. If it persists, ask the Exchange team to check the ApplicationImpersonation assignment and its scope.'
    'ErrorNonExistentMailbox'    = 'No mailbox was found for that address. Check -TargetUser (primary SMTP address), or try -IdType PrincipalName with the UPN.'
    'ErrorImpersonationFailed'   = 'Exchange could not impersonate the user. Check the address and that the user has a mailbox in this Exchange organisation.'
    'ErrorAccessDenied'          = 'Exchange denied access.'
}

$fault = $doc.SelectSingleNode("//*[local-name()='Fault']")
if ($fault) {
    $codeNode = $fault.SelectSingleNode(".//*[local-name()='ResponseCode']")
    $code = if ($codeNode) { $codeNode.InnerText } else { $fault.SelectSingleNode("*[local-name()='faultcode']").InnerText }
    $text = $fault.SelectSingleNode("*[local-name()='faultstring']").InnerText
    Write-Host "FAIL: $code - $text" -ForegroundColor Red
    $key = ($code -split ':')[-1]
    if ($hints.ContainsKey($key)) { Write-Host $hints[$key] }
    exit 1
}

$rc = $doc.SelectSingleNode('//m:ResponseCode', $ns)
if ($rc -and $rc.InnerText -ne 'NoError') {
    $msg = $doc.SelectSingleNode('//m:MessageText', $ns)
    Write-Host "FAIL: $($rc.InnerText) - $(if ($msg) { $msg.InnerText })" -ForegroundColor Red
    if ($hints.ContainsKey($rc.InnerText)) { Write-Host $hints[$rc.InnerText] }
    exit 1
}

$items = $doc.SelectNodes('//t:CalendarItem', $ns)
Write-Host "PASS: impersonation works. $($items.Count) calendar item(s) this week for $TargetUser." -ForegroundColor Green
foreach ($i in $items) {
    $s = [datetime]::Parse($i.SelectSingleNode('t:Start', $ns).InnerText)
    $e = [datetime]::Parse($i.SelectSingleNode('t:End', $ns).InnerText)
    $line = '  {0:ddd dd MMM HH:mm} - {1:HH:mm}' -f $s, $e
    if ($ShowDetails) {
        $subj = $i.SelectSingleNode('t:Subject', $ns)
        $loc  = $i.SelectSingleNode('t:Location', $ns)
        $line += "  $(if ($subj) { $subj.InnerText } else { '(No subject)' })"
        if ($loc -and $loc.InnerText) { $line += "  @ $($loc.InnerText)" }
    }
    Write-Host $line
}
exit 0
