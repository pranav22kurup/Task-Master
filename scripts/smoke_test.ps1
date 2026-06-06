$now = [int][double]::Parse((Get-Date -UFormat %s))
$email = "smoke+$now@example.com"
$bodyReg = @{name='Smoke Tester'; email=$email; password='password123'} | ConvertTo-Json
Write-Output "REGISTER_EMAIL:$email"
try {
  $reg = Invoke-RestMethod -Method Post -Uri 'http://localhost:3000/auth/register' -ContentType 'application/json' -Body $bodyReg -ErrorAction Stop
  Write-Output 'REGISTER_RESPONSE:'
  $reg | ConvertTo-Json -Depth 5
} catch {
  Write-Output "REGISTER_ERROR: $($_.Exception.Message)"
}

$bodyLogin = @{email=$email; password='password123'} | ConvertTo-Json
try {
  $login = Invoke-RestMethod -Method Post -Uri 'http://localhost:3000/auth/login' -ContentType 'application/json' -Body $bodyLogin -ErrorAction Stop
  Write-Output 'LOGIN_RESPONSE:'
  $login | ConvertTo-Json -Depth 5
} catch {
  Write-Output "LOGIN_ERROR: $($_.Exception.Message)"
  exit 1
}

$token = $login.token
$headers = @{ Authorization = "Bearer $token" }
$taskBody = @{title='Smoke task'; description='Created during smoke test'} | ConvertTo-Json
try {
  $task = Invoke-RestMethod -Method Post -Uri 'http://localhost:3000/tasks' -ContentType 'application/json' -Headers $headers -Body $taskBody -ErrorAction Stop
  Write-Output 'TASK_RESPONSE:'
  $task | ConvertTo-Json -Depth 5
} catch {
  Write-Output "TASK_ERROR: $($_.Exception.Message)"
  if ($_.Exception.Response) {
    $reader = New-Object System.IO.StreamReader ($_.Exception.Response.GetResponseStream())
    $body = $reader.ReadToEnd()
    Write-Output "TASK_ERROR_BODY: $body"
  }
  exit 1
}
