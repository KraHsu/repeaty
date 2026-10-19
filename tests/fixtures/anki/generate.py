"""Regenerate synthetic .apkg fixtures with Anki 26.9.3 (pip install anki==26.9.3).

Run from the repository root. Anki is a fixture generator, not a Repeaty dependency.
All note content and media in these fixtures are authored for Repeaty (MIT).
"""

import base64
import json
import tempfile
import wave
from pathlib import Path

from anki.collection import Collection
from anki.import_export_pb2 import ExportAnkiPackageOptions

destination = Path(__file__).parent.resolve()
with tempfile.TemporaryDirectory(prefix="repeaty-anki-") as directory:
    collection = Collection(str(Path(directory) / "collection.anki2"))
    models = []
    for kind in [0, 1, 4]:  # Basic, Basic (and reversed card), Cloze
        model = json.loads(collection._backend.get_stock_notetype_legacy(kind))
        model["name"] = ["基础问答", "双向", "挖空"][len(models)]
        model["id"] = collection.models.add_dict(model).id
        models.append(model)

    media = Path(collection.media.dir())
    (media / "pixel.png").write_bytes(base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9HcAAAAASUVORK5CYII="
    ))
    with wave.open(str(media / "voice.wav"), "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(8000)
        audio.writeframes(b"\0\0" * 800)
    (media / "drawing.svg").write_text('<svg xmlns="http://www.w3.org/2000/svg"/>')

    def add(model, guid, front, back):
        note = collection.new_note(model)
        note.guid = guid
        note.fields = [front, back]
        note.tags = ["Anki", "中文"]
        collection.add_note(note, 1)

    add(models[0], "rpt-basic", '<div>What is <b>2 + 2</b>? \\(x^2\\)</div><img src="pixel.png">', '<div>Four. 中文</div>[sound:voice.wav]<img src="pixel.png"><pre><code>return 4\n```</code></pre>')
    add(models[1], "rpt-reverse", "hello", "你好")
    add(models[2], "rpt-cloze", "The {{c1::capital::place}} of France is {{c2::Paris}}.", "Remember the city.")
    add(models[0], "rpt-svg", '<img src="drawing.svg">', "SVG is outside the supported media types.")
    add(models[2], "rpt-nested", "{{c1::Outer {{c2::inner}}}}", "Nested clozes are not supported.")
    add(models[0], "rpt-safe", '<script>globalThis.ankiExecuted = true</script><div onclick="alert(1)">Safe text</div><img src="https://example.invalid/tracker.png">', '<a href="javascript:alert(1)">A safe answer</a>')
    custom = json.loads(collection._backend.get_stock_notetype_legacy(0))
    custom["name"] = "Custom script template"
    custom["tmpls"][0]["qfmt"] = '{{' + custom['flds'][0]['name'] + '}}<script>alert(1)</script>'
    custom["id"] = collection.models.add_dict(custom).id
    add(custom, "rpt-custom", "Custom question", "Custom answer")

    # Real scheduling data must not become Repeaty FSRS state.
    first_card = collection.db.scalar("select id from cards order by id limit 1")
    collection.db.execute("update cards set type=2,queue=2,due=100,ivl=30,reps=5 where id=?", first_card)
    collection.db.execute("insert into revlog values (?,?,?,?,?,?,?,?,?)", 1700000000000, first_card, -1, 3, 30, 10, 2500, 1200, 1)
    for legacy in [True, False]:
        collection.export_anki_package(
            out_path=str(destination / ("legacy.apkg" if legacy else "modern.apkg")),
            options=ExportAnkiPackageOptions(with_scheduling=True, with_media=True, legacy=legacy),
            limit=None,
        )
    collection.close()
