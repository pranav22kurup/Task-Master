$now = [int][double]::Parse((Get-Date -UFormat %s))
$email = "e2e+$now@example.com"
Write-Output "E2E_EMAIL:$email"

$bodyReg = @{name='E2E Tester'; email=$email; password='password123'} | ConvertTo-Json
try {
  $reg = Invoke-RestMethod -Method Post -Uri 'http://localhost:3000/auth/register' -ContentType 'application/json' -Body $bodyReg -ErrorAction Stop
  Write-Output 'REGISTER_RESPONSE:'
  $reg | ConvertTo-Json -Depth 5
} catch {
  Write-Output "REGISTER_ERROR: $($_.Exception.Message)"
  if ($_.Exception.Response) {
    $reader = New-Object System.IO.StreamReader ($_.Exception.Response.GetResponseStream())
    Write-Output $reader.ReadToEnd()
  }
  exit 1
}

$bodyLogin = @{email=$email; password='password123'} | ConvertTo-Json
try {
  $login = Invoke-RestMethod -Method Post -Uri 'http://localhost:3000/auth/login' -ContentType 'application/json' -Body $bodyLogin -ErrorAction Stop
  Write-Output 'LOGIN_RESPONSE:'
  $login | ConvertTo-Json -Depth 5
} catch {
  Write-Output "LOGIN_ERROR: $($_.Exception.Message)"
  if ($_.Exception.Response) {
    $reader = New-Object System.IO.StreamReader ($_.Exception.Response.GetResponseStream())
    Write-Output $reader.ReadToEnd()
  }
  exit 1
}

$token = $login.token
Write-Output "TOKEN_PRESENT: $([bool]$token)"

# Call AI generate endpoint
$aiBody = @{title='E2E AI Task'; context='Generate a concise task description for a developer'; audience='Developers'; tone='professional'; mode='description'} | ConvertTo-Json
try {
  $ai = Invoke-RestMethod -Method Post -Uri 'http://localhost:3000/ai/tasks/generate' -ContentType 'application/json' -Headers @{ Authorization = "Bearer $token" } -Body $aiBody -ErrorAction Stop
  Write-Output 'AI_RESPONSE:'
  $ai | ConvertTo-Json -Depth 5
} catch {
  Write-Output "AI_ERROR: $($_.Exception.Message)"
  if ($_.Exception.Response) {
    $reader = New-Object System.IO.StreamReader ($_.Exception.Response.GetResponseStream())
    Write-Output $reader.ReadToEnd()
  }
  exit 1
}

# Create a task using the AI text
$taskBody = @{title='Task from AI'; description=($ai.text -replace "\n"," `\n"); mode='description'} | ConvertTo-Json
try {
  $task = Invoke-RestMethod -Method Post -Uri 'http://localhost:3000/tasks' -ContentType 'application/json' -Headers @{ Authorization = "Bearer $token" } -Body $taskBody -ErrorAction Stop
  Write-Output 'TASK_RESPONSE:'
  $task | ConvertTo-Json -Depth 5
} catch {
  Write-Output "TASK_ERROR: $($_.Exception.Message)"
  if ($_.Exception.Response) {
    $reader = New-Object System.IO.StreamReader ($_.Exception.Response.GetResponseStream())
    Write-Output $reader.ReadToEnd()
  }
  exit 1
}

Write-Output 'E2E_COMPLETE'
