$file = "e:\Claude Projects\Spin and win\Spin&Win Velox\index.html"
$bytes = [System.IO.File]::ReadAllBytes($file)
$text = [System.Text.Encoding]::UTF8.GetString($bytes)

# Fix garbled em-dash
$text = $text.Replace([char]0x00E2 + [string][char]0x20AC + [char]0x201C, "-")
$text = $text.Replace([char]0x00E2 + [string][char]0x20AC + [char]0x201D, "-")

# Fix garbled copyright
$text = $text.Replace([char]0x00C2 + [string][char]0x00A9, "&copy;")

# Fix garbled middot
$text = $text.Replace([char]0x00C2 + [string][char]0x00B7, "&middot;")

# Fix garbled rupee sign
$text = $text.Replace([char]0x00E2 + [string][char]0x201A + [char]0x00B9, "")

# Fix garbled star
$text = $text.Replace([char]0x00E2 + [string][char]0x02DC + [char]0x2026, "&#9733;")

# Replace broken emoji patterns with HTML entities
$text = $text.Replace("ðŸ'Ž", "&#x1F48E;")
$text = $text.Replace("ðŸ"—", "&#x1F517;")
$text = $text.Replace("ðŸ¦", "&#x1F3E6;")
$text = $text.Replace("ðŸ"‹", "&#x1F4CB;")
$text = $text.Replace("ðŸš€", "&#x1F680;")
$text = $text.Replace("ðŸŽ¡", "&#x1F3A1;")
$text = $text.Replace("ðŸ'£", "&#x1F4A3;")
$text = $text.Replace("ðŸŽ¯", "&#x1F3AF;")
$text = $text.Replace("ðŸŽ²", "&#x1F3B2;")
$text = $text.Replace("ðŸŽ°", "&#x1F3B0;")
$text = $text.Replace("ðŸƒ", "&#x1F0CF;")
$text = $text.Replace("ðŸ"'", "&#x1F512;")
$text = $text.Replace("ðŸ'¥", "&#x1F465;")

# Fix broken toast emojis in JS
$text = $text.Replace("âš ", "&#x26A0;")
$text = $text.Replace("â³", "&#x23F3;")
$text = $text.Replace("âœ…", "&#x2705;")
$text = $text.Replace("âŒ", "&#x274C;")

# Write back as proper UTF-8 without BOM
$utf8NoBOM = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($file, $text, $utf8NoBOM)

Write-Host "Done fixing index.html encoding"
