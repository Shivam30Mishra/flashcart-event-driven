param(
  [string]$BaseUrl = "http://localhost:3000"
)

$ErrorActionPreference = "Stop"

Write-Host "Checking aggregated service health..."
$health = Invoke-RestMethod "$BaseUrl/api/health/services"
$health.services | Format-Table name, status

$unhealthy = $health.services | Where-Object { $_.status -ne "ok" }
if ($unhealthy) {
  throw "One or more services are not healthy."
}

Write-Host "Creating a test order..."
$created = Invoke-RestMethod -Method Post "$BaseUrl/order" `
  -ContentType "application/json" `
  -Body '{"productId":"p1","quantity":1}'

Write-Host "Order created: $($created.orderId)"

$terminal = $false
for ($i = 0; $i -lt 15; $i++) {
  Start-Sleep -Seconds 2
  $order = Invoke-RestMethod "$BaseUrl/order/$($created.orderId)"
  Write-Host "Attempt $($i + 1): $($order.status)"

  if ($order.status -in @("CONFIRMED", "FAILED")) {
    $terminal = $true
    break
  }
}

if (-not $terminal) {
  throw "Order did not reach a terminal state."
}

$stats = Invoke-RestMethod "$BaseUrl/api/stats"
Write-Host "Smoke test passed."
[pscustomobject]@{
  orderId = $created.orderId
  finalStatus = $order.status
  totalOrders = $stats.counts.orders
  confirmed = $stats.counts.confirmed
  failed = $stats.counts.failed
  outboxPending = $stats.counts.outboxPending
} | Format-List
