import re

file_path = r"e:\Claude Projects\Spin and win\Spin&Win Velox\index.html"

with open(file_path, 'rb') as f:
    raw = f.read()

# The file was double-encoded: UTF-8 bytes interpreted as Latin-1 then re-encoded as UTF-8
# We need to fix this by trying to decode the mojibake
text = raw.decode('utf-8', errors='replace')

# Replace all known mojibake patterns with clean ASCII/HTML entities
replacements = {
    # Em-dash variants
    '\u00e2\u20ac\u201c': '-',
    '\u00e2\u20ac\u201d': '-', 
    '\u00e2\u20ac\u0093': '-',
    '\u00e2\u0080\u0093': '-',
    '\u00e2\u0080\u0094': '-',
    
    # Copyright
    '\u00c2\u00a9': '&copy;',
    
    # Middle dot  
    '\u00c2\u00b7': '&middot;',
    
    # Rupee sign (remove - we use TON now)
    '\u00e2\u201a\u00b9': '',
    '\u00e2\u0082\u00b9': '',
    
    # Star
    '\u00e2\u02dc\u2026': '&#9733;',
    '\u00e2\u0098\u2026': '&#9733;',
    '\u00e2\u0098\u0085': '&#9733;',
}

for old, new in replacements.items():
    text = text.replace(old, new)

# Now fix all the broken emoji sequences  
# These are UTF-8 multi-byte sequences that got double-encoded
emoji_fixes = {
    '\u00f0\u0178\u2019\u0178': '&#x1F48E;',    # 💎
    '\u00f0\u0178\u201d\u2014': '&#x1F517;',    # 🔗  
    '\u00f0\u0178\u0178\u00a6': '&#x1F3E6;',    # 🏦
    '\u00f0\u0178\u201c\u2039': '&#x1F4CB;',    # 📋
    '\u00f0\u0178\u0161\u20ac': '&#x1F680;',    # 🚀
    '\u00f0\u0178\u0178\u00a1': '&#x1F3A1;',    # 🎡
    '\u00f0\u0178\u2019\u00a3': '&#x1F4A3;',    # 💣
    '\u00f0\u0178\u0178\u00af': '&#x1F3AF;',    # 🎯
    '\u00f0\u0178\u0178\u00b2': '&#x1F3B2;',    # 🎲
    '\u00f0\u0178\u0178\u00b0': '&#x1F3B0;',    # 🎰
    '\u00f0\u0178\u0192\u0192': '&#x1F0CF;',    # 🃏
    '\u00f0\u0178\u201d\u2019': '&#x1F512;',    # 🔒
    '\u00f0\u0178\u2019\u00a5': '&#x1F465;',    # 👥
}

for old, new in emoji_fixes.items():
    text = text.replace(old, new)

# Fix broken warning/check/x emojis in JS toasts
js_emoji_fixes = {
    '\u00e2\u0161\u00a0': '&#x26A0;',   # ⚠
    '\u00e2\u0153\u0178': '&#x23F3;',   # ⏳
    '\u00e2\u0153\u0026#65533;': '&#x2705;',   # ✅
    '\u00e2\u0152\u0152': '&#x274C;',   # ❌
}

for old, new in js_emoji_fixes.items():
    text = text.replace(old, new)

# Write back as clean UTF-8 without BOM
with open(file_path, 'w', encoding='utf-8', newline='\r\n') as f:
    f.write(text)

print("Done fixing index.html encoding!")
print(f"File size: {len(text)} chars")
