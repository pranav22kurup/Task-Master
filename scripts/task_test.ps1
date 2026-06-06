$token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MiwiZW1haWwiOiJzbW9rZSsxNzgwNzcwNDYyQGV4YW1wbGUuY29tIiwibmFtZSI6IlNtb2tlIFRlc3RlciIsInJvbGUiOiJtZW1iZXIiLCJqdGkiOiI2ZWU3ODQ0Ny1hZTdiLTQ3MmYtOGJlMy0xODMyMDExMThkMDUiLCJpYXQiOjE3ODA3NTA2NjQsImV4cCI6MTc4MTM1NTQ2NH0.BdX0ki6TfUk8eAZQDqF-HmAWPF_79Bj13cF6uAxN-zM'
try {
  $resp = Invoke-WebRequest -Method Post -Uri 'http://localhost:3000/tasks' -ContentType 'application/json' -Headers @{ Authorization = "Bearer $token" } -Body '{"title":"Smoke task","description":"created via ps"}' -UseBasicParsing -ErrorAction Stop
  Write-Output "STATUS: $($resp.StatusCode)"
  Write-Output "BODY:"
  Write-Output $resp.Content
} catch {
  Write-Output "ERROR: $($_.Exception.Message)"
  if ($_.Exception.Response) {
    $reader = New-Object System.IO.StreamReader ($_.Exception.Response.GetResponseStream())
    Write-Output $reader.ReadToEnd()
  }
}
