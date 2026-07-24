"""Update MD5 hashes in VoxDeorum.modinfo to match actual file contents."""

import hashlib
import re
import sys
from pathlib import Path

MODINFO = Path(__file__).parent / "VoxDeorum.modinfo"
FILE_RE = re.compile(r'(<File\s+md5=")((?:[0-9A-Fa-f]{32})?)("\s+import="[01]">)(.+?)(</File>)')


def md5_of(path: Path) -> str:
    return hashlib.md5(path.read_bytes()).hexdigest().upper()


def main() -> None:
    text = MODINFO.read_text(encoding="utf-8")
    updated = 0

    def replace_match(m: re.Match) -> str:
        nonlocal updated
        rel_path = m.group(4)
        file_path = MODINFO.parent / rel_path
        if not file_path.exists():
            print(f"  MISSING: {rel_path}")
            return m.group(0)
        new_md5 = md5_of(file_path)
        old_md5 = m.group(2).upper()
        if old_md5 != new_md5:
            print(f"  {rel_path}: {old_md5} -> {new_md5}")
            updated += 1
        return f"{m.group(1)}{new_md5}{m.group(3)}{m.group(4)}{m.group(5)}"

    new_text = FILE_RE.sub(replace_match, text)

    if updated:
        MODINFO.write_text(new_text, encoding="utf-8")
        print(f"Updated {updated} hash(es).")
    else:
        print("All hashes up to date.")


if __name__ == "__main__":
    main()
