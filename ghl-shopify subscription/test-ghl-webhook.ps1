# Fires one test POST at the GHL Inbound Webhook trigger so GHL learns the payload fields.
# GHL can only map fields it has actually received, so this must run before building
# any workflow actions. Re-run it any time the Shopify Flow payload gains a new key.
#
#   .\test-ghl-webhook.ps1 -WebhookUrl 'https://services.leadconnectorhq.com/hooks/...'
#   .\test-ghl-webhook.ps1 -WebhookUrl '...' -Source shopify_flow_manual

# RUN IT FROM THIS DIRECTORY. From elsewhere PowerShell reports
# CommandNotFoundException, which reads as a broken script rather than a wrong cwd.
#
# ============================================================================
# TRAP, found 2026-09-18 after it cost an afternoon
# ============================================================================
# The phone was previously HARDCODED to '+15551234567'. GHL dedupes contacts on
# phone as well as email, so every fire collided into the SAME contact:
#
#   fire 1 (emailA) -> new contact -> Welcome Email sent to emailA
#   fire 2 (emailB) -> deduped on phone -> OVERWRITES the email to emailB
#                   -> coach_status already 'trial' -> guard sends it to None
#   ...then fire 1's chain continues on that contact, so day 7/9/10 arrive at
#      emailB while the welcome email had already gone to emailA.
#
# The symptom is "the welcome email never sends" and it is entirely an artefact
# of the test tool. Each run now gets a UNIQUE random phone by default.
# Pass -Phone explicitly only when deliberately testing the dedupe behaviour.
#
# Also: SENT OK means GHL ACCEPTED the webhook, not that the workflow ran. A
# fire at a workflow sitting in Draft returns the same body and does nothing.
# The only proof of a run is the contact itself.
# ============================================================================

param(
    [Parameter(Mandatory = $true)][string]$WebhookUrl,
    [string]$Source = 'test',
    [string]$Email  = 'coachtest+ghl@leadershipbooks.com',
    # Unique per run: a 555 number that cannot collide with a previous test.
    [string]$Phone  = ('+1555' + (Get-Random -Minimum 1000000 -Maximum 9999999))
)

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# Flat, on purpose - GHL's field mapper handles flat far more predictably than nested.
# This is a SUPERSET of the Shopify Flow payload in the handoff doc (section 6): the extra
# keys cost nothing now and save a re-teach if a Flow later starts sending them.
$payload = [ordered]@{
    event                = 'book_delivered'
    source               = $Source
    email                = $Email
    first_name           = 'Test'
    last_name            = 'Reader'
    phone                = $Phone
    shopify_order_id     = '0000000000'
    shopify_order_number = '#TEST'
    delivered_at         = '2026-09-08T14:22:00Z'
    sku                  = 'LWR-BOOK'
    tracking_number      = 'TESTTRACK123'
    shopify_customer_id  = '0000000001'
}

$json = $payload | ConvertTo-Json -Depth 3

Write-Host "POST $WebhookUrl"
Write-Host $json
Write-Host ''

try {
    $response = Invoke-RestMethod -Uri $WebhookUrl -Method Post `
        -ContentType 'application/json' `
        -Body ([System.Text.Encoding]::UTF8.GetBytes($json))
    Write-Host 'SENT OK - response body:'
    if ($null -ne $response) { $response | ConvertTo-Json -Depth 5 } else { Write-Host '(empty)' }
    Write-Host ''
    Write-Host 'Now open the workflow trigger in GHL and confirm the field list shows:'
    Write-Host '  event, source, email, first_name, last_name, phone,'
    Write-Host '  shopify_order_id, shopify_order_number, delivered_at,'
    Write-Host '  sku, tracking_number, shopify_customer_id'
    Write-Host 'If the list is empty, nothing downstream will map - do not build actions yet.'
}
catch {
    Write-Host "FAILED: $($_.Exception.Message)"
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        Write-Host $reader.ReadToEnd()
    }
    exit 1
}
