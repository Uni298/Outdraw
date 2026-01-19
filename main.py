#!/usr/bin/env python3
from prompt_toolkit import prompt
from prompt_toolkit.shortcuts import radiolist_dialog
from pathlib import Path

CONFLICT_START = "<<<<<<<"
CONFLICT_MID = "======="
CONFLICT_END = ">>>>>>>"

def parse_conflicts(lines):
    i = 0
    blocks = []
    while i < len(lines):
        if lines[i].startswith(CONFLICT_START):
            start = i
            i += 1
            ours = []
            while i < len(lines) and not lines[i].startswith(CONFLICT_MID):
                ours.append(lines[i])
                i += 1
            i += 1  # skip =======
            theirs = []
            while i < len(lines) and not lines[i].startswith(CONFLICT_END):
                theirs.append(lines[i])
                i += 1
            i += 1  # skip >>>>>>>
            blocks.append((start, i, ours, theirs))
        else:
            i += 1
    return blocks

def resolve_file(path: Path):
    text = path.read_text(encoding="utf-8").splitlines(keepends=True)
    blocks = parse_conflicts(text)

    if not blocks:
        print("コンフリクトは見つかりませんでした。")
        return

    offset = 0
    for idx, (start, end, ours, theirs) in enumerate(blocks, 1):
        print(f"\n=== コンフリクト {idx} ===")
        print("--- ours ---")
        print("".join(ours))
        print("--- theirs ---")
        print("".join(theirs))

        result = radiolist_dialog(
            title=f"Conflict {idx}",
            text="どちらを採用しますか？",
            values=[
                ("ours", "自分の変更 (HEAD 側)"),
                ("theirs", "相手の変更 (リモート側)"),
                ("both", "両方（ours → theirs の順）"),
            ],
        ).run()

        if result == "ours":
            chosen = ours
        elif result == "theirs":
            chosen = theirs
        else:
            chosen = ours + ["\n"] + theirs

        # 位置補正して置き換え
        s = start + offset
        e = end + offset
        text[s:e] = chosen
        offset += len(chosen) - (end - start)

    path.write_text("".join(text), encoding="utf-8")
    print(f"\n{path} のコンフリクトを解消しました。")

if __name__ == "__main__":
    filename = prompt("コンフリクトを解消するファイルパス: ")
    resolve_file(Path(filename))

